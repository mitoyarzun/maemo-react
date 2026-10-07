// WebSocket, CloseEvent and MessageEvent on top of the native maemo:ws
// module (curl). createWebSocket takes that module as an argument, so the
// tests can give a fake one.
import { TextEncoder } from './encoding.js';
import { DOMException, Event, EventTarget } from './events.js';
import { URL } from './url.js';

export class CloseEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.wasClean = Boolean(init.wasClean);
    this.code = init.code === undefined ? 0 : Number(init.code);
    this.reason = init.reason === undefined ? '' : String(init.reason);
  }
}

export class MessageEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.data = init.data === undefined ? null : init.data;
    this.origin = init.origin === undefined ? '' : String(init.origin);
    this.lastEventId = '';
    this.source = null;
    this.ports = [];
  }
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const encoder = new TextEncoder();

function syntaxError(message) {
  return new DOMException('WebSocket: ' + message, 'SyntaxError');
}

/** The href of the URL, with http and https turned into ws and wss. */
function parseUrl(input) {
  let u;
  try {
    u = new URL(String(input));
  } catch (e) {
    throw syntaxError('invalid URL: ' + String(input));
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    u = new URL((u.protocol === 'http:' ? 'ws:' : 'wss:') + u.href.slice(u.protocol.length));
  }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw syntaxError('only ws and wss URLs are supported, not ' + u.protocol);
  if (u.hash) throw syntaxError('the URL must not have a fragment');
  return u.href;
}

function parseProtocols(protocols) {
  if (protocols === undefined) return [];
  const list = typeof protocols === 'string' ? [protocols] : Array.from(protocols, String);
  const seen = new Set();
  for (const p of list) {
    if (!TOKEN.test(p)) throw syntaxError('invalid protocol: ' + p);
    const k = p.toLowerCase();
    if (seen.has(k)) throw syntaxError('duplicate protocol: ' + p);
    seen.add(k);
  }
  return list;
}

function originOf(href) {
  const u = new URL(href);
  return u.protocol + '//' + u.host;
}

export function createWebSocket(ws) {
  class WebSocket extends EventTarget {
    #id;
    #state = CONNECTING;
    #url;
    #protocols;
    #protocol = '';
    #binaryType = 'arraybuffer';

    constructor(url, protocols) {
      super();
      this.#url = parseUrl(url);
      this.#protocols = parseProtocols(protocols);
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.#id = ws.open({ url: this.#url, protocols: this.#protocols }, (ev) => this.#onEvent(ev));
    }

    get url() {
      return this.#url;
    }

    get readyState() {
      return this.#state;
    }

    get protocol() {
      return this.#protocol;
    }

    get extensions() {
      return '';
    }

    get bufferedAmount() {
      return this.#state === OPEN || this.#state === CLOSING ? ws.bufferedAmount(this.#id) : 0;
    }

    get binaryType() {
      return this.#binaryType;
    }

    set binaryType(value) {
      if (value !== 'arraybuffer') throw new TypeError("WebSocket: binaryType supports only 'arraybuffer'; the tablet has no Blob");
      this.#binaryType = value;
    }

    send(data) {
      if (this.#state === CONNECTING) throw new DOMException('WebSocket: the connection is not open yet', 'InvalidStateError');
      if (this.#state !== OPEN) return; // closing or closed: browsers drop the data too
      let payload = data;
      let binary = true;
      if (typeof data === 'string') binary = false;
      else if (data instanceof ArrayBuffer) payload = data;
      else if (ArrayBuffer.isView(data)) payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      else {
        payload = String(data);
        binary = false;
      }
      // The module returns false after the server close frame: the close event is not here yet. Drop the data.
      ws.send(this.#id, payload, binary);
    }

    close(code, reason) {
      if (code === undefined && reason !== undefined) {
        throw new DOMException('WebSocket: a close reason needs a close code', 'InvalidAccessError');
      }
      if (code !== undefined) {
        code = Number(code);
        if (!Number.isInteger(code) || (code !== 1000 && !(code >= 3000 && code <= 4999))) {
          throw new DOMException('WebSocket: the close code must be 1000 or 3000 to 4999', 'InvalidAccessError');
        }
      }
      if (reason !== undefined) {
        reason = String(reason);
        if (encoder.encode(reason).length > 123) throw syntaxError('the close reason is longer than 123 bytes');
      }
      if (this.#state === CLOSING || this.#state === CLOSED) return;
      if (this.#state === CONNECTING) {
        // The standard: fail the connection. The module gives no more events after abort.
        this.#state = CLOSING;
        ws.abort(this.#id);
        queueMicrotask(() => this.#fail());
        return;
      }
      this.#state = CLOSING;
      ws.close(this.#id, code === undefined ? 0 : code, reason === undefined ? '' : reason);
    }

    #fail() {
      if (this.#state === CLOSED) return;
      this.#state = CLOSED;
      // A handler that throws must not lose the close event. The handler error goes on after close.
      try {
        this.dispatchEvent(new Event('error'));
      } finally {
        this.dispatchEvent(new CloseEvent('close', { wasClean: false, code: 1006, reason: '' }));
      }
    }

    #onEvent(ev) {
      if (ev.type === 'open') {
        if (this.#state !== CONNECTING) return;
        if (ev.protocol && !this.#protocols.includes(ev.protocol)) {
          ws.abort(this.#id);
          this.#fail();
          return;
        }
        this.#protocol = ev.protocol || '';
        this.#state = OPEN;
        this.dispatchEvent(new Event('open'));
      } else if (ev.type === 'message') {
        if (this.#state !== OPEN) return;
        this.dispatchEvent(new MessageEvent('message', { data: ev.data, origin: originOf(this.#url) }));
      } else if (ev.type === 'error') {
        if (this.#state === CLOSED) return;
        const e = new Event('error');
        e.message = ev.message;
        this.dispatchEvent(e);
      } else if (ev.type === 'close') {
        if (this.#state === CLOSED) return;
        this.#state = CLOSED;
        this.dispatchEvent(new CloseEvent('close', { wasClean: ev.wasClean, code: ev.code, reason: ev.reason }));
      }
    }
  }

  for (const [name, value] of Object.entries({ CONNECTING, OPEN, CLOSING, CLOSED })) {
    Object.defineProperty(WebSocket, name, { value, enumerable: true });
    Object.defineProperty(WebSocket.prototype, name, { value, enumerable: true });
  }
  return WebSocket;
}
