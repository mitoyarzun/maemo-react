import { describe, expect, test } from 'vitest';
import { LIMIT, createStorage } from '../src/storage.js';

// A fake maemo:storage. `saves` holds the functions that schedule() got.
function fakeBackend(text = null) {
  const b = {
    saves: [],
    bad: 0,
    load: () => text,
    schedule(fn) {
      b.saves.push(fn);
    },
    markBad() {
      b.bad++;
    },
  };
  return b;
}

const last = (b) => b.saves[b.saves.length - 1]();

describe('localStorage', () => {
  test('starts empty without a file', () => {
    const s = createStorage(fakeBackend());
    expect([s.length, s.getItem('x'), s.key(0)]).toEqual([0, null, null]);
  });

  test('loads the file', () => {
    const s = createStorage(fakeBackend('{"a":"1","b":"2"}'));
    expect([s.length, s.key(0), s.key(1), s.getItem('b')]).toEqual([2, 'a', 'b', '2']);
  });

  test('setItem, removeItem and clear schedule one write each, with the JSON', () => {
    const b = fakeBackend();
    const s = createStorage(b);
    s.setItem('k', 'v');
    expect(b.saves).toHaveLength(1);
    expect(last(b)).toBe('{"k":"v"}');
    s.setItem('k', 'v');
    expect(b.saves).toHaveLength(1);
    s.removeItem('k');
    expect(last(b)).toBe('{}');
    s.removeItem('k');
    s.clear();
    expect(b.saves).toHaveLength(2);
    s.setItem('a', '1');
    s.clear();
    expect([b.saves.length, last(b), s.length]).toEqual([4, '{}', 0]);
  });

  test('values become strings and a missing key is null', () => {
    const s = createStorage(fakeBackend());
    s.setItem('n', 42);
    s.setItem('o', { a: 1 });
    s.setItem(7, 'seven');
    expect([s.getItem('n'), s.getItem('o'), s.getItem('7'), s.getItem('missing'), s.key(9)]).toEqual(['42', '[object Object]', 'seven', null, null]);
  });

  test('a corrupt file is kept as .bad and the storage starts empty', () => {
    for (const text of ['not json', '[1]', '{"a":1}', 'null']) {
      const b = fakeBackend(text);
      const s = createStorage(b);
      expect([b.bad, s.length]).toEqual([1, 0]);
    }
  });

  test('the limit counts the keys and the values together', () => {
    const b = fakeBackend();
    const s = createStorage(b);
    expect(() => s.setItem('big', 'x'.repeat(LIMIT))).toThrow(expect.objectContaining({ name: 'QuotaExceededError' }));
    s.setItem('big', 'x'.repeat(LIMIT - 3));
    expect(() => s.setItem('more', 'y')).toThrow(expect.objectContaining({ name: 'QuotaExceededError' }));
    s.setItem('big', 'short');
    s.setItem('more', 'y');
    expect(s.length).toBe(2);
  });

  test('length and key follow the insertion order', () => {
    const s = createStorage(fakeBackend());
    s.setItem('b', '1');
    s.setItem('a', '2');
    s.setItem('b', '3');
    expect([s.length, s.key(0), s.key(1), s.key(2), s.key(-1), s.key('x')]).toEqual([2, 'b', 'a', null, null, null]);
  });
});
