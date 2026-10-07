// The live connection (HA spec section 4): the socket, the auth message,
// the message ids, the pings and the reconnect with back-off. Only
// WebSocket and timers: the tests give fakes.

export const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
export const PING_EVERY_MS = 30000;
export const PONG_WITHIN_MS = 10000;

/** An error answer of Home Assistant, or a lost connection. */
export class HaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HaError';
    this.code = code;
  }
}

export type ConnectionEvent =
  | { type: 'connecting' }
  | { type: 'connected'; haVersion: string }
  | { type: 'disconnected'; reason: string; retryInMs: number | null }
  | { type: 'auth-invalid'; message: string };

export interface ConnectionDeps {
  WebSocket: typeof WebSocket;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export interface ConnectionOptions {
  url: string;
  /** The long-lived access token of the auth message. */
  token: string;
  onEvent: (event: ConnectionEvent) => void;
}

export interface Connection {
  /** Connect now, also during a back-off wait. Resets the back-off. */
  start(): void;
  /** Close the socket and stop the reconnects. */
  stop(): void;
  /** Send a command; resolves with its result, rejects with an HaError. */
  call(message: Record<string, unknown>): Promise<unknown>;
  /** Send a subscription; onEvent gets each event of its id. Resolves with the id. */
  subscribe(message: Record<string, unknown>, onEvent: (event: unknown) => void): Promise<number>;
  isConnected(): boolean;
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Message {
  id?: unknown;
  type?: unknown;
  success?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown } | null;
  event?: unknown;
  message?: unknown;
  ha_version?: unknown;
}

function parse(text: unknown): Message | null {
  if (typeof text !== 'string') return null;
  try {
    const m: unknown = JSON.parse(text);
    return typeof m === 'object' && m !== null ? (m as Message) : null;
  } catch {
    return null;
  }
}

export function createConnection(deps: ConnectionDeps, options: ConnectionOptions): Connection {
  let socket: WebSocket | null = null;
  let connected = false; // auth_ok arrived
  let rejected = false; // auth_invalid arrived: the token is wrong
  let wanted = false; // start() ran and stop() did not
  let attempt = 0;
  let nextId = 1;
  let retryTimer: number | null = null;
  let pingTimer: number | null = null;
  let pongTimer: number | null = null;
  const waiters = new Map<number, Waiter>();
  const subscriptions = new Map<number, (event: unknown) => void>();

  function clearTimer(id: number | null) {
    if (id !== null) deps.clearTimeout(id);
  }

  function stopTimers() {
    clearTimer(pingTimer);
    clearTimer(pongTimer);
    pingTimer = null;
    pongTimer = null;
  }

  function send(message: Record<string, unknown>): number {
    if (!socket || !connected) throw new HaError('disconnected', 'Not connected');
    const id = nextId++;
    // A caller bug (a cyclic object) throws its own error here.
    const text = JSON.stringify({ id, ...message });
    try {
      socket.send(text);
    } catch {
      throw new HaError('disconnected', 'The socket is not open');
    }
    return id;
  }

  function failWaiters(reason: string) {
    for (const w of waiters.values()) w.reject(new HaError('disconnected', reason));
    waiters.clear();
    subscriptions.clear();
  }

  /** Forget the socket without a close handshake; onClosed runs the reconnect. */
  function detach(): WebSocket | null {
    const s = socket;
    if (!s) return null;
    s.onopen = null;
    s.onmessage = null;
    s.onerror = null;
    s.onclose = null;
    socket = null;
    return s;
  }

  function onClosed(reason: string) {
    connected = false;
    socket = null;
    stopTimers();
    failWaiters(reason);
    if (!wanted) {
      options.onEvent({ type: 'disconnected', reason, retryInMs: null });
      return;
    }
    const ms = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt++;
    options.onEvent({ type: 'disconnected', reason, retryInMs: ms });
    clearTimer(retryTimer);
    retryTimer = deps.setTimeout(() => {
      retryTimer = null;
      connect();
    }, ms);
  }

  /** Drop a socket that does not work, then take the reconnect path. */
  function dropSocket(reason: string) {
    const s = detach();
    if (s) {
      try {
        s.close();
      } catch {
        // The socket is already lost.
      }
    }
    onClosed(reason);
  }

  function schedulePing() {
    clearTimer(pingTimer);
    pingTimer = deps.setTimeout(() => {
      pingTimer = null;
      if (!connected) return;
      let id: number;
      try {
        id = send({ type: 'ping' });
      } catch {
        dropSocket('Ping failed');
        return;
      }
      waiters.set(id, {
        resolve: () => {
          clearTimer(pongTimer);
          pongTimer = null;
          schedulePing();
        },
        reject: () => {},
      });
      pongTimer = deps.setTimeout(() => {
        pongTimer = null;
        dropSocket('No pong in 10 s');
      }, PONG_WITHIN_MS);
    }, PING_EVERY_MS);
  }

  function handle(m: Message) {
    if (m.type === 'auth_ok') {
      connected = true;
      attempt = 0;
      options.onEvent({ type: 'connected', haVersion: String(m.ha_version ?? '') });
      schedulePing();
      return;
    }
    if (m.type === 'auth_invalid') {
      // A long-lived token does not become valid again: close the socket
      // and never reconnect with this token.
      wanted = false;
      rejected = true;
      options.onEvent({ type: 'auth-invalid', message: String(m.message ?? '') });
      dropSocket('Authentication failed');
      return;
    }
    if (typeof m.id !== 'number') return;
    if (m.type === 'result') {
      const w = waiters.get(m.id);
      if (!w) return;
      waiters.delete(m.id);
      if (m.success) w.resolve(m.result);
      else w.reject(new HaError(String(m.error?.code ?? 'unknown'), String(m.error?.message ?? 'Home Assistant answered with an error')));
    } else if (m.type === 'pong') {
      const w = waiters.get(m.id);
      if (w) {
        waiters.delete(m.id);
        w.resolve(undefined);
      }
    } else if (m.type === 'event') {
      subscriptions.get(m.id)?.(m.event);
    }
  }

  function connect() {
    if (socket || !wanted || rejected) return;
    options.onEvent({ type: 'connecting' });
    let s: WebSocket;
    try {
      s = new deps.WebSocket(options.url);
    } catch (e) {
      onClosed(e instanceof Error ? e.message : 'Cannot connect');
      return;
    }
    socket = s;
    s.onmessage = (e) => {
      const m = parse(e.data);
      if (!m) return;
      if (!connected && m.type === 'auth_required') {
        s.send(JSON.stringify({ type: 'auth', access_token: options.token }));
        return;
      }
      handle(m);
    };
    s.onerror = () => {};
    s.onclose = (e) => {
      if (socket !== s) return;
      onClosed(e.reason || 'Connection closed (' + e.code + ')');
    };
  }

  return {
    start() {
      if (rejected) return;
      wanted = true;
      attempt = 0;
      clearTimer(retryTimer);
      retryTimer = null;
      connect();
    },
    stop() {
      wanted = false;
      const waiting = retryTimer !== null;
      clearTimer(retryTimer);
      retryTimer = null;
      if (!socket) {
        // Tell the user interface that the retry count is over.
        if (waiting) options.onEvent({ type: 'disconnected', reason: 'Stopped', retryInMs: null });
        return;
      }
      dropSocket('Stopped');
    },
    call(message) {
      return new Promise((resolve, reject) => {
        let id: number;
        try {
          id = send(message);
        } catch (e) {
          reject(e);
          return;
        }
        waiters.set(id, { resolve, reject });
      });
    },
    subscribe(message, onEvent) {
      return new Promise((resolve, reject) => {
        let id: number;
        try {
          id = send(message);
        } catch (e) {
          reject(e);
          return;
        }
        subscriptions.set(id, onEvent);
        waiters.set(id, {
          resolve: () => resolve(id),
          reject: (e) => {
            subscriptions.delete(id);
            reject(e);
          },
        });
      });
    },
    isConnected: () => connected,
  };
}
