// A subset of the WHATWG URL standard: the special schemes (http, https, ws,
// wss, ftp, file) and opaque URLs such as mailto: or data:. Not supported:
// internationalized host names, IPv4 short forms such as 127.1, and
// non-special URLs with an authority (foo://host/path).
import { TextDecoder, TextEncoder } from './encoding.js';

const DEFAULT_PORT = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21', 'file:': '' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Percent-encode sets: the ASCII characters that are encoded in addition to
// controls, space and all non-ASCII characters.
const FRAGMENT_SET = '"<>`';
const QUERY_SET = '"#<>';
const SPECIAL_QUERY_SET = QUERY_SET + "'";
const PATH_SET = QUERY_SET + '?`{}^';
const USERINFO_SET = PATH_SET + '/:;=@[\\]|';
const FORBIDDEN_HOST = ' #%/:<>?@[\\]^|';

function hex(b) {
  return '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
}

function encodeSet(s, set) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c > 0x20 && c < 0x7f && !set.includes(ch)) {
      out += ch;
    } else if (c < 0x80) {
      out += hex(c);
    } else {
      for (const b of encoder.encode(ch)) out += hex(b);
    }
  }
  return out;
}

function encodeOpaque(s) {
  // Opaque paths encode only controls and non-ASCII characters.
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c < 0x7f) out += ch;
    else if (c < 0x80) out += hex(c);
    else for (const b of encoder.encode(ch)) out += hex(b);
  }
  return out;
}

function percentDecodeBytes(s) {
  const bytes = encoder.encode(s);
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x25 && i + 2 < bytes.length) {
      const h = String.fromCharCode(bytes[i + 1], bytes[i + 2]);
      if (/^[0-9a-fA-F]{2}$/.test(h)) {
        out[n++] = parseInt(h, 16);
        i += 2;
        continue;
      }
    }
    out[n++] = b;
  }
  return out.slice(0, n);
}

function percentDecode(s) {
  return decoder.decode(percentDecodeBytes(s));
}

function invalid(input) {
  return new TypeError('Invalid URL: ' + input);
}

function parseHost(h, input) {
  if (h.startsWith('[')) {
    if (!h.endsWith(']') || !/^\[[0-9a-fA-F:.]+\]$/.test(h)) throw invalid(input);
    return h.toLowerCase();
  }
  const host = percentDecode(h).toLowerCase();
  if (host === '') throw invalid(input);
  for (const ch of host) {
    if (ch.codePointAt(0) >= 0x80) {
      throw new TypeError('Invalid URL: internationalized host names are not supported: ' + input);
    }
    if (ch.codePointAt(0) < 0x21 || FORBIDDEN_HOST.includes(ch)) throw invalid(input);
  }
  return host;
}

function isDouble(seg) {
  const s = seg.toLowerCase();
  return s === '..' || s === '.%2e' || s === '%2e.' || s === '%2e%2e';
}

function isSingle(seg) {
  const s = seg.toLowerCase();
  return s === '.' || s === '%2e';
}

// Remove "." and ".." segments and encode each segment. The path starts with "/".
function normalizePath(path) {
  const segs = path.split('/').slice(1);
  const out = [];
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    if (isDouble(seg)) {
      out.pop();
      if (last) out.push('');
    } else if (isSingle(seg)) {
      if (last) out.push('');
    } else {
      out.push(encodeSet(seg, PATH_SET));
    }
  });
  return '/' + out.join('/');
}

// In special URLs, a backslash before the query or the fragment is a slash.
function slashes(s) {
  const cut = s.search(/[?#]/);
  return cut < 0 ? s.replace(/\\/g, '/') : s.slice(0, cut).replace(/\\/g, '/') + s.slice(cut);
}

// Split "path?query#fragment". Query and fragment are null when absent.
function splitTail(tail) {
  let fragment = null;
  let query = null;
  const h = tail.indexOf('#');
  if (h >= 0) {
    fragment = tail.slice(h + 1);
    tail = tail.slice(0, h);
  }
  const q = tail.indexOf('?');
  if (q >= 0) {
    query = tail.slice(q + 1);
    tail = tail.slice(0, q);
  }
  return { path: tail, query, fragment };
}

function finish(rec, path, query, fragment, special) {
  rec.pathname = rec.opaque ? encodeOpaque(path) : normalizePath(path || '/');
  rec.query = query === null ? null : encodeSet(query, special ? SPECIAL_QUERY_SET : QUERY_SET);
  rec.fragment = fragment === null ? null : encodeSet(fragment, FRAGMENT_SET);
  return rec;
}

function parseAuthority(protocol, rest, input) {
  const end = rest.search(/[/\\?#]/);
  const auth = end < 0 ? rest : rest.slice(0, end);
  const tail = end < 0 ? '' : rest.slice(end);
  const rec = { protocol, username: '', password: '', hostname: '', port: '', opaque: false };
  let hostport = auth;
  const at = auth.lastIndexOf('@');
  if (at >= 0) {
    const userinfo = auth.slice(0, at);
    hostport = auth.slice(at + 1);
    const c = userinfo.indexOf(':');
    rec.username = encodeSet(c < 0 ? userinfo : userinfo.slice(0, c), USERINFO_SET);
    rec.password = c < 0 ? '' : encodeSet(userinfo.slice(c + 1), USERINFO_SET);
  }
  let port = '';
  if (hostport.startsWith('[')) {
    const close = hostport.indexOf(']');
    if (close < 0) throw invalid(input);
    const after = hostport.slice(close + 1);
    if (after !== '' && after[0] !== ':') throw invalid(input);
    port = after.slice(1);
    hostport = hostport.slice(0, close + 1);
  } else {
    const c = hostport.lastIndexOf(':');
    if (c >= 0) {
      port = hostport.slice(c + 1);
      hostport = hostport.slice(0, c);
    }
  }
  if (protocol === 'file:' && hostport === '') {
    rec.hostname = '';
  } else {
    rec.hostname = parseHost(hostport, input);
  }
  if (rec.hostname === 'localhost' && protocol === 'file:') rec.hostname = '';
  if (port !== '') {
    if (!/^[0-9]+$/.test(port) || Number(port) > 65535) throw invalid(input);
    port = String(Number(port));
    rec.port = port === DEFAULT_PORT[protocol] ? '' : port;
  }
  const t = splitTail(slashes(tail));
  return finish(rec, t.path, t.query, t.fragment, true);
}

function copyAuthority(base) {
  return {
    protocol: base.protocol,
    username: base.username,
    password: base.password,
    hostname: base.hostname,
    port: base.port,
    opaque: false,
  };
}

function resolve(s, base, input) {
  const special = base.protocol in DEFAULT_PORT;
  if (base.opaque) {
    if (!s.startsWith('#')) throw invalid(input);
    return { ...base, fragment: encodeSet(s.slice(1), FRAGMENT_SET) };
  }
  if (special) s = slashes(s);
  if (s.startsWith('//')) return parseAuthority(base.protocol, s.replace(/^\/+/, ''), input);
  const t = splitTail(s);
  const rec = copyAuthority(base);
  if (s.startsWith('/')) return finish(rec, t.path, t.query, t.fragment, special);
  if (t.path === '') {
    // "", "?query" or "#fragment": keep the base path, and the base query
    // unless a new one is given.
    rec.pathname = base.pathname;
    rec.query = t.query === null ? base.query : encodeSet(t.query, special ? SPECIAL_QUERY_SET : QUERY_SET);
    rec.fragment = t.fragment === null ? null : encodeSet(t.fragment, FRAGMENT_SET);
    return rec;
  }
  const dir = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  return finish(rec, dir + t.path, t.query, t.fragment, special);
}

function parse(input, base) {
  // Remove leading and trailing C0 controls and spaces, then all tabs and newlines.
  const s = String(input).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
  if (m) {
    const protocol = m[1].toLowerCase() + ':';
    const rest = s.slice(m[0].length);
    if (protocol in DEFAULT_PORT) {
      if (base && base.protocol === protocol && !/^[/\\]/.test(rest) && protocol !== 'file:') {
        return resolve(rest, base, input);
      }
      // file: has an empty host in "file:///path", so it drops only two slashes.
      const auth = protocol === 'file:' ? rest.replace(/^[/\\]{2}/, '') : rest.replace(/^[/\\]*/, '');
      return parseAuthority(protocol, auth, input);
    }
    if (rest.startsWith('/')) throw new TypeError('Invalid URL: non-special URLs with a path or an authority are not supported: ' + input);
    const t = splitTail(rest);
    const rec = { protocol, username: '', password: '', hostname: '', port: '', opaque: true };
    return finish(rec, t.path, t.query, t.fragment, false);
  }
  if (!base) throw invalid(input);
  return resolve(s, base, input);
}

function serialize(r) {
  let out = r.protocol;
  if (!r.opaque) {
    out += '//';
    if (r.username || r.password) out += r.username + (r.password ? ':' + r.password : '') + '@';
    out += r.hostname + (r.port ? ':' + r.port : '');
  }
  out += r.pathname;
  if (r.query !== null) out += '?' + r.query;
  if (r.fragment !== null) out += '#' + r.fragment;
  return out;
}

// application/x-www-form-urlencoded, as URLSearchParams uses it.
function formEncode(s) {
  let out = '';
  for (const b of encoder.encode(s)) {
    const ch = String.fromCharCode(b);
    if (/[*\-._0-9A-Za-z]/.test(ch)) out += ch;
    else if (b === 0x20) out += '+';
    else out += hex(b);
  }
  return out;
}

function formParse(s) {
  const list = [];
  for (const part of s.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const name = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    list.push([percentDecode(name.replace(/\+/g, ' ')), percentDecode(value.replace(/\+/g, ' '))]);
  }
  return list;
}

export class URLSearchParams {
  #list = [];
  #url = null;

  constructor(init) {
    if (init === undefined || init === null) return;
    if (typeof init === 'string') {
      this.#list = formParse(init.startsWith('?') ? init.slice(1) : init);
    } else if (init instanceof URLSearchParams) {
      this.#list = init.#list.map((p) => [p[0], p[1]]);
    } else if (typeof init === 'object' && typeof init[Symbol.iterator] === 'function') {
      for (const pair of init) {
        const a = Array.from(pair);
        if (a.length !== 2) throw new TypeError('URLSearchParams: each pair must have two items');
        this.#list.push([String(a[0]), String(a[1])]);
      }
    } else if (typeof init === 'object') {
      for (const k of Object.keys(init)) this.#list.push([k, String(init[k])]);
    } else {
      this.#list = formParse(String(init));
    }
  }

  static _attach(params, url) {
    params.#url = url;
  }

  static _replace(params, query) {
    params.#list = query ? formParse(query) : [];
  }

  #update() {
    if (this.#url) this.#url._setQuery(this.#list.length ? this.toString() : null);
  }

  get size() {
    return this.#list.length;
  }

  append(name, value) {
    this.#list.push([String(name), String(value)]);
    this.#update();
  }

  delete(name, value) {
    name = String(name);
    this.#list = this.#list.filter((p) => !(p[0] === name && (value === undefined || p[1] === String(value))));
    this.#update();
  }

  get(name) {
    const p = this.#list.find((q) => q[0] === String(name));
    return p ? p[1] : null;
  }

  getAll(name) {
    return this.#list.filter((p) => p[0] === String(name)).map((p) => p[1]);
  }

  has(name, value) {
    name = String(name);
    return this.#list.some((p) => p[0] === name && (value === undefined || p[1] === String(value)));
  }

  set(name, value) {
    name = String(name);
    value = String(value);
    const i = this.#list.findIndex((p) => p[0] === name);
    if (i < 0) {
      this.#list.push([name, value]);
    } else {
      this.#list[i][1] = value;
      this.#list = this.#list.filter((p, j) => j <= i || p[0] !== name);
    }
    this.#update();
  }

  sort() {
    this.#list = this.#list
      .map((p, i) => [p, i])
      .sort((a, b) => (a[0][0] < b[0][0] ? -1 : a[0][0] > b[0][0] ? 1 : a[1] - b[1]))
      .map((x) => x[0]);
    this.#update();
  }

  forEach(fn, thisArg) {
    for (const [k, v] of this.#list) fn.call(thisArg, v, k, this);
  }

  *entries() {
    for (const p of this.#list) yield [p[0], p[1]];
  }

  *keys() {
    for (const p of this.#list) yield p[0];
  }

  *values() {
    for (const p of this.#list) yield p[1];
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  toString() {
    return this.#list.map((p) => formEncode(p[0]) + '=' + formEncode(p[1])).join('&');
  }
}

export class URL {
  #r;
  #params;

  constructor(input, base) {
    const b = base === undefined ? null : base instanceof URL ? base.#r : parse(String(base), null);
    this.#r = parse(String(input), b);
    this.#params = new URLSearchParams(this.#r.query || '');
    URLSearchParams._attach(this.#params, this);
  }

  static canParse(input, base) {
    try {
      new URL(input, base);
      return true;
    } catch {
      return false;
    }
  }

  _setQuery(query) {
    this.#r.query = query;
  }

  get href() {
    return serialize(this.#r);
  }

  set href(v) {
    this.#r = parse(String(v), null);
    URLSearchParams._replace(this.#params, this.#r.query);
  }

  get protocol() {
    return this.#r.protocol;
  }

  get username() {
    return this.#r.username;
  }

  get password() {
    return this.#r.password;
  }

  get hostname() {
    return this.#r.hostname;
  }

  get port() {
    return this.#r.port;
  }

  get host() {
    return this.#r.hostname + (this.#r.port ? ':' + this.#r.port : '');
  }

  get origin() {
    const r = this.#r;
    if (r.opaque || r.protocol === 'file:') return 'null';
    return r.protocol + '//' + this.host;
  }

  get pathname() {
    return this.#r.pathname;
  }

  set pathname(v) {
    if (this.#r.opaque) return;
    const p = String(v);
    this.#r.pathname = normalizePath(p.startsWith('/') ? p : '/' + p);
  }

  get search() {
    return this.#r.query ? '?' + this.#r.query : '';
  }

  set search(v) {
    let q = String(v);
    if (q.startsWith('?')) q = q.slice(1);
    this.#r.query = q === '' ? null : encodeSet(q, this.#r.protocol in DEFAULT_PORT ? SPECIAL_QUERY_SET : QUERY_SET);
    URLSearchParams._replace(this.#params, this.#r.query);
  }

  get searchParams() {
    return this.#params;
  }

  get hash() {
    return this.#r.fragment ? '#' + this.#r.fragment : '';
  }

  set hash(v) {
    let f = String(v);
    if (f.startsWith('#')) f = f.slice(1);
    this.#r.fragment = f === '' ? null : encodeSet(f, FRAGMENT_SET);
  }

  toString() {
    return this.href;
  }

  toJSON() {
    return this.href;
  }
}
