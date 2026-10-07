import { describe, expect, test } from 'vitest';
import {
  AuthError, SERVER_KEY, TOKEN_KEY, TOKEN_REJECTED, checkToken, clearToken, normalizeServer, normalizeToken, readCredentials, saveCredentials, socketUrl,
} from '../src/ha/auth.js';

type Answer = { status: number; body: unknown } | Error;

// A fake fetch with scripted answers, in order.
function fakeFetch(answers: Answer[]) {
  const calls: Array<{ url: string; method: string; auth: string; redirect: string }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization') ?? '', redirect: init?.redirect ?? '' });
    const a = answers.shift();
    if (!a) throw new Error('the test gave no answer for ' + String(url));
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as typeof fetch;
  return { fetch, calls };
}

// A fake storage: a Map.
function memory(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const S = 'http://ha:8123';
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return e instanceof AuthError ? e.code + ': ' + e.message : String(e);
  }
};

describe('normalizeServer', () => {
  test('adds http, and keeps only the scheme, the host and the port', () => {
    expect(normalizeServer('homeassistant.local:8123')).toBe('http://homeassistant.local:8123');
    expect(normalizeServer('http://ha/')).toBe('http://ha');
    expect(normalizeServer(' https://x.ui.nabu.casa/ ')).toBe('https://x.ui.nabu.casa');
    expect(normalizeServer('http://h:8123/lovelace/0?edit=1#top')).toBe('http://h:8123');
    expect(normalizeServer('http://[::1]:8123/x')).toBe('http://[::1]:8123');
    expect(normalizeServer('https://ha.example:443/lovelace')).toBe('https://ha.example');
    expect(normalizeServer('ha.local/lovelace')).toBe('http://ha.local');
  });

  test('refuses an empty or a non-http URL', () => {
    expect(() => normalizeServer('')).toThrow(expect.objectContaining({ code: 'url' }));
    expect(() => normalizeServer('ftp://x')).toThrow(expect.objectContaining({ code: 'url' }));
    expect(() => normalizeServer('http://')).toThrow(expect.objectContaining({ code: 'url' }));
  });

  test('socketUrl', () => {
    expect(socketUrl('http://h:8123')).toBe('ws://h:8123/api/websocket');
    expect(socketUrl('https://x.ui.nabu.casa')).toBe('wss://x.ui.nabu.casa/api/websocket');
  });
});

describe('normalizeToken', () => {
  test('removes the spaces and the line breaks of a paste at the start and at the end', () => {
    expect(normalizeToken('  eyJ0.abc.def\n')).toBe('eyJ0.abc.def');
    expect(normalizeToken('\teyJ0.abc.def\r\n')).toBe('eyJ0.abc.def');
  });

  test('refuses an empty token, and a token with a space or a line break inside', () => {
    expect(() => normalizeToken(' \n')).toThrow(expect.objectContaining({ code: 'token', message: 'Paste the token' }));
    expect(() => normalizeToken('eyJ0.abc\ndef')).toThrow(expect.objectContaining({ code: 'token' }));
  });
});

describe('checkToken', () => {
  test('GET /api/ with the bearer token; 200 accepts it', async () => {
    const f = fakeFetch([{ status: 200, body: { message: 'API running.' } }]);
    expect(await code(checkToken({ fetch: f.fetch }, S, 'tok'))).toBe('no error');
    expect(f.calls).toEqual([{ url: S + '/api/', method: 'GET', auth: 'Bearer tok', redirect: 'manual' }]);
  });

  test('401 gives the sign-in message', async () => {
    const f = fakeFetch([{ status: 401, body: '401: Unauthorized' }]);
    expect(await code(checkToken({ fetch: f.fetch }, S, 'bad'))).toBe('rejected: ' + TOKEN_REJECTED);
    expect(TOKEN_REJECTED).toBe('Home Assistant did not accept the token. Make a new token in your profile.');
  });

  test('network, certificate and server errors', async () => {
    const dns = new TypeError('Failed to fetch', { cause: new Error('Could not resolve host: ha') });
    expect(await code(checkToken({ fetch: fakeFetch([dns]).fetch }, S, 't'))).toBe('network: The server did not answer');
    const tls = new TypeError('Failed to fetch', { cause: new Error('SSL certificate problem: unable to get local issuer certificate') });
    expect(await code(checkToken({ fetch: fakeFetch([tls]).fetch }, S, 't'))).toBe('certificate: The certificate is not valid');
    expect(await code(checkToken({ fetch: fakeFetch([{ status: 500, body: 'oops' }]).fetch }, S, 't'))).toBe('server: The server answered 500');
  });
});

describe('checkToken, more cases', () => {
  test('a redirect is not followed, and gives the server error', async () => {
    const f = fakeFetch([{ status: 302, body: '' }]);
    expect(await code(checkToken({ fetch: f.fetch }, S, 't'))).toBe(
      'server: The server moved to another address. Type the final address of the server.',
    );
  });

  test('403 is a server error', async () => {
    expect(await code(checkToken({ fetch: fakeFetch([{ status: 403, body: '' }]).fetch }, S, 't'))).toBe('server: The server answered 403');
  });

  test('a host name with ssl or tls in it is a network error', async () => {
    const e = new TypeError('Failed to fetch', { cause: new Error('Could not resolve host: ssl.example') });
    expect(await code(checkToken({ fetch: fakeFetch([e]).fetch }, S, 't'))).toBe('network: The server did not answer');
    const c = new TypeError('Failed to fetch', { cause: new Error('Failed to connect to tls.example port 443') });
    expect(await code(checkToken({ fetch: fakeFetch([c]).fetch }, S, 't'))).toBe('network: The server did not answer');
  });

  test('an error without a cause, or not a TypeError, is a network error', async () => {
    expect(await code(checkToken({ fetch: fakeFetch([new TypeError('Failed to fetch')]).fetch }, S, 't'))).toBe('network: The server did not answer');
    expect(await code(checkToken({ fetch: fakeFetch([new RangeError('odd')]).fetch }, S, 't'))).toBe('network: The server did not answer');
  });
});

describe('the token in the storage', () => {
  test('save, read and clear; the server URL stays', () => {
    const s = memory();
    expect(readCredentials(s)).toEqual({ server: '', token: null });
    saveCredentials(s, S, 'tok');
    expect(Object.fromEntries(s.map)).toEqual({ [SERVER_KEY]: S, [TOKEN_KEY]: 'tok' });
    expect([SERVER_KEY, TOKEN_KEY]).toEqual(['ha.server', 'ha.token']);
    expect(readCredentials(s)).toEqual({ server: S, token: 'tok' });
    clearToken(s);
    expect(readCredentials(s)).toEqual({ server: S, token: null });
  });

  test('a token without a server URL does not count', () => {
    expect(readCredentials(memory({ 'ha.token': 'tok' }))).toEqual({ server: '', token: null });
  });
});
