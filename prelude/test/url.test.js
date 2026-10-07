import { describe, expect, test } from 'vitest';
import { URL as OurURL, URLSearchParams as OurParams } from '../src/url.js';

// Node's URL is a full WHATWG implementation, so it is the reference.
const CASES = [
  ['https://Example.COM:443/a/./b/../c?x=1#frag'],
  ['http://user:pa ss@host:8080/p a t h?q a#f a'],
  ['HTTP://example.com'],
  ['https://example.com/%7Euser/'],
  ['https://example.com/Ñandú?€=1#ü'],
  ['ws://example.com:80/chat'],
  ['https://[::1]:8443/x'],
  ['mailto:someone@example.com'],
  ['file:///etc/hosts'],
  ['file:/etc/x'],
  ['file://localhost/etc/x'],
  ['../d', 'https://example.com/a/b/c'],
  ['/root', 'https://example.com/a/b'],
  ['//other.org/x', 'https://example.com/a'],
  ['?q=2', 'https://example.com/a?q=1#f'],
  ['#top', 'https://example.com/a?q=1'],
  ['', 'https://example.com/a?q=1#f'],
  ['x/./y/../z', 'http://example.com/dir/file'],
  ['http:rel', 'http://example.com/dir/file'],
  ['  https://example.com/trim  '],
  ['https://example.com\\back\\slash'],
  ['https://example.com/a/%2e%2E/b'],
  ['https://example.com/a/b/..'],
  ['https://example.com?'],
  ['https://example.com/#'],
  ['https://u@example.com/'],
  ['https://example.com:/x'],
  ["https://example.com/?a='b'"],
  ['data:text/plain,hello'],
  ['https://example.com/a?b=c\\d'],
  ['..', 'https://example.com/a/b/c'],
  ['https://EXAMPLE.com/%41'],
];
const FIELDS = ['href', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'origin'];

describe('URL gives the same result as Node', () => {
  for (const [input, base] of CASES) {
    test(JSON.stringify(input) + (base ? ' against ' + base : ''), () => {
      const ours = new OurURL(input, base);
      const node = new URL(input, base);
      for (const f of FIELDS) expect([f, ours[f]]).toEqual([f, node[f]]);
    });
  }
});

test.each(['https://exa mple.com', 'http://host:99999/', 'no-scheme', 'http://[::1/x', 'https://'])(
  'invalid: %s',
  (input) => {
    expect(() => new URL(input)).toThrow(TypeError);
    expect(() => new OurURL(input)).toThrow(TypeError);
  },
);

test('internationalized host names give a clear error', () => {
  expect(() => new OurURL('https://ñ.example/')).toThrow(/internationalized host names are not supported/);
});

test.each(['a=1&b=2&a=3', 'x=a+b%20c&y=%E2%82%AC', '=empty&novalue', '&&a=1&&'])('URLSearchParams %s', (q) => {
  const ours = new OurParams(q);
  const node = new URLSearchParams(q);
  expect(ours.toString()).toBe(node.toString());
  expect([...ours]).toEqual([...node]);
});

test('searchParams and search stay linked', () => {
  const ours = new OurURL('https://e.com/?a=1');
  const node = new URL('https://e.com/?a=1');
  ours.searchParams.append('b', 'x y');
  node.searchParams.append('b', 'x y');
  expect(ours.href).toBe(node.href);
  ours.search = '?z=9';
  expect(ours.searchParams.get('z')).toBe('9');
  ours.searchParams.delete('z');
  expect(ours.href).toBe('https://e.com/');
});

test('URL.canParse', () => {
  expect(OurURL.canParse('https://e.com/')).toBe(true);
  expect(OurURL.canParse('nope')).toBe(false);
});
