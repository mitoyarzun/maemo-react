import { describe, expect, test } from 'vitest';
import { CloseEvent, MessageEvent, createWebSocket } from '../src/websocket.js';

// A fake maemo:ws. The test sends the events itself.
function fakeWs() {
  const ws = {
    calls: [],
    sent: [],
    closed: [],
    aborted: [],
    buffered: 0,
    open(opts, cb) {
      ws.calls.push({ opts, cb });
      return ws.calls.length;
    },
    send(id, data, binary) {
      ws.sent.push({ id, data, binary });
    },
    close(id, code, reason) {
      ws.closed.push({ id, code, reason });
    },
    abort(id) {
      ws.aborted.push(id);
    },
    bufferedAmount() {
      return ws.buffered;
    },
  };
  return ws;
}

function setup(url = 'wss://e.com/api/websocket', protocols) {
  const ws = fakeWs();
  const WebSocket = createWebSocket(ws);
  const s = new WebSocket(url, protocols);
  const events = [];
  for (const type of ['open', 'message', 'error', 'close']) s.addEventListener(type, (e) => events.push(e));
  const cb = ws.calls[0].cb;
  return { ws, WebSocket, s, events, cb, open: (protocol = '') => cb({ type: 'open', protocol }) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WebSocket', () => {
  test('the constructor opens the connection with the URL and the protocols', () => {
    const { ws, s } = setup('wss://e.com/api/websocket', ['a', 'b']);
    expect(ws.calls[0].opts).toEqual({ url: 'wss://e.com/api/websocket', protocols: ['a', 'b'] });
    expect([s.readyState, s.url, s.protocol, s.extensions, s.bufferedAmount]).toEqual([0, 'wss://e.com/api/websocket', '', '', 0]);
  });

  test('a string protocol is one protocol', () => {
    const { ws } = setup('ws://e.com/', 'one');
    expect(ws.calls[0].opts.protocols).toEqual(['one']);
  });

  test('an http or https URL becomes ws or wss', () => {
    expect(setup('http://h:8123/api/websocket').s.url).toBe('ws://h:8123/api/websocket');
    expect(setup('https://h/api/websocket').s.url).toBe('wss://h/api/websocket');
  });

  test('bad URLs and protocols throw SyntaxError', () => {
    const WebSocket = createWebSocket(fakeWs());
    for (const url of ['ftp://e.com/', 'not a url', 'ws://e.com/#frag']) {
      expect(() => new WebSocket(url)).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    }
    expect(() => new WebSocket('ws://e.com/', 'a b')).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(() => new WebSocket('ws://e.com/', ['a', 'A'])).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
  });

  test('open sets OPEN and the protocol, and fires onopen and the listeners', () => {
    const { s, events, open } = setup('wss://e.com/', ['a']);
    let n = 0;
    s.onopen = () => n++;
    open('a');
    expect([s.readyState, s.protocol, n, events.map((e) => e.type)]).toEqual([1, 'a', 1, ['open']]);
  });

  test('a protocol that the client did not request fails the connection', () => {
    const { ws, s, events, open } = setup('wss://e.com/', ['a']);
    open('zzz');
    expect(ws.aborted).toEqual([1]);
    expect(events.map((e) => e.type)).toEqual(['error', 'close']);
    expect([events[1].code, events[1].wasClean, s.readyState]).toEqual([1006, false, 3]);
  });

  test('send before open throws InvalidStateError', () => {
    const { s } = setup();
    expect(() => s.send('x')).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  test('send encodes strings, ArrayBuffers, views and other values', () => {
    const { ws, s, open } = setup();
    open();
    s.send('hi');
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer;
    s.send(buf);
    s.send(new Uint8Array(buf, 2, 3));
    s.send(42);
    expect(ws.sent[0]).toEqual({ id: 1, data: 'hi', binary: false });
    expect(ws.sent[1].binary).toBe(true);
    expect(ws.sent[1].data.byteLength).toBe(10);
    expect(ws.sent[3]).toEqual({ id: 1, data: '42', binary: false });
  });

  test('send of a view sends only the bytes of the view', () => {
    const { ws, s, open } = setup();
    open();
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer;
    s.send(new Uint8Array(buf, 2, 3));
    expect(ws.sent[0].binary).toBe(true);
    expect(Array.from(new Uint8Array(ws.sent[0].data))).toEqual([3, 4, 5]);
  });

  test('messages arrive as MessageEvent with data and origin', () => {
    const { s, cb, events, open } = setup('wss://e.com:8443/api');
    open();
    let seen = null;
    s.onmessage = (e) => (seen = e);
    cb({ type: 'message', data: 'text' });
    const bin = new Uint8Array([7]).buffer;
    cb({ type: 'message', data: bin });
    expect(seen).toBeInstanceOf(MessageEvent);
    const messages = events.filter((e) => e.type === 'message');
    expect(messages.map((e) => e.data)).toEqual(['text', bin]);
    expect(messages[0].origin).toBe('wss://e.com:8443');
  });

  test('close validates the code and the reason', () => {
    const { ws, s, open } = setup();
    open();
    expect(() => s.close(1001)).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    expect(() => s.close(1000, 'x'.repeat(124))).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    s.close(3000, 'ok');
    expect(ws.closed).toEqual([{ id: 1, code: 3000, reason: 'ok' }]);
    expect(s.readyState).toBe(2);
    s.close();
    expect(ws.closed).toHaveLength(1);
  });

  test('close without a code sends 0 and no reason', () => {
    const { ws, s, open } = setup();
    open();
    s.close();
    expect(ws.closed).toEqual([{ id: 1, code: 0, reason: '' }]);
  });

  test('close before open aborts, then fires error and close 1006', async () => {
    const { ws, s, events } = setup();
    s.close();
    expect([ws.aborted, s.readyState]).toEqual([[1], 2]);
    await tick();
    expect(events.map((e) => e.type)).toEqual(['error', 'close']);
    expect(events[1]).toBeInstanceOf(CloseEvent);
    expect([events[1].code, events[1].wasClean, events[1].reason, s.readyState]).toEqual([1006, false, '', 3]);
  });

  test('no message after close()', () => {
    const { s, cb, events, open } = setup();
    open();
    s.close();
    cb({ type: 'message', data: 'late' });
    expect(events.map((e) => e.type)).toEqual(['open']);
  });

  test('the close event carries code, reason and wasClean; a second one is ignored', () => {
    const { s, cb, events, open } = setup();
    open();
    cb({ type: 'close', code: 4000, reason: 'bye', wasClean: true });
    cb({ type: 'close', code: 1006, reason: '', wasClean: false });
    expect(events.map((e) => e.type)).toEqual(['open', 'close']);
    expect([events[1].code, events[1].reason, events[1].wasClean, s.readyState]).toEqual([4000, 'bye', true, 3]);
  });

  test('an error event has the curl message, then close 1006', () => {
    const { s, cb, events } = setup();
    let seen = null;
    s.onerror = (e) => (seen = e);
    cb({ type: 'error', message: 'Could not resolve host: e.com' });
    cb({ type: 'close', code: 1006, reason: '', wasClean: false });
    expect(seen.message).toMatch(/resolve/);
    expect([events.map((e) => e.type), s.readyState]).toEqual([['error', 'close'], 3]);
  });

  test('send after close is dropped without an error', () => {
    const { ws, s, open } = setup();
    open();
    s.close();
    s.send('x');
    expect(ws.sent).toEqual([]);
  });

  test('binaryType is arraybuffer only', () => {
    const { s } = setup();
    expect(s.binaryType).toBe('arraybuffer');
    expect(() => (s.binaryType = 'blob')).toThrow(TypeError);
  });

  test('bufferedAmount reads the module while the connection is open', () => {
    const { ws, s, open } = setup();
    ws.buffered = 5;
    expect(s.bufferedAmount).toBe(0);
    open();
    expect(s.bufferedAmount).toBe(5);
  });

  test('the constants are on the class and on the instances', () => {
    const { WebSocket, s } = setup();
    expect([WebSocket.CONNECTING, WebSocket.OPEN, WebSocket.CLOSING, WebSocket.CLOSED]).toEqual([0, 1, 2, 3]);
    expect([s.CONNECTING, s.OPEN, s.CLOSING, s.CLOSED]).toEqual([0, 1, 2, 3]);
  });

  test('a close without a preceding error is a clean close event', () => {
    const { s, cb, events, open } = setup();
    open();
    s.close(1000);
    cb({ type: 'close', code: 1006, reason: '', wasClean: false });
    expect(events.map((e) => e.type)).toEqual(['open', 'close']);
    expect([events[1].code, events[1].wasClean, s.readyState]).toEqual([1006, false, 3]);
  });

  test('send is dropped when the module returns false', () => {
    const { ws, s, events, open } = setup();
    open();
    ws.send = () => false;
    expect(() => s.send('x')).not.toThrow();
    expect(events.map((e) => e.type)).toEqual(['open']);
  });

  test('a TypeError from the module send is not hidden', () => {
    const { ws, s, open } = setup();
    open();
    ws.send = () => {
      throw new TypeError('detached');
    };
    expect(() => s.send(new ArrayBuffer(1))).toThrow(TypeError);
  });

  test('close fires even when onerror throws', () => {
    const { ws, s, events, open } = setup('wss://e.com/', ['a']);
    s.onerror = () => {
      throw new Error('handler');
    };
    let closed = 0;
    s.onclose = () => closed++;
    expect(() => open('zzz')).toThrow('handler');
    expect([closed, events.map((e) => e.type)]).toEqual([1, ['close']]);
    expect([s.readyState, ws.aborted]).toEqual([3, [1]]);
  });

  test('close rejects a reason without a code and a code that is not an integer', () => {
    const { ws, s, open } = setup();
    open();
    expect(() => s.close(undefined, 'why')).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    expect(() => s.close(3000.5)).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    expect(() => s.close(NaN)).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    expect(ws.closed).toEqual([]);
    expect(s.readyState).toBe(1);
  });
});
