import { expect, test } from 'vitest';
import { format, inspect } from '../src/console.js';

test('inspect formats nested values, cycles and special objects', () => {
  const a = {
    x: 1,
    'a-b': 'str',
    arr: [1, 'two', null, undefined],
    nested: { deep: { deeper: { deepest: 1 } } },
    f: function named() {},
    m: new Map([[1, 'a']]),
    s: new Set(),
    u8: new Uint8Array(3),
  };
  a.self = a;
  expect(inspect(a)).toBe(
    '{ x: 1, "a-b": "str", arr: [ 1, "two", null, undefined ], nested: { deep: { deeper: [Object] } }, ' +
      'f: [Function named], m: Map(1) { 1 => "a" }, s: Set(0) {}, u8: Uint8Array(3), self: [Circular] }',
  );
});

test('format keeps top-level strings as they are', () => {
  expect(format(['plain', 42, [], {}])).toBe('plain 42 [] {}');
});

test('errors print their name, message and stack', () => {
  expect(format([new Error('boom')]).split('\n')[0]).toBe('Error: boom');
});
