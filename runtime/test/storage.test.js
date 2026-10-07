import { test, assert, assertEqual, assertThrows, run } from './harness.js';
import { flush, load, path } from 'maemo:storage';
import { dataDir, id } from 'maemo:app';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the id comes from the module name, and the data dir from MR_DATA_DIR', () => {
  assertEqual(id, 'storage.test');
  assert(dataDir.endsWith('/storage.test'), dataDir);
  assert(path().startsWith(dataDir + '/'), path());
});

test('setItem reaches the file after a flush, and the file is JSON', () => {
  localStorage.clear();
  localStorage.setItem('ha.server', 'http://h:8123');
  localStorage.setItem('n', 1);
  assertEqual([localStorage.length, localStorage.getItem('n'), localStorage.key(0)], [2, '1', 'ha.server']);
  flush();
  assertEqual(JSON.parse(load()), { 'ha.server': 'http://h:8123', n: '1' });
});

test('the write happens during idle time without a flush', async () => {
  localStorage.setItem('idle', 'yes');
  await sleep(200);
  assertEqual(JSON.parse(load()).idle, 'yes');
});

test('removeItem and clear reach the file', () => {
  localStorage.removeItem('idle');
  flush();
  assertEqual(JSON.parse(load()).idle, undefined);
  localStorage.clear();
  flush();
  assertEqual(load(), '{}');
});

test('the quota', () => {
  assertThrows(() => localStorage.setItem('big', 'x'.repeat(1024 * 1024)), /QuotaExceededError/);
  assertEqual(localStorage.length, 0);
});

await run();
