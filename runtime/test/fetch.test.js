import { test, assert, assertEqual, assertRejects, run } from './harness.js';

const BASE = 'https://localhost:8443';

test('fetch JSON over HTTPS', async () => {
  const r = await fetch(BASE + '/json');
  assertEqual([r.ok, r.status], [true, 200]);
  assertEqual((await r.json()).hello, 'world');
});

test('fetch POST with a JSON body', async () => {
  const r = await fetch(BASE + '/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: 'ñ' }),
  });
  const echo = await r.json();
  assertEqual([echo.method, JSON.parse(echo.body).a], ['POST', 'ñ']);
});

test('a 404 resolves with ok false', async () => {
  const r = await fetch(BASE + '/status/404');
  assertEqual([r.ok, r.status], [false, 404]);
});

test('DNS failure rejects with TypeError and a cause', async () => {
  const e = await assertRejects(fetch('https://nonexistent.invalid/'), /TypeError: Failed to fetch/);
  assert(e.cause && e.cause.message.length > 0, 'no cause');
});

test('AbortSignal.timeout stops a slow request', async () => {
  await assertRejects(fetch(BASE + '/slow', { signal: AbortSignal.timeout(300) }), /TimeoutError/);
});

test('arrayBuffer of a 1 MB body', async () => {
  const r = await fetch(BASE + '/big');
  assertEqual((await r.arrayBuffer()).byteLength, 1024 * 1024);
});

await run();
