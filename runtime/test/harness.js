// A small test API for runtime tests. They run inside maemo-react-host.
import { quit } from 'maemo:app';

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed' + (msg ? ': ' + msg : ''));
}

export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

export function assertThrows(fn, pattern, msg) {
  try {
    fn();
  } catch (e) {
    const text = String(e && e.name) + ': ' + String(e && e.message);
    if (pattern && !pattern.test(text)) {
      throw new Error((msg ? msg + ': ' : '') + 'wrong error: ' + text);
    }
    return e;
  }
  throw new Error((msg ? msg + ': ' : '') + 'expected an exception');
}

export async function assertRejects(promise, pattern, msg) {
  try {
    await promise;
  } catch (e) {
    const text = String(e && e.name) + ': ' + String(e && e.message);
    if (pattern && !pattern.test(text)) {
      throw new Error((msg ? msg + ': ' : '') + 'wrong rejection: ' + text);
    }
    return e;
  }
  throw new Error((msg ? msg + ': ' : '') + 'expected a rejection');
}

export async function run() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('ok - ' + t.name);
    } catch (e) {
      failed++;
      console.log('not ok - ' + t.name + ': ' + ((e && e.stack) || e));
    }
  }
  console.log(failed ? 'FAIL ' + failed + ' of ' + tests.length : 'PASS ' + tests.length);
  quit(failed ? 1 : 0);
}
