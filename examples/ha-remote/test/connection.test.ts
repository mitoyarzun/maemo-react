import { describe, expect, test } from 'vitest';
import { BACKOFF_MS, HaError, createConnection, type ConnectionEvent } from '../src/ha/connection.js';
import { FakeSocket, fakeTimers } from './fakes.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  FakeSocket.all = [];
  FakeSocket.constructError = null;
  const timers = fakeTimers();
  const events: ConnectionEvent[] = [];
  const conn = createConnection(
    { WebSocket: FakeSocket as unknown as typeof WebSocket, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    { url: 'ws://ha:8123/api/websocket', token: 'tok', onEvent: (e) => events.push(e) },
  );
  const socket = () => FakeSocket.all[FakeSocket.all.length - 1];
  const types = () => events.map((e) => e.type);
  // Connect and authenticate.
  const up = async () => {
    conn.start();
    await tick();
    socket().open();
    socket().serverSend({ type: 'auth_ok', ha_version: '2025.1.0' });
  };
  return { conn, timers, events, socket, types, up };
}

describe('connection', () => {
  test('connects, sends the auth message, and reports connected', async () => {
    const t = setup();
    t.conn.start();
    expect(t.types()).toEqual(['connecting']);
    await tick();
    expect(t.socket().url).toBe('ws://ha:8123/api/websocket');
    t.socket().open();
    expect(t.socket().last()).toEqual({ type: 'auth', access_token: 'tok' });
    expect(t.conn.isConnected()).toBe(false);
    t.socket().serverSend({ type: 'auth_ok', ha_version: '2025.1.0' });
    expect(t.conn.isConnected()).toBe(true);
    expect(t.events[1]).toEqual({ type: 'connected', haVersion: '2025.1.0' });
  });

  test('call resolves with the result and rejects with the error', async () => {
    const t = setup();
    await t.up();
    const a = t.conn.call({ type: 'config/area_registry/list' });
    const b = t.conn.call({ type: 'call_service', domain: 'light', service: 'nope' });
    expect(t.socket().sent.slice(1).map((s) => JSON.parse(s).id)).toEqual([1, 2]);
    t.socket().serverSend({ id: 2, type: 'result', success: false, error: { code: 'not_found', message: 'Service not found' } });
    t.socket().serverSend({ id: 1, type: 'result', success: true, result: [{ area_id: 'k' }] });
    expect(await a).toEqual([{ area_id: 'k' }]);
    await expect(b).rejects.toMatchObject({ name: 'HaError', code: 'not_found', message: 'Service not found' });
  });

  test('subscribe routes the events of its id', async () => {
    const t = setup();
    await t.up();
    const got: unknown[] = [];
    const p = t.conn.subscribe({ type: 'subscribe_entities' }, (e) => got.push(e));
    t.socket().serverSend({ id: 1, type: 'result', success: true, result: null });
    expect(await p).toBe(1);
    t.socket().serverSend({ id: 1, type: 'event', event: { a: {} } });
    t.socket().serverSend({ id: 7, type: 'event', event: { a: { x: 1 } } });
    expect(got).toEqual([{ a: {} }]);
  });

  test('call before connected rejects', async () => {
    const t = setup();
    await expect(t.conn.call({ type: 'ping' })).rejects.toBeInstanceOf(HaError);
  });

  test('a ping every 30 s; no pong in 10 s closes the socket and reconnects', async () => {
    const t = setup();
    await t.up();
    await t.timers.advance(30000);
    expect(t.socket().last()).toEqual({ id: 1, type: 'ping' });
    t.socket().serverSend({ id: 1, type: 'pong' });
    await t.timers.advance(30000);
    expect(t.socket().last()).toEqual({ id: 2, type: 'ping' });
    const first = t.socket();
    await t.timers.advance(10000);
    expect(first.closed).toBe(true);
    expect(t.events[t.events.length - 1]).toEqual({ type: 'disconnected', reason: 'No pong in 10 s', retryInMs: 1000 });
    await t.timers.advance(1000);
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
  });

  test('the back-off is 1, 2, 5, 10, 30, 30 s, and auth_ok resets it', async () => {
    const t = setup();
    t.conn.start();
    const waits: Array<number | null> = [];
    for (let i = 0; i < 6; i++) {
      await tick();
      t.socket().serverClose();
      const last = t.events[t.events.length - 1];
      waits.push(last.type === 'disconnected' ? last.retryInMs : -1);
      await t.timers.advance(30000);
    }
    expect(waits).toEqual([...BACKOFF_MS, 30000]);
    await tick();
    t.socket().open();
    t.socket().serverSend({ type: 'auth_ok', ha_version: '1' });
    t.socket().serverClose();
    const last = t.events[t.events.length - 1];
    expect(last.type === 'disconnected' && last.retryInMs).toBe(1000);
  });

  test('stop closes the socket and does not reconnect; start connects at once', async () => {
    const t = setup();
    await t.up();
    const pending = t.conn.call({ type: 'ping' });
    t.conn.stop();
    expect(t.socket().closed).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(HaError);
    expect(t.events[t.events.length - 1]).toEqual({ type: 'disconnected', reason: 'Stopped', retryInMs: null });
    await t.timers.advance(60000);
    expect(FakeSocket.all).toHaveLength(1);
    t.conn.start();
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
  });

  test('start during a back-off wait connects at once', async () => {
    const t = setup();
    t.conn.start();
    await tick();
    t.socket().serverClose();
    t.conn.start();
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
    expect(t.timers.pending()).toBe(0);
  });

  test('auth_invalid reports and stops the reconnects', async () => {
    const t = setup();
    t.conn.start();
    await tick();
    t.socket().open();
    t.socket().serverSend({ type: 'auth_invalid', message: 'Invalid access token or password' });
    expect(t.socket().closed).toBe(true);
    expect(t.events.slice(-2)).toEqual([
      { type: 'auth-invalid', message: 'Invalid access token or password' },
      { type: 'disconnected', reason: 'Authentication failed', retryInMs: null },
    ]);
    // The late close event of the server changes nothing.
    t.socket().serverClose(1000, '');
    t.conn.start();
    await tick();
    await t.timers.advance(60000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(t.events).toHaveLength(3);
  });

  test('a send that throws makes call reject with an HaError', async () => {
    const t = setup();
    await t.up();
    t.socket().sendError = new TypeError('unknown connection');
    await expect(t.conn.call({ type: 'ping' })).rejects.toBeInstanceOf(HaError);
  });

  test('a message that cannot be stringified throws its own error', async () => {
    const t = setup();
    await t.up();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(t.conn.call(cyclic)).rejects.toBeInstanceOf(TypeError);
  });

  test('a ping whose send throws closes the socket and reconnects', async () => {
    const t = setup();
    await t.up();
    const first = t.socket();
    first.sendError = new TypeError('unknown connection');
    await t.timers.advance(30000);
    expect(first.closed).toBe(true);
    expect(t.events[t.events.length - 1]).toEqual({ type: 'disconnected', reason: 'Ping failed', retryInMs: 1000 });
    await t.timers.advance(1000);
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
  });

  test('stop during a back-off wait reports Stopped and cancels the retry', async () => {
    const t = setup();
    t.conn.start();
    await tick();
    t.socket().serverClose();
    t.conn.stop();
    expect(t.events[t.events.length - 1]).toEqual({ type: 'disconnected', reason: 'Stopped', retryInMs: null });
    await t.timers.advance(60000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('a WebSocket constructor that throws starts the back-off', async () => {
    const t = setup();
    FakeSocket.constructError = new SyntaxError('bad url');
    t.conn.start();
    expect(t.events[t.events.length - 1]).toEqual({ type: 'disconnected', reason: 'bad url', retryInMs: 1000 });
    FakeSocket.constructError = null;
    await t.timers.advance(1000);
    await tick();
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('a binary or broken message is ignored', async () => {
    const t = setup();
    await t.up();
    t.socket().onmessage?.({ data: new ArrayBuffer(2) } as MessageEvent<ArrayBuffer>);
    t.socket().onmessage?.({ data: '{not json' } as MessageEvent<string>);
    expect(t.conn.isConnected()).toBe(true);
  });
});
