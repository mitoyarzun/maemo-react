// The state of the application (HA spec section 3): one object, listeners
// for useSyncExternalStore, and one notification per Home Assistant
// message. No React, no GTK: the tests give fakes for fetch, WebSocket,
// localStorage and the timers.
import { brightnessCall, coverCall, modeCall, positionCall, temperatureCall, toggleCall } from './actions.js';
import { TOKEN_REJECTED, checkToken, clearToken, messageOf, normalizeServer, normalizeToken, readCredentials, saveCredentials, socketUrl } from './auth.js';
import { HaError, createConnection, type Connection, type ConnectionEvent } from './connection.js';
import { FAVORITES, OTHER, applyStates, emptyRegistries, makeRow, pageKeysOf, pageName, parseAreas, parseDevices, parseDisplay, placeAgain, sortRows, type Registries } from './model.js';
import type { Area, Entity, Page, PageRow, Row, ServiceCall, StatesEvent } from './types.js';

/** A service call with no new state in this time shows a banner (HA spec section 3). */
export const PENDING_MS = 5000;
/** The window is behind another one for this long: close the socket (HA spec section 4). */
export const PAUSE_AFTER_MS = 60000;
/** The snapshot is written at most this often. */
export const SNAPSHOT_EVERY_MS = 10000;
/** The attributes that the rows and the detail panel use. The snapshot keeps only these. */
export const SNAPSHOT_ATTRS = [
  'friendly_name', 'brightness', 'supported_color_modes', 'temperature', 'current_temperature', 'hvac_modes',
  'target_temp_step', 'min_temp', 'max_temp', 'current_position', 'supported_features',
];

export interface StoreDeps {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  storage: Storage;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  now: () => number;
  banner: (text: string) => void;
  versions: { app: string; runtime: string };
}

export type Screen = 'signin' | 'main' | 'about';
export type Status = 'offline' | 'connecting' | 'connected';

export interface SignInState {
  server: string;
  error: string | null;
  /** The token check (GET /api/) runs. */
  busy: boolean;
}

export interface State {
  screen: Screen;
  signin: SignInState;
  status: Status;
  lastUpdate: number | null;
  haVersion: string | null;
  pages: Page[];
  pageRows: PageRow[];
  selectedPage: string | null;
  selectedEntity: string | null;
  entities: Map<string, Entity>;
  favorites: string[];
  pending: ReadonlySet<string>;
  versions: { app: string; runtime: string };
}

export interface Store {
  subscribe(fn: () => void): () => void;
  getState(): State;
  /** Read the storage, show the snapshot, and connect when there is a token. */
  start(): void;
  /** Check the token with GET /api/; keep it and connect when Home Assistant accepts it. */
  signIn(server: string, token: string): Promise<void>;
  /** Delete the token from the storage. The token stays valid on the server until the user deletes it there. */
  signOut(): void;
  reconnect(): void;
  selectPage(key: string | null): void;
  selectEntity(id: string | null): void;
  toggle(id: string): void;
  setBrightness(id: string, pct: number): void;
  stepTemperature(id: string, direction: 1 | -1): void;
  setMode(id: string, mode: string): void;
  cover(id: string, action: 'open' | 'stop' | 'close'): void;
  setPosition(id: string, position: number): void;
  setFavorite(id: string, on: boolean): void;
  setTopmost(topmost: boolean): void;
  showAbout(): void;
  showMain(): void;
  /** Write the snapshot now. Call it before the application quits. */
  flush(): void;
}

interface Snapshot {
  areas: Area[];
  entities: Entity[];
  haVersion: string | null;
}

// ha.server and ha.token belong to auth.ts.
const KEYS = { favorites: 'ha.favorites', snapshot: 'ha.snapshot' };

function readJson(storage: Storage, key: string): unknown {
  const text = storage.getItem(key);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readFavorites(storage: Storage): string[] {
  const f = readJson(storage, KEYS.favorites);
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : [];
}

function readSnapshot(storage: Storage): Snapshot | null {
  const s = readJson(storage, KEYS.snapshot);
  if (!isObject(s) || !Array.isArray(s.areas) || !Array.isArray(s.entities)) return null;
  const entities = s.entities.filter((e): e is Entity => isObject(e) && typeof e.id === 'string' && typeof e.state === 'string' && isObject(e.attrs));
  return { areas: s.areas.filter((a): a is Area => isObject(a) && typeof a.id === 'string'), entities, haVersion: typeof s.haVersion === 'string' ? s.haVersion : null };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function createStore(deps: StoreDeps): Store {
  const listeners = new Set<() => void>();
  let state: State = {
    screen: 'signin',
    signin: { server: '', error: null, busy: false },
    status: 'offline',
    lastUpdate: null,
    haVersion: null,
    pages: [],
    pageRows: [],
    selectedPage: null,
    selectedEntity: null,
    entities: new Map(),
    favorites: [],
    pending: new Set(),
    versions: deps.versions,
  };

  const authDeps = { fetch: deps.fetch };
  let server = '';
  let token: string | null = null;
  let reg: Registries = emptyRegistries();
  let connection: Connection | null = null;
  let live = false; // the subscription is up: the toggles show
  let firstEvent = false; // the next states event replaces everything
  let paused = false;
  let pauseTimer: number | null = null;
  let snapshotTimer: number | null = null;
  let snapshotDirty = false;
  const rows = new Map<string, Row>();
  const rowPages = new Map<string, string[]>();
  const pageRowsByKey = new Map<string, Row[]>();
  const pendingTimers = new Map<string, number>();

  function notify() {
    for (const fn of listeners) fn();
  }

  function set(patch: Partial<State>) {
    state = { ...state, ...patch };
    notify();
  }

  // ---- rows and pages ----

  /**
   * Make the rows of the changed entities again, rebuild only the pages that
   * hold a changed row, and notify once. With all, every row is made again
   * (the toggles appear or go away).
   */
  function rebuild(entities: Map<string, Entity>, changed: Iterable<string>, all: boolean, extra: Partial<State> = {}, pending: ReadonlySet<string> = state.pending) {
    const favorites = extra.favorites ?? state.favorites;
    const favoriteSet = new Set(favorites);
    const dirty = new Set<string>();
    const ids = new Set<string>(all ? [...entities.keys(), ...rows.keys()] : changed);
    for (const id of ids) {
      const prevRow = rows.get(id) ?? null;
      const prevKeys = rowPages.get(id) ?? [];
      const e = entities.get(id);
      if (!e) {
        rows.delete(id);
        rowPages.delete(id);
        for (const k of prevKeys) dirty.add(k);
        continue;
      }
      const row = makeRow(e, live, pending.has(id), prevRow);
      const keys = pageKeysOf(e, favoriteSet);
      if (row !== prevRow || !sameList(keys, prevKeys)) {
        for (const k of keys) dirty.add(k);
        for (const k of prevKeys) dirty.add(k);
      }
      rows.set(id, row);
      rowPages.set(id, keys);
    }
    if (dirty.size > 0) {
      const lists = new Map<string, Row[]>();
      for (const k of dirty) lists.set(k, []);
      for (const [id, keys] of rowPages) {
        for (const k of keys) lists.get(k)?.push(rows.get(id)!);
      }
      for (const [k, list] of lists) {
        if (list.length === 0) pageRowsByKey.delete(k);
        else pageRowsByKey.set(k, sortRows(list, k === FAVORITES ? favorites : undefined));
      }
    }
    // The order: Favorites, the areas of the registry, areas that the registry does not know, Other.
    const order = [FAVORITES, ...reg.areas.map((a) => a.id)];
    for (const k of pageRowsByKey.keys()) if (k !== OTHER && !order.includes(k)) order.push(k);
    order.push(OTHER);
    const prevPages = new Map(state.pages.map((p) => [p.key, p]));
    const pages: Page[] = [];
    for (const k of order) {
      const list = pageRowsByKey.get(k);
      if (!list) continue;
      const name = pageName(k, reg.areas);
      const prev = prevPages.get(k);
      pages.push(prev && prev.rows === list && prev.name === name ? prev : { key: k, name, rows: list });
    }
    const samePageRows = pages.length === state.pageRows.length && pages.every((p, i) => p.key === state.pageRows[i].key && p.name === state.pageRows[i].name);
    const pageRows = samePageRows ? state.pageRows : pages.map((p) => ({ key: p.key, name: p.name }));
    let selectedPage = extra.selectedPage ?? state.selectedPage;
    if (selectedPage === null || !pages.some((p) => p.key === selectedPage)) selectedPage = pages.length ? pages[0].key : null;
    let selectedEntity = state.selectedEntity;
    if (selectedEntity !== null && !entities.has(selectedEntity)) selectedEntity = null;
    set({ ...extra, entities, pages, pageRows, selectedPage, selectedEntity, pending, favorites });
  }

  // ---- pending service calls ----

  function clearPending(pending: Set<string>, id: string): boolean {
    const timer = pendingTimers.get(id);
    if (timer !== undefined) {
      deps.clearTimeout(timer);
      pendingTimers.delete(id);
    }
    return pending.delete(id);
  }

  function callService(id: string, sc: ServiceCall | null) {
    const c = connection;
    if (!sc || !c || !live) return;
    const pending = new Set(state.pending);
    clearPending(pending, id);
    pending.add(id);
    pendingTimers.set(
      id,
      deps.setTimeout(() => {
        pendingTimers.delete(id);
        const p = new Set(state.pending);
        if (!p.delete(id)) return;
        deps.banner('Home Assistant did not answer');
        rebuild(state.entities, [id], false, {}, p);
      }, PENDING_MS),
    );
    rebuild(state.entities, [id], false, {}, pending);
    c.call({ type: 'call_service', domain: sc.domain, service: sc.service, service_data: sc.service_data, target: sc.target }).catch((e: unknown) => {
      const p = new Set(state.pending);
      if (!clearPending(p, id)) return;
      deps.banner(e instanceof HaError && e.code !== 'disconnected' ? e.message : 'Home Assistant did not answer');
      rebuild(state.entities, [id], false, {}, p);
    });
  }

  // ---- the snapshot ----

  function writeSnapshot() {
    if (!snapshotDirty) return;
    snapshotDirty = false;
    const entities: Entity[] = [];
    for (const e of state.entities.values()) {
      const attrs: Record<string, unknown> = {};
      for (const k of SNAPSHOT_ATTRS) if (k in e.attrs) attrs[k] = e.attrs[k];
      entities.push({ ...e, attrs });
    }
    const snapshot: Snapshot = { areas: reg.areas, entities, haVersion: state.haVersion };
    try {
      deps.storage.setItem(KEYS.snapshot, JSON.stringify(snapshot));
    } catch (e) {
      console.error('HA Remote: cannot save the snapshot:', messageOf(e));
    }
  }

  function scheduleSnapshot() {
    snapshotDirty = true;
    if (snapshotTimer !== null) return;
    snapshotTimer = deps.setTimeout(() => {
      snapshotTimer = null;
      writeSnapshot();
    }, SNAPSHOT_EVERY_MS);
  }

  // ---- the connection ----

  function onStates(event: unknown) {
    if (!isObject(event)) return;
    const base = firstEvent && isObject(event.a) ? new Map<string, Entity>() : state.entities;
    const all = firstEvent && isObject(event.a);
    firstEvent = false;
    const { entities, changed } = applyStates(base, event as StatesEvent, reg);
    const pending = new Set(state.pending);
    for (const id of changed) clearPending(pending, id);
    rebuild(entities, changed, all, { lastUpdate: deps.now() }, pending);
    scheduleSnapshot();
  }

  async function loadRegistries(c: Connection) {
    try {
      const [areas, devices, display] = await Promise.all([
        c.call({ type: 'config/area_registry/list' }),
        c.call({ type: 'config/device_registry/list' }),
        c.call({ type: 'config/entity_registry/list_for_display' }),
      ]);
      if (connection !== c) return;
      const d = parseDisplay(display);
      reg = { areas: parseAreas(areas), deviceArea: parseDevices(devices), display: d.display, hidden: d.hidden };
      firstEvent = true;
      // The subscription goes after the registries, so the first event is placed right away.
      await c.subscribe({ type: 'subscribe_entities' }, (event) => {
        if (connection === c) onStates(event);
      });
      if (connection !== c) return;
      live = true;
      rebuild(placeAgain(state.entities, reg), [], true, { lastUpdate: deps.now() });
    } catch (e) {
      // The socket closed: the next connect loads the registries again.
      console.error('HA Remote: cannot load the registries:', messageOf(e));
    }
  }

  function onConnectionEvent(ev: ConnectionEvent) {
    switch (ev.type) {
      case 'connecting':
        set({ status: 'connecting' });
        return;
      case 'connected':
        set({ status: 'connected', haVersion: ev.haVersion });
        if (connection) void loadRegistries(connection);
        return;
      case 'disconnected':
        live = false;
        rebuild(state.entities, [], true, { status: 'offline' }); // the toggles go away
        return;
      case 'auth-invalid':
        // There is no refresh: the user makes a new token (HA spec section 4).
        leave(TOKEN_REJECTED);
        return;
    }
  }

  function connect() {
    disconnect();
    if (token === null) return;
    // An old connection has no effect after a new sign-in or a sign-out.
    const c: Connection = createConnection(
      { WebSocket: deps.WebSocket, setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout },
      {
        url: socketUrl(server),
        token,
        onEvent: (ev) => {
          if (connection === c) onConnectionEvent(ev);
        },
      },
    );
    connection = c;
    c.start();
  }

  function disconnect() {
    const c = connection;
    connection = null;
    live = false;
    if (c) c.stop();
  }

  // ---- sign-in and sign-out ----

  function signedIn(t: string) {
    token = t;
    saveCredentials(deps.storage, server, t);
    set({ screen: 'main', signin: { server, error: null, busy: false } });
    connect();
  }

  /** Back to the sign-in screen. The token goes from the storage; the server URL and the favorites stay. */
  function leave(error: string | null) {
    if (pauseTimer !== null) {
      deps.clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    paused = false;
    disconnect();
    token = null;
    clearToken(deps.storage);
    deps.storage.removeItem(KEYS.snapshot);
    snapshotDirty = false;
    reg = emptyRegistries();
    rebuild(new Map(), [], true, { screen: 'signin', status: 'offline', haVersion: null, lastUpdate: null, signin: { server, error, busy: false } });
  }

  // ---- the store ----

  const store: Store = {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getState: () => state,

    start() {
      const saved = readCredentials(deps.storage);
      server = saved.server;
      token = saved.token;
      const favorites = readFavorites(deps.storage);
      const snapshot = token ? readSnapshot(deps.storage) : null;
      const screen: Screen = token ? 'main' : 'signin';
      const signin = { ...state.signin, server };
      if (snapshot) {
        reg = { ...emptyRegistries(), areas: snapshot.areas };
        rebuild(new Map(snapshot.entities.map((e) => [e.id, e])), [], true, { screen, signin, favorites, haVersion: snapshot.haVersion });
      } else {
        set({ screen, signin, favorites });
      }
      if (token) connect();
    },

    async signIn(serverInput, tokenInput) {
      let s: string;
      let t: string;
      try {
        s = normalizeServer(serverInput);
        t = normalizeToken(tokenInput);
      } catch (e) {
        set({ signin: { ...state.signin, error: messageOf(e) } });
        return;
      }
      server = s;
      set({ signin: { server, busy: true, error: null } });
      try {
        await checkToken(authDeps, server, t);
      } catch (e) {
        set({ signin: { server, busy: false, error: messageOf(e) } });
        return;
      }
      signedIn(t);
    },

    signOut: () => leave(null),

    reconnect() {
      paused = false;
      if (connection) connection.start();
      else if (token) connect();
    },

    selectPage(key) {
      set({ selectedPage: key });
    },

    selectEntity(id) {
      set({ selectedEntity: id });
    },

    toggle(id) {
      const e = state.entities.get(id);
      if (e) callService(id, toggleCall(e));
    },
    setBrightness(id, pct) {
      const e = state.entities.get(id);
      if (e) callService(id, brightnessCall(e, pct));
    },
    stepTemperature(id, direction) {
      const e = state.entities.get(id);
      if (e) callService(id, temperatureCall(e, direction));
    },
    setMode(id, mode) {
      const e = state.entities.get(id);
      if (e) callService(id, modeCall(e, mode));
    },
    cover(id, action) {
      const e = state.entities.get(id);
      if (e) callService(id, coverCall(e, action));
    },
    setPosition(id, position) {
      const e = state.entities.get(id);
      if (e) callService(id, positionCall(e, position));
    },

    setFavorite(id, on) {
      const has = state.favorites.includes(id);
      if (on === has) return;
      const favorites = on ? [...state.favorites, id] : state.favorites.filter((f) => f !== id);
      deps.storage.setItem(KEYS.favorites, JSON.stringify(favorites));
      rebuild(state.entities, [id], false, { favorites });
    },

    setTopmost(topmost) {
      if (topmost) {
        if (pauseTimer !== null) {
          deps.clearTimeout(pauseTimer);
          pauseTimer = null;
        }
        if (paused) {
          paused = false;
          if (connection) connection.start();
        }
        return;
      }
      if (pauseTimer !== null || !connection) return;
      pauseTimer = deps.setTimeout(() => {
        pauseTimer = null;
        paused = true;
        if (connection) connection.stop();
        writeSnapshot();
      }, PAUSE_AFTER_MS);
    },

    showAbout() {
      set({ screen: 'about' });
    },
    showMain() {
      set({ screen: 'main' });
    },
    flush: writeSnapshot,
  };
  return store;
}
