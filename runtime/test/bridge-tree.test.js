import { test, assert, assertEqual, assertThrows, run } from './harness.js';
import { create, set, get, childSet, childGet, call, connect, destroy } from 'maemo:gobject';
import { stats, gc } from 'maemo:debug';
import { platform } from 'maemo:app';

test('container.add, container.indexOf and box.reorder', () => {
  const box = create('GtkVBox');
  const a = create('GtkLabel');
  const b = create('GtkLabel');
  call(box, 'container.add', a);
  call(box, 'container.add', b);
  assertEqual([call(box, 'container.indexOf', a), call(box, 'container.indexOf', b)], [0, 1]);
  call(box, 'box.reorder', b, 0);
  assertEqual(call(box, 'container.indexOf', b), 0);
  call(box, 'box.reorder', b, -1);
  assertEqual(call(box, 'container.indexOf', b), 1);
  destroy(box);
});

test('childSet and childGet', () => {
  const box = create('GtkHBox');
  const a = create('GtkLabel');
  call(box, 'container.add', a);
  childSet(box, a, 'expand', false);
  childSet(box, a, 'padding', 4);
  childSet(box, a, 'pack-type', 'end');
  assertEqual([childGet(box, a, 'expand'), childGet(box, a, 'padding'), childGet(box, a, 'pack-type')], [false, 4, 'end']);
  destroy(box);
});

test('childSet checks the parent and the property', () => {
  const box = create('GtkVBox');
  const a = create('GtkLabel');
  assertThrows(() => childSet(box, a, 'expand', true), /is not a child of/);
  call(box, 'container.add', a);
  assertThrows(() => childSet(box, a, 'nope', 1), /GtkVBox has no child property 'nope'/);
  destroy(box);
});

test('widget.removeFromParent', () => {
  const box = create('GtkVBox');
  const a = create('GtkLabel');
  call(box, 'container.add', a);
  call(a, 'widget.removeFromParent');
  assertEqual(call(box, 'container.indexOf', a), -1);
  destroy(box);
  destroy(a);
});

test('scrolled.add adds a viewport, and removal takes it away', () => {
  const s = create('GtkScrolledWindow');
  const inner = create('GtkVBox');
  const inner2 = create('GtkVBox');
  call(s, 'scrolled.add', inner);
  call(inner, 'widget.removeFromParent');
  call(s, 'scrolled.add', inner2); // a GTK critical (fatal in tests) if the old viewport stayed
  destroy(s);
  destroy(inner);
});

test('a helper checks the type of the object', () => {
  const l = create('GtkLabel');
  assertThrows(() => call(l, 'box.reorder', l, 0), /helper 'box.reorder' needs a GtkBox, got a GtkLabel/);
  assertThrows(() => call(l, 'nope'), /has no helper 'nope'/);
  destroy(l);
});

test('destroy releases the handles of the children', () => {
  const before = stats().handles;
  const box = create('GtkVBox');
  const l = create('GtkLabel');
  call(box, 'container.add', l);
  destroy(box);
  assertEqual(stats().handles, before);
  assertThrows(() => get(l, 'label'), /invalid handle/);
});

test('1000 create and destroy cycles leak no handles or closures', () => {
  gc();
  const before = stats();
  for (let i = 0; i < 1000; i++) {
    const box = create('GtkVBox');
    for (let j = 0; j < 3; j++) {
      const l = create('GtkLabel');
      set(l, 'label', 'row ' + j);
      call(box, 'container.add', l);
    }
    const b = create('GtkButton');
    connect(b, 'clicked', () => {});
    call(box, 'container.add', b);
    destroy(box);
  }
  gc();
  const after = stats();
  assertEqual(after.handles, before.handles);
  assertEqual(after.closures, before.closures);
  assert(after.jsMallocSize - before.jsMallocSize < 256 * 1024,
    'the JS heap grew by ' + (after.jsMallocSize - before.jsMallocSize) + ' bytes');
});

test('a window: registerProgram, show, destroy', () => {
  const w = create(platform === 'hildon' ? 'HildonWindow' : 'GtkWindow');
  call(w, 'window.registerProgram');
  call(w, 'widget.show');
  destroy(w);
});

await run();
