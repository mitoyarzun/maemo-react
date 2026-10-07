import { expect, test } from 'vitest';
import { TextDecoder as OurDecoder, TextEncoder as OurEncoder } from '../src/encoding.js';

// Node implements the WHATWG Encoding standard, so it is the reference.
const hex = (u8) => Buffer.from(u8).toString('hex');

test.each(['', 'abc', 'Ñandú € 😀', '\uD800x', 'x\uDFFF', '\u{10FFFF}'])('encode %j like Node', (s) => {
  expect(hex(new OurEncoder().encode(s))).toBe(hex(new TextEncoder().encode(s)));
});

test.each(['c3b1', 'c080', 'e282', 'eda080', 'f4908080', 'efbbbf41', 'f09f9880', 'ff', 'e2ac', '61e2828262', 'f0908d'])(
  'decode %s like Node',
  (h) => {
    const bytes = Buffer.from(h, 'hex');
    expect(new OurDecoder().decode(bytes)).toBe(new TextDecoder().decode(bytes));
  },
);

test('ignoreBOM keeps the byte order mark', () => {
  expect(new OurDecoder('utf-8', { ignoreBOM: true }).decode(Buffer.from('efbbbf41', 'hex'))).toBe('﻿A');
});

test('fatal throws on bad data', () => {
  expect(() => new OurDecoder('utf-8', { fatal: true }).decode(Buffer.from('ff', 'hex'))).toThrow(TypeError);
});

test('only UTF-8 is supported', () => {
  expect(() => new OurDecoder('latin1')).toThrow(RangeError);
});

test('decode takes an ArrayBuffer, a typed array or a DataView', () => {
  const u8 = new OurEncoder().encode('hi');
  expect(new OurDecoder().decode(u8.buffer)).toBe('hi');
  expect(new OurDecoder().decode(new DataView(u8.buffer))).toBe('hi');
});
