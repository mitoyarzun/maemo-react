import { describe, expect, test } from 'vitest';
import { TOKEN_REJECTED } from '../src/ha/auth.js';
import { PAUSE_AFTER_MS, PENDING_MS, SNAPSHOT_EVERY_MS, createStore, type State } from '../src/ha/store.js';
import type { StatesEvent } from '../src/ha/types.js';
import { FakeSocket, fakeStorage, fakeTimers } from './fakes.js';
import registries from './fixtures/registries.json';
import states from './fixtures/states.json';

const S = 'http://ha:8123';
const NOW = 1_700_000_000_000;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ticks = async (n = 5) => {
  for (let i = 0; i < n; i++) await tick();
};

// A fake fetch: one answer for each URL suffix, in order of the calls to that suffix.
function fakeFetch(script: Record<string, unknown[]>) {
  const calls: Array<{ url: string; auth: string }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, auth: new Headers(init?.headers).get('authorization') ?? '' });
    const key = Object.keys(script).find((k) => u.endsWith(k));
    const a = key ? script[key].shift() : undefined;
    if (a === undefined) throw new TypeError('Failed to fetch', { cause: new Error('no answer for ' + u) });
    if (a instanceof Error) throw a;
    const { status, ...body } = a as { status?: number };
    return new Response(JSON.stringify(body), { status: status ?? 200 });
  }) as typeof fetch;
  return { fetch, calls };
}

// Answer the registry commands and the subscription like Home Assistant.
function serve(socket: FakeSocket, firstEvent: StatesEvent = states as StatesEvent) {
  const answered = new Set<number>();
  for (const text of socket.sent) {
    const m = JSON.parse(text);
    if (typeof m.id !== 'number' || answered.has(m.id)) continue;
    answered.add(m.id);
    if (m.type === 'config/area_registry/list') socket.serverSend({ id: m.id, type: 'result', success: true, result: registries.areas });
    else if (m.type === 'config/device_registry/list') socket.serverSend({ id: m.id, type: 'result', success: true, result: registries.devices });
    else if (m.type === 'config/entity_registry/list_for_display') socket.serverSend({ id: m.id, type: 'result', success: true, result: registries.display });
    else if (m.type === 'subscribe_entities') {
      socket.serverSend({ id: m.id, type: 'result', success: true, result: null });
      socket.serverSend({ id: m.id, type: 'event', event: firstEvent });
    }
  }
  return answered;
}

function setup(init: Record<string, string> = {}, script: Record<string, unknown[]> = {}) {
  FakeSocket.all = [];
  const timers = fakeTimers();
  const storage = fakeStorage(init);
  const f = fakeFetch(script);
  const banners: string[] = [];
  let now = NOW;
  const store = createStore({
    fetch: f.fetch,
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    storage: storage as unknown as Storage,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => now,
    banner: (t) => banners.push(t),
    versions: { app: '0.1.0', runtime: '0.3.0' },
  });
  let notifications = 0;
  store.subscribe(() => notifications++);
  const socket = () => FakeSocket.all[FakeSocket.all.length - 1];
  const st = () => store.getState();
  const row = (id: string) => st().pages.flatMap((p) => p.rows).find((r) => r.key === id);
  const page = (key: string) => st().pages.find((p) => p.key === key);
  const subId = () => JSON.parse(socket().sent.find((s) => JSON.parse(s).type === 'subscribe_entities')!).id as number;
  /** Answer each ping at once, so a long advance of the clock does not drop the socket. */
  const autoPong = (s: FakeSocket) => {
    const send = s.send.bind(s);
    s.send = (data: string) => {
      send(data);
      const m = JSON.parse(String(data));
      // Later, as a real server: the connection registers the ping after send() returns.
      if (m.type === 'ping') void Promise.resolve().then(() => s.serverSend({ id: m.id, type: 'pong' }));
    };
  };
  /** Open the socket, authenticate, and serve the registries and the first event. */
  const up = async () => {
    await ticks();
    autoPong(socket());
    socket().open();
    socket().serverSend({ type: 'auth_ok', ha_version: '2025.1.0' });
    await ticks();
    serve(socket());
    await ticks();
    serve(socket());
    await ticks();
  };
  const signedIn = async () => {
    store.start();
    await store.signIn(S, 'tok');
    await up();
  };
  return { store, timers, storage, f, banners, socket, st, row, page, subId, up, signedIn, count: () => notifications, setNow: (t: number) => (now = t) };
}

/** The answer of GET /api/ to a good token. */
const API = () => ({ '/api/': [{ message: 'API running.' }] });

describe('start', () => {
  test('without a token: the sign-in screen with the saved server', () => {
    const t = setup({ 'ha.server': S });
    t.store.start();
    expect(t.st().screen).toBe('signin');
    expect(t.st().signin.server).toBe(S);
    expect(FakeSocket.all).toHaveLength(0);
  });

  test('with a snapshot: the main screen at once, offline, then connect', async () => {
    const snapshot = {
      areas: [{ id: 'kitchen', name: 'Kitchen' }],
      entities: [{ id: 'switch.fan', domain: 'switch', name: 'Fan', areaId: 'kitchen', state: 'on', attrs: { friendly_name: 'Fan' } }],
      haVersion: '2024.12.0',
    };
    const t = setup({ 'ha.server': S, 'ha.token': 'tok', 'ha.snapshot': JSON.stringify(snapshot) });
    t.store.start();
    expect([t.st().screen, t.st().status, t.st().haVersion]).toEqual(['main', 'connecting', '2024.12.0']);
    expect(t.st().pages.map((p) => p.name)).toEqual(['Kitchen']);
    expect(t.row('switch.fan')).toEqual({ key: 'switch.fan', name: 'Fan', state: 'On', on: null });
    await t.up();
    expect(t.st().status).toBe('connected');
    expect(t.row('switch.fan')).toMatchObject({ state: 'Off', on: false });
    expect(t.st().pages.map((p) => p.name)).toEqual(['Living room', 'Kitchen', 'Other']);
  });
});

describe('sign-in', () => {
  test('signIn checks the token, stores the server and the token, shows main, and connects', async () => {
    const t = setup({}, API());
    await t.signedIn();
    expect(t.f.calls).toEqual([{ url: S + '/api/', auth: 'Bearer tok' }]);
    expect(t.storage.getItem('ha.server')).toBe(S);
    expect(t.storage.getItem('ha.token')).toBe('tok');
    expect(t.socket().sent[0]).toBe(JSON.stringify({ type: 'auth', access_token: 'tok' }));
    expect([t.st().screen, t.st().status, t.st().haVersion]).toEqual(['main', 'connected', '2025.1.0']);
    expect(t.socket().url).toBe('ws://ha:8123/api/websocket');
    expect(t.st().pages.map((p) => p.key)).toEqual(['living_room', 'kitchen', 'other']);
    expect(t.st().pageRows.map((p) => p.name)).toEqual(['Living room', 'Kitchen', 'Other']);
    expect(t.page('living_room')!.rows.map((r) => r.name)).toEqual(['Blinds', 'Ceiling light', 'Desk', 'Thermostat']);
    expect(t.row('light.ceiling')).toEqual({ key: 'light.ceiling', name: 'Ceiling light', state: 'On 50 %', on: true });
    expect(t.st().selectedPage).toBe('living_room');
    expect(t.st().lastUpdate).toBe(NOW);
  });

  test('a pasted token loses its spaces and line breaks, and a URL with a path keeps only the origin', async () => {
    const t = setup({}, API());
    t.store.start();
    await t.store.signIn(' https://x.ui.nabu.casa/lovelace/0 ', '  tok\n');
    expect(t.f.calls).toEqual([{ url: 'https://x.ui.nabu.casa/api/', auth: 'Bearer tok' }]);
    expect(t.storage.getItem('ha.server')).toBe('https://x.ui.nabu.casa');
    expect(t.storage.getItem('ha.token')).toBe('tok');
    expect(t.socket().url).toBe('wss://x.ui.nabu.casa/api/websocket');
  });

  test('a token that Home Assistant refuses keeps the screen and shows the message', async () => {
    const t = setup({}, { '/api/': [{ status: 401, message: '401: Unauthorized' }] });
    t.store.start();
    await t.store.signIn('ha:8123', 'bad');
    expect(t.st().screen).toBe('signin');
    expect(t.st().signin).toEqual({ server: S, error: TOKEN_REJECTED, busy: false });
    expect(t.storage.getItem('ha.token')).toBeNull();
    expect(FakeSocket.all).toHaveLength(0);
  });

  test('a bad URL or an empty token shows the message without a request; no answer shows the network error', async () => {
    const t = setup();
    t.store.start();
    await t.store.signIn('', 'tok');
    expect(t.st().signin.error).toBe('Type the server URL');
    await t.store.signIn(S, ' \n');
    expect(t.st().signin.error).toBe('Paste the token');
    expect(t.f.calls).toHaveLength(0);
    await t.store.signIn(S, 'tok');
    expect(t.st().signin).toEqual({ server: S, error: 'The server did not answer', busy: false });
  });
});

describe('live state', () => {
  test('one notification per message, and the unchanged rows and pages keep their objects', async () => {
    const t = setup({}, API());
    await t.signedIn();
    const before = t.st();
    const desk = t.row('light.desk');
    const kitchen = t.page('kitchen');
    const n = t.count();
    t.socket().serverSend({ id: t.subId(), type: 'event', event: { c: { 'light.ceiling': { '+': { s: 'off', a: { brightness: 0 } } } } } });
    expect(t.count()).toBe(n + 1);
    expect(t.row('light.ceiling')).toMatchObject({ state: 'Off', on: false });
    expect(t.row('light.desk')).toBe(desk);
    expect(t.page('kitchen')).toBe(kitchen);
    expect(t.page('living_room')).not.toBe(before.pages[0]);
    expect(t.st().pageRows).toBe(before.pageRows);
  });

  test('a removed entity goes away, and the selection of a removed entity clears', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.selectEntity('switch.fan');
    t.socket().serverSend({ id: t.subId(), type: 'event', event: { r: ['switch.fan'] } });
    expect(t.row('switch.fan')).toBeUndefined();
    expect(t.st().pages.map((p) => p.key)).toEqual(['living_room', 'other']);
    expect(t.st().selectedEntity).toBeNull();
  });

  test('toggle sends the call, marks the row pending, and the new state clears it', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.toggle('light.ceiling');
    const sent = JSON.parse(t.socket().sent[t.socket().sent.length - 1]);
    expect(sent).toMatchObject({ type: 'call_service', domain: 'light', service: 'toggle', target: { entity_id: 'light.ceiling' } });
    expect(t.row('light.ceiling')!.state).toBe('On 50 % ...');
    expect(t.st().pending.has('light.ceiling')).toBe(true);
    t.socket().serverSend({ id: sent.id, type: 'result', success: true, result: { context: {} } });
    t.socket().serverSend({ id: t.subId(), type: 'event', event: { c: { 'light.ceiling': { '+': { s: 'off' } } } } });
    expect(t.row('light.ceiling')!.state).toBe('Off');
    expect(t.st().pending.size).toBe(0);
    await t.timers.advance(PENDING_MS);
    expect(t.banners).toEqual([]);
  });

  test('no state change in 5 s shows a banner and clears the pending mark', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.toggle('switch.fan');
    await t.timers.advance(PENDING_MS);
    expect(t.banners).toEqual(['Home Assistant did not answer']);
    expect(t.row('switch.fan')!.state).toBe('Off');
  });

  test('a call_service error shows a banner with the message of Home Assistant', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setMode('climate.thermostat', 'dry');
    const sent = JSON.parse(t.socket().sent[t.socket().sent.length - 1]);
    expect(sent).toMatchObject({ domain: 'climate', service: 'set_hvac_mode', service_data: { hvac_mode: 'dry' } });
    t.socket().serverSend({ id: sent.id, type: 'result', success: false, error: { code: 'invalid_format', message: 'value must be one of [off, heat, cool]' } });
    await ticks();
    expect(t.banners).toEqual(['value must be one of [off, heat, cool]']);
    expect(t.st().pending.size).toBe(0);
  });

  test('the other actions send their calls', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setBrightness('light.ceiling', 75);
    t.store.stepTemperature('climate.thermostat', 1);
    t.store.cover('cover.blinds', 'close');
    t.store.setPosition('cover.blinds', 30);
    t.store.toggle('climate.thermostat');
    const sent = t.socket().sent.slice(-4).map((s) => JSON.parse(s));
    expect(sent.map((m) => [m.service, m.service_data])).toEqual([
      ['turn_on', { brightness_pct: 75 }],
      ['set_temperature', { temperature: 21.5 }],
      ['close_cover', undefined],
      ['set_cover_position', { position: 30 }],
    ]);
  });

  test('a disconnect hides the toggles and shows offline; a reconnect brings them back', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.socket().serverClose();
    expect(t.st().status).toBe('offline');
    expect(t.row('light.ceiling')).toMatchObject({ state: 'On 50 %', on: null });
    await t.timers.advance(1000);
    await t.up();
    expect(t.st().status).toBe('connected');
    expect(t.row('light.ceiling')!.on).toBe(true);
  });

  test('the snapshot is written 10 s after a change, with the small attributes only', async () => {
    const t = setup({}, API());
    await t.signedIn();
    expect(t.storage.getItem('ha.snapshot')).toBeNull();
    await t.timers.advance(SNAPSHOT_EVERY_MS);
    const snap = JSON.parse(t.storage.getItem('ha.snapshot')!);
    expect(snap.areas.map((a: { id: string }) => a.id)).toEqual(['living_room', 'kitchen', 'garage']);
    expect(snap.haVersion).toBe('2025.1.0');
    const ceiling = snap.entities.find((e: { id: string }) => e.id === 'light.ceiling');
    expect(ceiling).toMatchObject({ domain: 'light', areaId: 'living_room', state: 'on', attrs: { friendly_name: 'Ceiling light', brightness: 128 } });
    expect(ceiling.attrs).not.toHaveProperty('color_mode');
  });
});

describe('favorites', () => {
  test('setFavorite adds the Favorites page first, in the order added, and persists', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setFavorite('switch.fan', true);
    t.store.setFavorite('light.ceiling', true);
    expect(t.st().pages[0].key).toBe('favorites');
    expect(t.st().pages[0].rows.map((r) => r.key)).toEqual(['switch.fan', 'light.ceiling']);
    expect(t.row('switch.fan')).toBe(t.page('kitchen')!.rows[0]);
    expect(JSON.parse(t.storage.getItem('ha.favorites')!)).toEqual(['switch.fan', 'light.ceiling']);
    t.store.setFavorite('switch.fan', false);
    expect(t.st().pages[0].rows.map((r) => r.key)).toEqual(['light.ceiling']);
  });

  test('a removed favorite stays in storage and shows nothing', async () => {
    const t = setup({ 'ha.favorites': JSON.stringify(['switch.fan', 'light.gone']) }, API());
    await t.signedIn();
    expect(t.st().pages[0].rows.map((r) => r.key)).toEqual(['switch.fan']);
    t.socket().serverSend({ id: t.subId(), type: 'event', event: { r: ['switch.fan'] } });
    expect(t.st().pages[0].key).not.toBe('favorites');
    expect(JSON.parse(t.storage.getItem('ha.favorites')!)).toEqual(['switch.fan', 'light.gone']);
  });
});

describe('the token and sign-out', () => {
  test('auth_invalid deletes the token and shows the sign-in screen with the server URL; no reconnect', async () => {
    const t = setup({ 'ha.server': S, 'ha.token': 'old', 'ha.favorites': '["switch.fan"]' });
    t.store.start();
    await ticks();
    t.socket().open();
    expect(t.socket().sent[0]).toBe(JSON.stringify({ type: 'auth', access_token: 'old' }));
    t.socket().serverSend({ type: 'auth_invalid', message: 'Invalid access token or password' });
    t.socket().serverClose(1000);
    await t.timers.advance(60000);
    await ticks();
    expect(t.st().screen).toBe('signin');
    expect(t.st().signin).toEqual({ server: S, error: TOKEN_REJECTED, busy: false });
    expect(t.storage.getItem('ha.token')).toBeNull();
    expect(t.storage.getItem('ha.server')).toBe(S);
    expect(t.storage.getItem('ha.favorites')).toBe('["switch.fan"]');
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('signOut deletes the token and the snapshot, sends no request, and keeps the server and the favorites', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setFavorite('switch.fan', true);
    await t.timers.advance(SNAPSHOT_EVERY_MS);
    const requests = t.f.calls.length;
    t.store.signOut();
    expect(t.f.calls).toHaveLength(requests);
    expect([t.st().screen, t.st().status, t.st().pages.length]).toEqual(['signin', 'offline', 0]);
    expect(t.st().signin).toEqual({ server: S, error: null, busy: false });
    expect(t.storage.all()).toEqual({ 'ha.server': S, 'ha.favorites': '["switch.fan"]' });
    expect(t.socket().closed).toBe(true);
  });
});

describe('topmost', () => {
  test('60 s behind another window closes the socket; coming back connects at once', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setTopmost(false);
    await t.timers.advance(PAUSE_AFTER_MS - 1);
    expect(t.socket().closed).toBe(false);
    await t.timers.advance(1);
    expect(t.socket().closed).toBe(true);
    expect(t.st().status).toBe('offline');
    expect(t.storage.getItem('ha.snapshot')).not.toBeNull();
    t.store.setTopmost(true);
    await ticks();
    expect(FakeSocket.all).toHaveLength(2);
  });

  test('coming back before 60 s keeps the socket', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setTopmost(false);
    await t.timers.advance(30000);
    t.store.setTopmost(true);
    await t.timers.advance(60000);
    expect(t.socket().closed).toBe(false);
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('reconnect from the menu connects at once during a back-off wait', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.socket().serverClose();
    t.store.reconnect();
    await ticks();
    expect(FakeSocket.all).toHaveLength(2);
  });
});

describe('screens', () => {
  test('about and back', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.showAbout();
    expect(t.st().screen).toBe('about');
    t.store.showMain();
    expect(t.st().screen).toBe('main');
    const s: State = t.st();
    expect(s.versions).toEqual({ app: '0.1.0', runtime: '0.3.0' });
  });
});

describe('contracts of the connection', () => {
  const sentTypes = (s: FakeSocket) => s.sent.map((x) => JSON.parse(x).type);

  test('each connect subscribes again, and the first event of a reconnect replaces the entities', async () => {
    const t = setup({}, API());
    await t.signedIn();
    expect(sentTypes(t.socket()).filter((x) => x === 'subscribe_entities')).toHaveLength(1);
    expect(t.row('switch.fan')).toBeDefined();
    t.socket().serverClose();
    await t.timers.advance(1000);
    await ticks();
    const second = t.socket();
    expect(FakeSocket.all).toHaveLength(2);
    autoPongAndOpen(second);
    await ticks();
    serve(second, { a: { 'light.ceiling': { s: 'on', a: { friendly_name: 'Ceiling light' } } } } as unknown as StatesEvent);
    await ticks();
    serve(second, { a: { 'light.ceiling': { s: 'on', a: { friendly_name: 'Ceiling light' } } } } as unknown as StatesEvent);
    await ticks();
    expect(sentTypes(second)).toEqual(expect.arrayContaining(['config/area_registry/list', 'config/device_registry/list', 'config/entity_registry/list_for_display', 'subscribe_entities']));
    expect(t.st().entities.size).toBe(1);
    expect(t.row('switch.fan')).toBeUndefined();
    expect(t.row('light.ceiling')).toBeDefined();
    expect(t.st().status).toBe('connected');
  });

  test('after auth_invalid the disconnected event keeps the sign-in screen and its message', async () => {
    const t = setup({ 'ha.server': S, 'ha.token': 'old' });
    t.store.start();
    await ticks();
    t.socket().open();
    t.socket().serverSend({ type: 'auth_invalid', message: 'no' });
    await ticks();
    expect([t.st().screen, t.st().status]).toEqual(['signin', 'offline']);
    expect(t.st().signin).toEqual({ server: S, error: TOKEN_REJECTED, busy: false });
  });

  test('a new sign-in makes a new connection and the old one has no effect', async () => {
    const t = setup({}, { '/api/': [{ message: 'ok' }, { message: 'ok' }] });
    await t.signedIn();
    const first = t.socket();
    await t.store.signIn(S, 'tok2');
    await ticks();
    expect(FakeSocket.all).toHaveLength(2);
    expect(first.closed).toBe(true);
    t.socket().open();
    expect(t.socket().sent[0]).toBe(JSON.stringify({ type: 'auth', access_token: 'tok2' }));
    expect(t.storage.getItem('ha.token')).toBe('tok2');
    expect([t.st().screen, t.st().status]).toEqual(['main', 'connecting']);
    first.serverSend({ type: 'auth_invalid', message: 'late' });
    expect(t.st().screen).toBe('main');
  });

  test('the window is on top at the start: topmost true without a change does nothing', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setTopmost(true);
    await t.timers.advance(PAUSE_AFTER_MS * 2);
    expect(t.socket().closed).toBe(false);
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('an event with no real change keeps every row and page object', async () => {
    const t = setup({}, API());
    await t.signedIn();
    const pages = t.st().pages;
    const n = t.count();
    t.socket().serverSend({ id: t.subId(), type: 'event', event: { c: { 'light.desk': { '+': { lu: 1 } } } } });
    expect(t.count()).toBe(n + 1);
    expect(t.st().pages).toEqual(pages);
    for (let i = 0; i < pages.length; i++) expect(t.st().pages[i]).toBe(pages[i]);
  });
});

/** Open a second socket and answer its pings. */
function autoPongAndOpen(s: FakeSocket) {
  const send = s.send.bind(s);
  s.send = (data: string) => {
    send(data);
    const m = JSON.parse(String(data));
    if (m.type === 'ping') void Promise.resolve().then(() => s.serverSend({ id: m.id, type: 'pong' }));
  };
  s.open();
  s.serverSend({ type: 'auth_ok', ha_version: '2025.1.0' });
}
