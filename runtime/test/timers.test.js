import { test, assert, assertEqual, assertThrows, run } from './harness.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('setTimeout runs once after the delay', async () => {
  const t0 = performance.now();
  let n = 0;
  setTimeout(() => n++, 20);
  await sleep(80);
  assertEqual(n, 1);
  assert(performance.now() - t0 >= 20);
});

test('setTimeout gives the extra arguments to the callback', async () => {
  let got;
  setTimeout((a, b) => { got = [a, b]; }, 0, 'x', 2);
  await sleep(20);
  assertEqual(got, ['x', 2]);
});

test('clearTimeout stops a timer', async () => {
  let n = 0;
  const id = setTimeout(() => n++, 10);
  clearTimeout(id);
  await sleep(40);
  assertEqual(n, 0);
});

test('setInterval repeats until clearInterval in its own callback', async () => {
  let n = 0;
  const id = setInterval(() => { if (++n === 3) clearInterval(id); }, 5);
  await sleep(150);
  assertEqual(n, 3);
});

test('a shorter delay fires first', async () => {
  const seen = [];
  setTimeout(() => seen.push(100), 100);
  setTimeout(() => seen.push(20), 20);
  await sleep(250);
  assertEqual(seen, [20, 100]);
});

test('promise jobs run before the next timer', async () => {
  const seen = [];
  setTimeout(() => seen.push('timer'), 0);
  Promise.resolve().then(() => seen.push('job'));
  await sleep(30);
  assertEqual(seen, ['job', 'timer']);
});

test('the clear functions ignore unknown ids', () => {
  clearTimeout(123456);
  clearInterval(undefined);
  clearTimeout('x');
});

test('setTimeout needs a function', () => {
  assertThrows(() => setTimeout('code', 1), /TypeError: setTimeout/);
});

await run();
