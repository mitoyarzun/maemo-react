// Event, EventTarget, AbortController, AbortSignal and DOMException: the
// parts that fetch() and common libraries use.

export class DOMException extends Error {
  constructor(message = '', name = 'Error') {
    super(message);
    this.name = name;
  }

  get code() {
    return { AbortError: 20, TimeoutError: 23 }[this.name] || 0;
  }
}

export class Event {
  constructor(type, init = {}) {
    this.type = String(type);
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.timeStamp = performance.now();
    this._stopped = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() {}

  stopImmediatePropagation() {
    this._stopped = true;
  }
}

export class EventTarget {
  #listeners = new Map();

  addEventListener(type, fn, options) {
    if (!fn) return;
    const once = typeof options === 'object' && options !== null && Boolean(options.once);
    const list = this.#listeners.get(type) || [];
    if (list.some((l) => l.fn === fn)) return;
    list.push({ fn, once });
    this.#listeners.set(type, list);
  }

  removeEventListener(type, fn) {
    const list = this.#listeners.get(type);
    if (list) this.#listeners.set(type, list.filter((l) => l.fn !== fn));
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    const handler = this['on' + event.type];
    if (typeof handler === 'function') handler.call(this, event);
    for (const l of (this.#listeners.get(event.type) || []).slice()) {
      if (l.once) this.removeEventListener(event.type, l.fn);
      if (typeof l.fn === 'function') l.fn.call(this, event);
      else l.fn.handleEvent(event);
      if (event._stopped) break;
    }
    return !event.defaultPrevented;
  }
}

const SIGNAL_KEY = Symbol('AbortSignal');

export class AbortSignal extends EventTarget {
  constructor(key) {
    super();
    if (key !== SIGNAL_KEY) throw new TypeError('AbortSignal: use AbortController');
    this.aborted = false;
    this.reason = undefined;
    this.onabort = null;
  }

  throwIfAborted() {
    if (this.aborted) throw this.reason;
  }

  static abort(reason) {
    const c = new AbortController();
    c.abort(reason);
    return c.signal;
  }

  static timeout(ms) {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return c.signal;
  }
}

export class AbortController {
  constructor() {
    this.signal = new AbortSignal(SIGNAL_KEY);
  }

  abort(reason) {
    const s = this.signal;
    if (s.aborted) return;
    s.aborted = true;
    s.reason = reason === undefined ? new DOMException('This operation was aborted', 'AbortError') : reason;
    s.dispatchEvent(new Event('abort'));
  }
}
