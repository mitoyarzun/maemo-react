import { test, assertEqual, run } from './harness.js';

test('the prelude installs the globals', () => {
  for (const name of ['TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'queueMicrotask']) {
    assertEqual([name, typeof globalThis[name]], [name, 'function']);
  }
});

test('a UTF-8 round trip in QuickJS', () => {
  const s = 'Ñandú € 😀';
  assertEqual(new TextDecoder().decode(new TextEncoder().encode(s)), s);
  assertEqual(new TextEncoder().encode('€').length, 3);
});

test('URL resolves a relative reference in QuickJS', () => {
  assertEqual(new URL('../x?y=1', 'https://example.com/a/b/c').href, 'https://example.com/a/x?y=1');
});

test('queueMicrotask runs before a timer', async () => {
  const seen = [];
  setTimeout(() => seen.push('timer'), 0);
  queueMicrotask(() => seen.push('micro'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEqual(seen, ['micro', 'timer']);
});

test('console.log formats objects', () => {
  console.log({ a: 1, b: [1, 2], c: 'x' });
});

await run();
