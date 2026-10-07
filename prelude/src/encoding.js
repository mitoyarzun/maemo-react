// TextEncoder and TextDecoder for UTF-8 only, as the WHATWG Encoding standard
// describes them. The decoder replaces bad sequences with U+FFFD.

function toBytes(input) {
  if (input === undefined) return new Uint8Array(0);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('TextDecoder.decode: the argument must be an ArrayBuffer or a view');
}

export class TextEncoder {
  get encoding() {
    return 'utf-8';
  }

  encode(input = '') {
    const s = String(input);
    const out = new Uint8Array(s.length * 3);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        } else {
          c = 0xfffd;
        }
      } else if (c >= 0xd800 && c <= 0xdfff) {
        c = 0xfffd;
      }
      if (c < 0x80) {
        out[n++] = c;
      } else if (c < 0x800) {
        out[n++] = 0xc0 | (c >> 6);
        out[n++] = 0x80 | (c & 63);
      } else if (c < 0x10000) {
        out[n++] = 0xe0 | (c >> 12);
        out[n++] = 0x80 | ((c >> 6) & 63);
        out[n++] = 0x80 | (c & 63);
      } else {
        out[n++] = 0xf0 | (c >> 18);
        out[n++] = 0x80 | ((c >> 12) & 63);
        out[n++] = 0x80 | ((c >> 6) & 63);
        out[n++] = 0x80 | (c & 63);
      }
    }
    return out.slice(0, n);
  }
}

export class TextDecoder {
  constructor(label = 'utf-8', options = {}) {
    const l = String(label).trim().toLowerCase();
    if (l !== 'utf-8' && l !== 'utf8' && l !== 'unicode-1-1-utf-8') {
      throw new RangeError('TextDecoder: only utf-8 is supported, not ' + label);
    }
    this.fatal = Boolean(options.fatal);
    this.ignoreBOM = Boolean(options.ignoreBOM);
  }

  get encoding() {
    return 'utf-8';
  }

  decode(input, options) {
    if (options && options.stream) throw new TypeError('TextDecoder: stream mode is not supported');
    const bytes = toBytes(input);
    let out = '';
    let chunk = [];
    let need = 0;
    let cp = 0;
    let lower = 0x80;
    let upper = 0xbf;
    const push = (c) => {
      if (c > 0xffff) {
        c -= 0x10000;
        chunk.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      } else {
        chunk.push(c);
      }
      if (chunk.length > 8192) {
        out += String.fromCharCode.apply(null, chunk);
        chunk = [];
      }
    };
    const bad = () => {
      if (this.fatal) throw new TypeError('TextDecoder: the data is not valid UTF-8');
      push(0xfffd);
    };
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (need === 0) {
        if (b <= 0x7f) {
          push(b);
        } else if (b >= 0xc2 && b <= 0xdf) {
          need = 1;
          cp = b & 0x1f;
        } else if (b >= 0xe0 && b <= 0xef) {
          if (b === 0xe0) lower = 0xa0;
          if (b === 0xed) upper = 0x9f;
          need = 2;
          cp = b & 0xf;
        } else if (b >= 0xf0 && b <= 0xf4) {
          if (b === 0xf0) lower = 0x90;
          if (b === 0xf4) upper = 0x8f;
          need = 3;
          cp = b & 0x7;
        } else {
          bad();
        }
        continue;
      }
      if (b < lower || b > upper) {
        need = 0;
        cp = 0;
        lower = 0x80;
        upper = 0xbf;
        bad();
        i--; // this byte can start a new sequence
        continue;
      }
      lower = 0x80;
      upper = 0xbf;
      cp = (cp << 6) | (b & 0x3f);
      if (--need === 0) push(cp);
    }
    if (need) bad();
    if (chunk.length) out += String.fromCharCode.apply(null, chunk);
    if (!this.ignoreBOM && out.charCodeAt(0) === 0xfeff) out = out.slice(1);
    return out;
  }
}
