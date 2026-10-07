// A fake WebSocket. The test plays the server.
export class FakeSocket {
  static all: FakeSocket[] = [];
  readonly url: string;
  sent: string[] = [];
  closed = false;
  sendError: Error | null = null;
  static constructError: Error | null = null;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent<string | ArrayBuffer>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;

  constructor(url: string) {
    if (FakeSocket.constructError) throw FakeSocket.constructError;
    this.url = url;
    FakeSocket.all.push(this);
  }

  send(data: string) {
    if (this.sendError) throw this.sendError;
    this.sent.push(String(data));
  }

  close() {
    this.closed = true;
  }

  /** The server accepts the socket and asks for auth. */
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
    this.serverSend({ type: 'auth_required', ha_version: '2025.1.0' });
  }

  serverSend(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent<string>);
  }

  serverClose(code = 1006, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: code === 1000 } as CloseEvent);
  }

  last() {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

// Fake timers that run when the test advances the clock.
export function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(nextId, { at: now + ms, fn });
      return nextId++;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, t] = due[0];
        timers.delete(id);
        now = t.at;
        t.fn();
        await Promise.resolve();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

/** A fake localStorage: a Map. */
export function fakeStorage(init: Record<string, string> = {}) {
  let map = new Map(Object.entries(init));
  return {
    get length() {
      return map.size;
    },
    key: (n: number) => [...map.keys()][n] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem(k: string, v: string) {
      map.set(k, String(v));
    },
    removeItem(k: string) {
      map.delete(k);
    },
    clear() {
      map = new Map();
    },
    /** For the tests: every item. */
    all: () => Object.fromEntries(map),
  };
}
