import { test, assert, assertEqual, assertThrows, run } from './harness.js';
import { request, abort } from 'maemo:http';

const BASE = 'https://localhost:8443';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Run one request; resolve with every event when it ends.
function go(opts) {
  return new Promise((resolve) => {
    const r = { types: [], chunks: [] };
    request(opts, (ev) => {
      r.types.push(ev.type);
      if (ev.type === 'headers') r.head = ev;
      if (ev.type === 'data') r.chunks.push(new Uint8Array(ev.chunk));
      if (ev.type === 'end' || ev.type === 'error') {
        r.last = ev;
        resolve(r);
      }
    });
  });
}

function bytes(r) {
  let n = 0;
  for (const c of r.chunks) n += c.length;
  const all = new Uint8Array(n);
  let off = 0;
  for (const c of r.chunks) {
    all.set(c, off);
    off += c.length;
  }
  return all;
}

const text = (r) => new TextDecoder().decode(bytes(r));
const header = (r, name) => (r.head.headers.find(([k]) => k.toLowerCase() === name) || [])[1];

test('GET gives headers, data and end, in that order', async () => {
  const r = await go({ url: BASE + '/json' });
  assertEqual(r.types[0], 'headers');
  assertEqual(r.types[r.types.length - 1], 'end');
  assertEqual(r.head.status, 200);
  assertEqual(header(r, 'content-type'), 'application/json');
  assertEqual(JSON.parse(text(r)).n, 42);
});

test('POST sends the body', async () => {
  const body = new TextEncoder().encode('héllo').buffer;
  const r = await go({ url: BASE + '/echo', method: 'POST', headers: [['Content-Type', 'text/plain']], body });
  const echo = JSON.parse(text(r));
  assertEqual([echo.method, echo.body, echo.headers['content-type']], ['POST', 'héllo', 'text/plain']);
});

test('another method with a body', async () => {
  const r = await go({ url: BASE + '/echo', method: 'PUT', body: new TextEncoder().encode('x').buffer });
  assertEqual(JSON.parse(text(r)).method, 'PUT');
});

test('the default User-Agent, and one from the caller', async () => {
  let r = await go({ url: BASE + '/echo' });
  assertEqual(JSON.parse(text(r)).headers['user-agent'], 'maemo-react/0.3.0');
  r = await go({ url: BASE + '/echo', headers: [['User-Agent', 'mine']] });
  assertEqual(JSON.parse(text(r)).headers['user-agent'], 'mine');
});

test('redirects are followed', async () => {
  const r = await go({ url: BASE + '/redirect' });
  assertEqual([r.head.status, r.head.redirected], [200, true]);
  assert(r.head.url.endsWith('/json'), r.head.url);
});

test('followRedirects: false gives the 302', async () => {
  const r = await go({ url: BASE + '/redirect', followRedirects: false });
  assertEqual(r.head.status, 302);
  assertEqual(header(r, 'location'), '/json');
});

test('a 404 is a response, not an error', async () => {
  const r = await go({ url: BASE + '/status/404' });
  assertEqual([r.head.status, r.last.type], [404, 'end']);
});

test('a 1 MB body arrives complete', async () => {
  const r = await go({ url: BASE + '/big' });
  assertEqual(bytes(r).length, 1024 * 1024);
});

test('a gzip body is decoded', async () => {
  const r = await go({ url: BASE + '/gzip' });
  assert(text(r).startsWith('compressed text compressed text'));
});

test('a closed port gives an error event', async () => {
  const r = await go({ url: 'https://localhost:1/' });
  assertEqual(r.types, ['error']);
  assert(r.last.message.length > 0);
});

test('a host name that does not resolve gives an error event', async () => {
  const r = await go({ url: 'https://nonexistent.invalid/' });
  assertEqual(r.last.type, 'error');
});

test('timeoutMs stops a slow request', async () => {
  const t0 = performance.now();
  const r = await go({ url: BASE + '/slow', timeoutMs: 500 });
  assertEqual(r.last.type, 'error');
  assert(performance.now() - t0 < 2500);
});

test('abort: no more events', async () => {
  const types = [];
  const id = request({ url: BASE + '/slow' }, (ev) => types.push(ev.type));
  abort(id);
  await sleep(3500);
  assertEqual(types, []);
});

test('abort from inside the data handler', async () => {
  const types = [];
  const id = request({ url: BASE + '/big' }, (ev) => {
    types.push(ev.type);
    if (ev.type === 'data') abort(id);
  });
  await sleep(1500);
  assertEqual(types, ['headers', 'data']);
});

test('a file: URL gives an error event and no data', async () => {
  const r = await go({ url: 'file:///etc/hosts' });
  assertEqual(r.types, ['error']);
});

test('a redirect to a file: URL is not followed', async () => {
  const r = await go({ url: BASE + '/redirect-file' });
  assertEqual(r.last.type, 'error');
  assert(!r.types.includes('data'), r.types.join());
});

test('request() refuses CR, LF and bad names in headers and methods', async () => {
  const url = BASE + '/echo';
  const cb = () => {};
  assertThrows(() => request({ url, headers: [['X-A', 'a\r\nX-B: b']] }, cb), /TypeError/);
  assertThrows(() => request({ url, headers: [['X-A', 'a\nb']] }, cb), /TypeError/);
  assertThrows(() => request({ url, headers: [['X\nA', 'a']] }, cb), /TypeError/);
  assertThrows(() => request({ url, headers: [['X:A', 'a']] }, cb), /TypeError/);
  assertThrows(() => request({ url, headers: [['X A', 'a']] }, cb), /TypeError/);
  assertThrows(() => request({ url, headers: [['', 'a']] }, cb), /TypeError/);
  assertThrows(() => request({ url, headers: [['X-A', 'a\0b']] }, cb), /TypeError/);
  assertThrows(() => request({ url, method: 'GET\r\nX: y' }, cb), /TypeError/);
  assertThrows(() => request({ url, method: 'GE T' }, cb), /TypeError/);
  const e = assertThrows(() => request({ url, headers: [['X\nA', 'a']] }, cb), /TypeError/);
  assert(String(e.message).includes('X'), 'the message names the header');
  const r = await go({ url, headers: [['X-Ok', 'fine']], method: 'DELETE' });
  const echo = JSON.parse(text(r));
  assertEqual([echo.method, echo.headers['x-ok']], ['DELETE', 'fine']);
});

test('a request started inside a headers handler reaches end', async () => {
  const second = new Promise((resolve) => {
    let started = false;
    request({ url: BASE + '/json' }, (ev) => {
      if (ev.type === 'headers' && !started) {
        started = true;
        const types = [];
        request({ url: BASE + '/json' }, (e2) => {
          types.push(e2.type);
          if (e2.type === 'end' || e2.type === 'error') resolve(types);
        });
      }
    });
  });
  const types = await second;
  assertEqual(types[types.length - 1], 'end');
});

test('bad arguments', () => {
  assertThrows(() => request({ url: BASE }, null), /TypeError/);
  assertThrows(() => request({ url: BASE, body: 'not a buffer' }, () => {}), /TypeError/);
});

await run();
