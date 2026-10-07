import { test, assert, assertEqual, assertThrows, run } from './harness.js';
import { open, send, close, abort, bufferedAmount } from 'maemo:ws';

const WSS = 'wss://localhost:8444';
const WS = 'ws://localhost:8445';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Open a connection and record its events. `done` resolves at the close event.
function connect(url, options = {}) {
  const c = { events: [], messages: [], id: 0 };
  c.done = new Promise((resolve) => {
    c.id = open({ url, ...options }, (ev) => {
      c.events.push(ev.type);
      if (ev.type === 'open') c.open = ev;
      if (ev.type === 'message') c.messages.push(ev.data);
      if (ev.type === 'error') c.error = ev;
      if (ev.type === 'close') {
        c.close = ev;
        resolve(c);
      }
    });
  });
  // Resolves at the open event, or at the close event when there is no open.
  c.opened = new Promise((resolve) => {
    const check = () => {
      if (c.open || c.close) resolve(c);
      else setTimeout(check, 10);
    };
    check();
  });
  // Resolves when n messages are in.
  c.until = (n) =>
    new Promise((resolve) => {
      const check = () => {
        if (c.messages.length >= n || c.close) resolve(c);
        else setTimeout(check, 10);
      };
      check();
    });
  return c;
}

const bytes = (n) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = i & 0xff;
  return b;
};

test('open gives the protocol, echo gives the text back, and close is clean', async () => {
  const c = connect(WSS + '/echo', { protocols: ['ha', 'other'] });
  await c.opened;
  assertEqual(c.open.protocol, 'ha');
  send(c.id, 'hello', false);
  await c.until(1);
  assertEqual(c.messages, ['hello']);
  close(c.id, 1000, 'bye');
  await c.done;
  assertEqual([c.close.code, c.close.reason, c.close.wasClean], [1000, 'bye', true]);
  assertEqual(c.events, ['open', 'message', 'close']);
});

test('ws without TLS works too', async () => {
  const c = connect(WS + '/echo');
  await c.opened;
  assertEqual(c.open.protocol, '');
  send(c.id, 'plain', false);
  await c.until(1);
  assertEqual(c.messages, ['plain']);
  close(c.id, 1000, '');
  await c.done;
  assertEqual(c.close.code, 1000);
});

test('binary frames keep their bytes', async () => {
  const c = connect(WSS + '/echo');
  await c.opened;
  send(c.id, bytes(300).buffer, true);
  await c.until(1);
  assert(c.messages[0] instanceof ArrayBuffer, 'an ArrayBuffer');
  assertEqual(Array.from(new Uint8Array(c.messages[0])), Array.from(bytes(300)));
  close(c.id, 1000, '');
  await c.done;
});

test('UTF-8 text goes both ways', async () => {
  const c = connect(WSS + '/echo');
  await c.opened;
  const text = 'héllo 日本 🎉';
  send(c.id, text, false);
  await c.until(1);
  assertEqual(c.messages, [text]);
  close(c.id, 1000, '');
  await c.done;
});

test('fragments reassemble into one message, also with a ping between them', async () => {
  const c = connect(WSS + '/fragments');
  await c.done;
  assertEqual(c.messages.length, 2);
  assertEqual(c.messages[0], 'abcdefghi');
  assert(c.messages[1] instanceof ArrayBuffer, 'the second message is binary');
  assertEqual(c.messages[1].byteLength, 2048);
  assertEqual(new Uint8Array(c.messages[1])[1024 + 5], 5);
  assertEqual([c.close.code, c.close.reason, c.close.wasClean], [1000, 'done', true]);
});

test('a 1 MB message in both directions', async () => {
  const c = connect(WSS + '/big');
  await c.until(1);
  assertEqual(c.messages[0].length, 1024 * 1024);
  assert(c.messages[0].startsWith('xxxxxxxx') && c.messages[0].endsWith('xxxxxxxx'), 'all x');
  send(c.id, 'y'.repeat(1024 * 1024), false);
  assert(typeof bufferedAmount(c.id) === 'number', 'bufferedAmount is a number');
  await c.until(2);
  assertEqual(c.messages[1], 'len:1048576');
  assertEqual(bufferedAmount(c.id), 0);
  close(c.id, 1000, '');
  await c.done;
});

test('many small messages arrive in order', async () => {
  const c = connect(WSS + '/many');
  await c.done;
  assertEqual(c.messages.length, 500);
  assertEqual([c.messages[0], c.messages[499]], ['n:0', 'n:499']);
  assertEqual(c.close.code, 1000);
});

test('the server closes with a code and a reason', async () => {
  const c = connect(WSS + '/close');
  await c.done;
  assertEqual(c.events, ['open', 'close']);
  assertEqual([c.close.code, c.close.reason, c.close.wasClean], [4000, 'bye', true]);
});

test('the server drops the connection', async () => {
  const c = connect(WSS + '/drop');
  await c.done;
  assertEqual(c.events, ['open', 'message', 'error', 'close']);
  assertEqual([c.close.code, c.close.wasClean], [1006, false]);
  assert(c.error.message.length > 0, 'the error has a message');
});

test('a handshake that the server refuses', async () => {
  const c = connect(WSS + '/reject');
  await c.done;
  assertEqual(c.events, ['error', 'close']);
  assert(c.error.message.includes('403'), c.error.message);
  assertEqual([c.close.code, c.close.wasClean], [1006, false]);
});

test('a closed port and a host that does not resolve', async () => {
  const a = connect('wss://localhost:1/');
  await a.done;
  assertEqual(a.events, ['error', 'close']);
  const b = connect('wss://nonexistent.invalid/');
  await b.done;
  assertEqual(b.events, ['error', 'close']);
});

test('timeoutMs stops a handshake that hangs', async () => {
  const t0 = performance.now();
  const c = connect(WSS + '/hang', { timeoutMs: 500 });
  await c.done;
  assertEqual(c.events, ['error', 'close']);
  assert(performance.now() - t0 < 2500, 'fast');
});

test('timeoutMs covers the handshake only', async () => {
  const c = connect(WSS + '/echo', { timeoutMs: 1000 });
  await c.opened;
  await sleep(2500);
  send(c.id, 'still here', false);
  await c.until(1);
  assertEqual(c.messages, ['still here']);
  close(c.id, 1000, '');
  await c.done;
});

test('a server that does not answer our close frame', async () => {
  const c = connect(WSS + '/slow-close');
  await c.opened;
  const t0 = performance.now();
  close(c.id, 1000, 'going');
  await c.done;
  const ms = performance.now() - t0;
  assert(ms >= 4500 && ms < 7500, 'about 5 s: ' + ms);
  assertEqual([c.close.code, c.close.wasClean], [1006, false]);
});

test('the module answers a ping', async () => {
  const c = connect(WSS + '/ping');
  await c.until(1);
  assertEqual(c.messages, ['pong ok']);
  close(c.id, 1000, '');
  await c.done;
});

test('a ping and a close frame in pieces give one pong and the whole close', async () => {
  const c = connect(WSS + '/split');
  await c.done;
  assertEqual(c.messages, ['pongs:0123456789']);
  assertEqual([c.close.code, c.close.reason, c.close.wasClean], [4001, 'split reason', true]);
});

test('a protocol that the client did not offer fails the handshake', async () => {
  const a = connect(WSS + '/badproto', { protocols: ['ha'] });
  await a.done;
  assertEqual(a.events, ['error', 'close']);
  assertEqual([a.close.code, a.close.wasClean], [1006, false]);
  const b = connect(WSS + '/badproto');
  await b.done;
  assertEqual(b.events, ['error', 'close']);
});

test('send before open returns false, and abort gives no more events', async () => {
  const c = connect(WSS + '/echo');
  assertEqual(send(c.id, 'early', false), false);
  abort(c.id);
  await sleep(500);
  assertEqual(c.events, []);
  assertEqual(bufferedAmount(c.id), 0);
});

test('abort from inside a message handler stops the events', async () => {
  const types = [];
  const id = open({ url: WSS + '/many' }, (ev) => {
    types.push(ev.type);
    if (ev.type === 'message') abort(id);
  });
  await sleep(1000);
  assertEqual(types, ['open', 'message']);
});

test('bad arguments', () => {
  assertThrows(() => open({ url: WSS + '/echo' }, null), /TypeError/);
  assertThrows(() => open({ url: 'https://localhost:8444/echo' }, () => {}), /TypeError: .*ws/);
  assertThrows(() => open({ url: WSS + '/echo', protocols: ['a\r\nX: y'] }, () => {}), /TypeError/);
  assertThrows(() => open({}, () => {}), /TypeError: .*url/);
  assertThrows(() => send(999999, 'x', false), /TypeError/);
  assertThrows(() => send('a', 'x', false), /TypeError/);
});

await run();
