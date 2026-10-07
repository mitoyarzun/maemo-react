import { test, assert, assertEqual, run } from './harness.js';
import { args, version, platform } from 'maemo:app';

test('console.log prints a line', () => {
  console.log('hello from QuickJS');
});

test('maemo:app exports the version, the platform and the arguments', () => {
  assertEqual(version, '0.3.0');
  assert(platform === 'hildon' || platform === 'desktop', platform);
  assert(args[0].endsWith('app.test.js'), args[0]);
});

test('performance.now() does not go back', () => {
  const a = performance.now();
  let x = 0;
  for (let i = 0; i < 100000; i++) x += i;
  assert(performance.now() >= a && x > 0);
});

await run();
