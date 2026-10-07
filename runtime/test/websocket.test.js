import { test, assert, assertEqual, assertThrows, run } from './harness.js';

const WSS = 'wss://localhost:8444';

// Open a socket and collect its events until close.
function watch(url, protocols) {
  const s = new WebSocket(url, protocols);
  const r = { s, types: [], messages: [] };
  r.done = new Promise((resolve) => {
    s.onopen = () => r.types.push('open');
    s.onmessage = (e) => {
      r.types.push('message');
      r.messages.push(e.data);
    };
    s.onerror = (e) => {
      r.types.push('error');
      r.error = e;
    };
    s.onclose = (e) => {
      r.types.push('close');
      r.close = e;
      resolve(r);
    };
  });
  r.opened = new Promise((resolve) => {
    s.addEventListener('open', () => resolve(r));
    s.addEventListener('close', () => resolve(r));
  });
  return r;
}

test('echo over the WebSocket global, and a clean close', async () => {
  const r = watch(WSS + '/echo', ['ha']);
  assertEqual(r.s.readyState, WebSocket.CONNECTING);
  await r.opened;
  assertEqual([r.s.readyState, r.s.protocol, r.s.url], [WebSocket.OPEN, 'ha', WSS + '/echo']);
  r.s.send('hello');
  r.s.send(new Uint8Array([1, 2, 3, 4]).subarray(1, 3));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assertEqual(r.messages[0], 'hello');
  assert(r.messages[1] instanceof ArrayBuffer, 'binary gives an ArrayBuffer');
  assertEqual(Array.from(new Uint8Array(r.messages[1])), [2, 3]);
  r.s.close(1000, 'done');
  assertEqual(r.s.readyState, WebSocket.CLOSING);
  await r.done;
  assertEqual([r.close.code, r.close.reason, r.close.wasClean, r.s.readyState], [1000, 'done', true, WebSocket.CLOSED]);
  assert(r.close instanceof CloseEvent, 'a CloseEvent');
});

test('an https URL becomes wss', async () => {
  const r = watch('https://localhost:8444/echo');
  assertEqual(r.s.url, WSS + '/echo');
  await r.opened;
  r.s.close();
  await r.done;
  assertEqual(r.close.wasClean, true);
});

test('close before open gives error and close 1006, and no server events', async () => {
  const r = watch(WSS + '/echo');
  r.s.close();
  await r.done;
  assertEqual(r.types, ['error', 'close']);
  assertEqual([r.close.code, r.close.wasClean], [1006, false]);
});

test('a refused handshake gives error with a message, then close', async () => {
  const r = watch(WSS + '/reject');
  await r.done;
  assertEqual(r.types, ['error', 'close']);
  assert(String(r.error.message).includes('403'), String(r.error.message));
});

test('a protocol that the client did not ask for fails the connection', async () => {
  const r = watch(WSS + '/badproto', ['ha']);
  await r.done;
  assertEqual(r.types, ['error', 'close']);
  assertEqual(r.s.readyState, WebSocket.CLOSED);
});

test('send before open throws InvalidStateError', () => {
  const s = new WebSocket(WSS + '/echo');
  assertThrows(() => s.send('x'), /InvalidStateError/);
  s.close();
});

await run();
