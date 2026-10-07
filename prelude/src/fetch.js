// fetch(), Headers, Request and Response on top of the native maemo:http
// module (curl). createFetch takes that module as an argument, so the tests
// can give a fake one.
import { TextDecoder, TextEncoder } from './encoding.js';
import { URL, URLSearchParams } from './url.js';

const encoder = new TextEncoder();
const NETWORK = Symbol('network');

function headerName(name) {
  name = String(name);
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new TypeError('Headers: invalid name: ' + name);
  return name.toLowerCase();
}

function headerValue(value) {
  return String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
}

export class Headers {
  #map = new Map(); // lower-case name -> values

  constructor(init) {
    if (init === undefined || init === null) return;
    if (init instanceof Headers) {
      for (const [k, v] of init) this.append(k, v);
    } else if (typeof init[Symbol.iterator] === 'function') {
      for (const pair of init) {
        const a = Array.from(pair);
        if (a.length !== 2) throw new TypeError('Headers: each pair must have two items');
        this.append(a[0], a[1]);
      }
    } else {
      for (const k of Object.keys(init)) this.append(k, init[k]);
    }
  }

  append(name, value) {
    const k = headerName(name);
    const list = this.#map.get(k) || [];
    list.push(headerValue(value));
    this.#map.set(k, list);
  }

  set(name, value) {
    this.#map.set(headerName(name), [headerValue(value)]);
  }

  get(name) {
    const list = this.#map.get(headerName(name));
    return list ? list.join(', ') : null;
  }

  has(name) {
    return this.#map.has(headerName(name));
  }

  delete(name) {
    this.#map.delete(headerName(name));
  }

  getSetCookie() {
    return (this.#map.get('set-cookie') || []).slice();
  }

  forEach(fn, thisArg) {
    for (const [k, v] of this) fn.call(thisArg, v, k, this);
  }

  *entries() {
    for (const k of [...this.#map.keys()].sort()) {
      if (k === 'set-cookie') {
        for (const v of this.#map.get(k)) yield [k, v];
      } else {
        yield [k, this.#map.get(k).join(', ')];
      }
    }
  }

  *keys() {
    for (const [k] of this.entries()) yield k;
  }

  *values() {
    for (const [, v] of this.entries()) yield v;
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

function bodyBytes(body, headers) {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') {
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain;charset=UTF-8');
    return encoder.encode(body);
  }
  if (body instanceof URLSearchParams) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
    return encoder.encode(body.toString());
  }
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  throw new TypeError('fetch: use a string, URLSearchParams, an ArrayBuffer or a typed array as the body');
}

class Body {
  #bytes; // Promise<Uint8Array>
  #used = false;

  constructor(bytes) {
    this.#bytes = bytes;
  }

  get bodyUsed() {
    return this.#used;
  }

  #take() {
    if (this.#used) return Promise.reject(new TypeError('Body: the body was read already'));
    this.#used = true;
    return this.#bytes;
  }

  async arrayBuffer() {
    const b = await this.#take();
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }

  async bytes() {
    return new Uint8Array(await this.arrayBuffer());
  }

  async text() {
    return new TextDecoder().decode(await this.#take());
  }

  async json() {
    return JSON.parse(await this.text());
  }
}

export class Response extends Body {
  constructor(body = null, init = {}) {
    if (init && init[NETWORK]) {
      const n = init[NETWORK];
      super(n.bytes);
      this.status = n.status;
      this.statusText = n.statusText;
      this.headers = n.headers;
      this.url = n.url;
      this.redirected = n.redirected;
      this.type = 'basic';
      return;
    }
    init = init ?? {};
    const headers = new Headers(init.headers);
    super(Promise.resolve(bodyBytes(body, headers) || new Uint8Array(0)));
    this.status = init.status === undefined ? 200 : Number(init.status);
    if (this.status < 200 || this.status > 599) throw new RangeError('Response: the status must be 200 to 599');
    this.statusText = init.statusText === undefined ? '' : String(init.statusText);
    this.headers = headers;
    this.url = '';
    this.redirected = false;
    this.type = 'default';
  }

  get ok() {
    return this.status >= 200 && this.status <= 299;
  }

  static json(data, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(data), { ...init, headers });
  }
}

// A Request without a body: enough for fetch(new Request(url, init)).
export class Request {
  constructor(input, init = {}) {
    const src = input instanceof Request ? input : null;
    this.url = new URL(src ? src.url : String(input)).href;
    this.method = String(init.method || (src ? src.method : 'GET')).toUpperCase();
    this.headers = new Headers(init.headers || (src ? src.headers : undefined));
    this.signal = init.signal || (src ? src.signal : null);
    this.redirect = init.redirect || (src ? src.redirect : 'follow');
  }
}

export function createFetch(http) {
  return function fetch(input, init = {}) {
    return new Promise((resolve, reject) => {
      const req = input instanceof Request ? input : null;
      let url;
      try {
        url = new URL(req ? req.url : String(input));
      } catch (e) {
        reject(new TypeError('fetch: invalid URL: ' + String(input), { cause: e }));
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        reject(new TypeError('fetch: only http and https URLs are supported, not ' + url.protocol));
        return;
      }
      const method = String(init.method || (req ? req.method : 'GET')).toUpperCase();
      const headers = new Headers(init.headers || (req ? req.headers : undefined));
      let body;
      try {
        body = bodyBytes(init.body, headers);
      } catch (e) {
        reject(e);
        return;
      }
      if (body && (method === 'GET' || method === 'HEAD')) {
        reject(new TypeError('fetch: a GET or HEAD request cannot have a body'));
        return;
      }
      const signal = init.signal || (req ? req.signal : null);
      if (signal && signal.aborted) {
        reject(signal.reason);
        return;
      }

      const redirect = init.redirect || (req ? req.redirect : 'follow');
      if (redirect === 'error') {
        reject(new TypeError("fetch: redirect 'error' is not supported"));
        return;
      }

      const chunks = [];
      let size = 0;
      let done = false;
      let response = null;
      let finishBody;
      let failBody;
      const bytes = new Promise((res, rej) => {
        finishBody = res;
        failBody = rej;
      });
      bytes.catch(() => {}); // the caller may never read the body

      const fail = (err) => {
        if (done) return;
        done = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        if (response) failBody(err);
        else reject(err);
      };
      const id = http.request(
        {
          method,
          url: url.href,
          headers: [...headers],
          body: body ? body.buffer : null,
          timeoutMs: 0,
          followRedirects: redirect !== 'manual',
        },
        (ev) => {
          if (done) return;
          if (ev.type === 'headers') {
            response = new Response(null, {
              [NETWORK]: {
                status: ev.status,
                statusText: ev.statusText || '',
                headers: new Headers(ev.headers),
                url: ev.url,
                redirected: Boolean(ev.redirected),
                bytes,
              },
            });
            resolve(response);
          } else if (ev.type === 'data') {
            const c = new Uint8Array(ev.chunk);
            chunks.push(c);
            size += c.length;
          } else if (ev.type === 'end') {
            done = true;
            if (signal) signal.removeEventListener('abort', onAbort);
            const all = new Uint8Array(size);
            let off = 0;
            for (const c of chunks) {
              all.set(c, off);
              off += c.length;
            }
            finishBody(all);
          } else if (ev.type === 'error') {
            fail(new TypeError('Failed to fetch', { cause: new Error(ev.message) }));
          }
        },
      );
      function onAbort() {
        http.abort(id);
        fail(signal.reason);
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  };
}
