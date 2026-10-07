// localStorage on top of the native maemo:storage module. The items live in
// memory; the module writes the JSON file during idle time after a change.
// createStorage takes the module as an argument, so the tests can give a
// fake one.
import { DOMException } from './events.js';

/** The limit on the characters of all keys and values together. */
export const LIMIT = 1024 * 1024;

function parse(text) {
  const obj = JSON.parse(text);
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new TypeError('not an object');
  const map = new Map();
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] !== 'string') throw new TypeError('the value of ' + k + ' is not a string');
    map.set(k, obj[k]);
  }
  return map;
}

export function createStorage(backend) {
  let map = new Map();
  let size = 0;
  const text = backend.load();
  if (text !== null) {
    try {
      map = parse(text);
      for (const [k, v] of map) size += k.length + v.length;
    } catch (e) {
      console.error('localStorage: the file is not valid; it is kept as localStorage.json.bad:', e instanceof Error ? e.message : e);
      backend.markBad();
      map = new Map();
      size = 0;
    }
  }
  const save = () => backend.schedule(() => JSON.stringify(Object.fromEntries(map)));

  class Storage {
    get length() {
      return map.size;
    }

    key(n) {
      n = Math.floor(Number(n));
      if (!(n >= 0) || n >= map.size) return null;
      let i = 0;
      for (const k of map.keys()) if (i++ === n) return k;
      return null;
    }

    getItem(key) {
      key = String(key);
      return map.has(key) ? map.get(key) : null;
    }

    setItem(key, value) {
      key = String(key);
      value = String(value);
      const old = map.get(key);
      const next = size - (old === undefined ? 0 : key.length + old.length) + key.length + value.length;
      if (next > LIMIT) throw new DOMException('localStorage: the limit of ' + LIMIT + ' characters is reached', 'QuotaExceededError');
      if (old === value) return;
      map.set(key, value);
      size = next;
      save();
    }

    removeItem(key) {
      key = String(key);
      const old = map.get(key);
      if (old === undefined) return;
      size -= key.length + old.length;
      map.delete(key);
      save();
    }

    clear() {
      if (map.size === 0) return;
      map = new Map();
      size = 0;
      save();
    }
  }
  return new Storage();
}
