import { describe, expect, test } from 'vitest';
import { AbortController } from '../src/events.js';
import { createFetch, Headers, Request, Response } from '../src/fetch.js';
import { URLSearchParams } from '../src/url.js';

// A fake maemo:http. The test sends the events itself.
function fakeHttp() {
  const http = {
    calls: [],
    aborted: [],
    request(opts, cb) {
      http.calls.push({ opts, cb });
      return http.calls.length;
    },
    abort(id) {
      http.aborted.push(id);
    },
  };
  return http;
}
const buf = (s) => new TextEncoder().encode(s).buffer;
const head = (status = 200, headers = []) => ({ type: 'headers', status, statusText: 'OK', headers, url: 'https://e.com/', redirected: false });

describe('fetch', () => {
  test('GET: options, headers, and a body in two chunks', async () => {
    const http = fakeHttp();
    const p = createFetch(http)('https://e.com/x?y=1');
    const { opts, cb } = http.calls[0];
    expect(opts).toMatchObject({ method: 'GET', url: 'https://e.com/x?y=1', body: null, followRedirects: true });
    cb(head(200, [['Content-Type', 'application/json'], ['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2']]));
    cb({ type: 'data', chunk: buf('{"a":') });
    cb({ type: 'data', chunk: buf('1}') });
    cb({ type: 'end' });
    const r = await p;
    expect([r.ok, r.status, r.headers.get('content-type')]).toEqual([true, 200, 'application/json']);
    expect(r.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await r.json()).toEqual({ a: 1 });
    await expect(r.text()).rejects.toThrow(TypeError);
  });

  test('a string body gets a content type', () => {
    const http = fakeHttp();
    createFetch(http)('https://e.com/', { method: 'post', body: 'héllo' });
    const { opts } = http.calls[0];
    expect(opts.method).toBe('POST');
    expect(new Uint8Array(opts.body).length).toBe(6);
    expect(opts.headers).toContainEqual(['content-type', 'text/plain;charset=UTF-8']);
  });

  test('a URLSearchParams body is form data', () => {
    const http = fakeHttp();
    createFetch(http)('https://e.com/', { method: 'POST', body: new URLSearchParams({ a: 'b c' }) });
    expect(http.calls[0].opts.headers).toContainEqual(['content-type', 'application/x-www-form-urlencoded;charset=UTF-8']);
  });

  test('GET with a body is refused', async () => {
    await expect(createFetch(fakeHttp())('https://e.com/', { body: 'x' })).rejects.toThrow(/GET or HEAD/);
  });

  test('an error before the headers rejects with Failed to fetch and a cause', async () => {
    const http = fakeHttp();
    const p = createFetch(http)('https://e.com/');
    http.calls[0].cb({ type: 'error', message: 'Could not resolve host: e.com' });
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(TypeError);
    expect(e.message).toBe('Failed to fetch');
    expect(e.cause.message).toMatch(/resolve/);
  });

  test('an error after the headers rejects the body', async () => {
    const http = fakeHttp();
    const p = createFetch(http)('https://e.com/');
    http.calls[0].cb(head());
    const r = await p;
    http.calls[0].cb({ type: 'error', message: 'connection reset' });
    await expect(r.text()).rejects.toThrow(TypeError);
  });

  test('abort before the headers', async () => {
    const http = fakeHttp();
    const c = new AbortController();
    const p = createFetch(http)('https://e.com/', { signal: c.signal });
    c.abort();
    const e = await p.catch((x) => x);
    expect(e.name).toBe('AbortError');
    expect(http.aborted).toEqual([1]);
  });

  test('abort after the headers rejects the body', async () => {
    const http = fakeHttp();
    const c = new AbortController();
    const p = createFetch(http)('https://e.com/', { signal: c.signal });
    http.calls[0].cb(head());
    const r = await p;
    c.abort();
    await expect(r.text()).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('a signal that is aborted already sends no request', async () => {
    const http = fakeHttp();
    const c = new AbortController();
    c.abort();
    await expect(createFetch(http)('https://e.com/', { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(http.calls).toHaveLength(0);
  });

  test('only http and https', async () => {
    await expect(createFetch(fakeHttp())('ftp://e.com/')).rejects.toThrow(/only http and https/);
  });

  test("redirect: 'error' is rejected", async () => {
    const http = fakeHttp();
    await expect(createFetch(http)('https://e.com/', { redirect: 'error' })).rejects.toThrow(TypeError);
    expect(http.calls.length).toBe(0);
  });

  test('a Response can have a null init', () => {
    expect(new Response(null, null).status).toBe(200);
  });

  test('redirect: manual', () => {
    const http = fakeHttp();
    createFetch(http)('https://e.com/', { redirect: 'manual' });
    expect(http.calls[0].opts.followRedirects).toBe(false);
  });

  test('fetch(new Request(...))', () => {
    const http = fakeHttp();
    createFetch(http)(new Request('https://e.com/r', { method: 'DELETE', headers: { 'X-A': '1' } }));
    expect(http.calls[0].opts).toMatchObject({ method: 'DELETE', url: 'https://e.com/r' });
    expect(http.calls[0].opts.headers).toContainEqual(['x-a', '1']);
  });
});

test('Headers are case-insensitive and join values', () => {
  const h = new Headers({ 'X-A': ' 1 ' });
  h.append('x-a', '2');
  expect(h.get('X-a')).toBe('1, 2');
  expect(() => h.append('bad name', 'x')).toThrow(TypeError);
});

test('Response.json', async () => {
  const r = Response.json({ x: 1 });
  expect(r.headers.get('content-type')).toBe('application/json');
  expect(await r.json()).toEqual({ x: 1 });
});
