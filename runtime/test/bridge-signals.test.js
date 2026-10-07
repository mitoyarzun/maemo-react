import { test, assertEqual, assertThrows, run } from './harness.js';
import { create, set, connect, call, destroy } from 'maemo:gobject';
import { stats } from 'maemo:debug';

test('a handler runs when the signal is emitted', () => {
  const b = create('GtkButton');
  let n = 0;
  connect(b, 'clicked', () => { n++; });
  call(b, 'button.clicked');
  call(b, 'button.clicked');
  assertEqual(n, 2);
  destroy(b);
});

test('signal arguments arrive as JavaScript values', () => {
  const l = create('GtkLabel');
  let got;
  connect(l, 'can-activate-accel', (id) => { got = id; });
  call(l, 'object.emit', 'can-activate-accel', 7);
  assertEqual(got, 7);
  destroy(l);
});

test('the return value of the handler becomes the signal result', () => {
  const b = create('GtkButton');
  assertEqual(call(b, 'object.emit', 'popup-menu'), false);
  connect(b, 'popup-menu', () => true);
  assertEqual(call(b, 'object.emit', 'popup-menu'), true);
  destroy(b);
});

test('a detailed signal: notify::label', () => {
  const l = create('GtkLabel');
  let n = 0;
  connect(l, 'notify::label', () => { n++; });
  set(l, 'label', 'a');
  set(l, 'wrap', true);
  assertEqual(n, 1);
  destroy(l);
});

test('errors: unknown signal, and a handler that is not a function', () => {
  const l = create('GtkLabel');
  assertThrows(() => connect(l, 'nope', () => {}), /GtkLabel has no signal 'nope'/);
  assertThrows(() => connect(l, 'show', 'x'), /handler must be a function/);
  destroy(l);
});

test('destroying the object frees its closures', () => {
  const before = stats().closures;
  const b = create('GtkButton');
  connect(b, 'clicked', () => {});
  connect(b, 'enter', () => {});
  assertEqual(stats().closures, before + 2);
  destroy(b);
  assertEqual(stats().closures, before);
});

test('a handler that destroys its own button', () => {
  const b = create('GtkButton');
  let ran = false;
  connect(b, 'clicked', () => {
    destroy(b);
    const junk = [];
    for (let i = 0; i < 100; i++) junk.push({ i, s: 'x' + i });
    ran = junk.length === 100;
  });
  call(b, 'button.clicked');
  assertEqual(ran, true);
});

test('a handler that destroys its own window', () => {
  const w = create('GtkWindow');
  let ran = false;
  connect(w, 'show', () => {
    destroy(w);
    const junk = [];
    for (let i = 0; i < 100; i++) junk.push({ i, s: 'x' + i });
    ran = junk.length === 100;
  });
  call(w, 'object.emit', 'show');
  assertEqual(ran, true);
});

await run();
