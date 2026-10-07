import { test, assertEqual, assertThrows, run } from './harness.js';
import { create, set, get, call, connect, destroy } from 'maemo:gobject';
import { stats } from 'maemo:debug';

function newStore() {
  const s = create('GtkListStore');
  call(s, 'listStore.setColumnTypes', ['string', 'boolean', 'number']);
  return s;
}

const names = (s) => {
  const out = [];
  for (let i = 0; i < call(s, 'listStore.length'); i++) out.push(call(s, 'listStore.get', i, 0));
  return out;
};

test('insert, get, set and length', () => {
  const s = newStore();
  call(s, 'listStore.insert', 0, ['a', true, 1.5]);
  call(s, 'listStore.insert', 1, ['b', false, 2]);
  call(s, 'listStore.insert', 0, ['first', false, 0]);
  assertEqual(call(s, 'listStore.length'), 3);
  assertEqual(names(s), ['first', 'a', 'b']);
  assertEqual([call(s, 'listStore.get', 1, 1), call(s, 'listStore.get', 1, 2)], [true, 1.5]);
  call(s, 'listStore.set', 1, 0, 'A');
  call(s, 'listStore.set', 1, 1, false);
  assertEqual([call(s, 'listStore.get', 1, 0), call(s, 'listStore.get', 1, 1)], ['A', false]);
  destroy(s);
});

test('UTF-8 text in a cell', () => {
  const s = newStore();
  call(s, 'listStore.insert', -1, ['Lámpara del salón €', false, 0]);
  assertEqual(call(s, 'listStore.get', 0, 0), 'Lámpara del salón €');
  destroy(s);
});

test('an index past the end and -1 append', () => {
  const s = newStore();
  call(s, 'listStore.insert', 99, ['x', false, 0]);
  call(s, 'listStore.insert', -1, ['y', false, 0]);
  assertEqual(names(s), ['x', 'y']);
  destroy(s);
});

test('remove, move and clear', () => {
  const s = newStore();
  for (const k of ['a', 'b', 'c', 'd']) call(s, 'listStore.insert', -1, [k, false, 0]);
  call(s, 'listStore.move', 3, 0);
  assertEqual(names(s), ['d', 'a', 'b', 'c']);
  call(s, 'listStore.move', 0, 3);
  assertEqual(names(s), ['a', 'b', 'c', 'd']);
  call(s, 'listStore.move', 1, 2);
  assertEqual(names(s), ['a', 'c', 'b', 'd']);
  call(s, 'listStore.move', 2, 2);
  assertEqual(names(s), ['a', 'c', 'b', 'd']);
  call(s, 'listStore.remove', 1);
  assertEqual(names(s), ['a', 'b', 'd']);
  call(s, 'listStore.clear');
  assertEqual(call(s, 'listStore.length'), 0);
  destroy(s);
});

test('errors: column types, row counts, rows and columns', () => {
  const s = newStore();
  assertThrows(() => call(s, 'listStore.insert', 0, ['a', true]), /has 2 values, the store has 3 columns/);
  assertThrows(() => call(s, 'listStore.insert', 0, ['a', 'yes', 0]), /listStore.insert: expected a boolean/);
  call(s, 'listStore.insert', 0, ['a', true, 0]);
  assertThrows(() => call(s, 'listStore.set', 5, 0, 'x'), /RangeError: listStore.set: no row 5/);
  assertThrows(() => call(s, 'listStore.set', 0, 7, 'x'), /RangeError: listStore.set: no column 7/);
  assertThrows(() => call(s, 'listStore.remove', 1), /no row 1/);
  assertThrows(() => call(s, 'listStore.move', 0, 4), /no row 4/);
  assertEqual(call(s, 'listStore.length'), 1);
  const bad = create('GtkListStore');
  assertThrows(() => call(bad, 'listStore.setColumnTypes', ['date']), /column 0 is not 'string', 'boolean' or 'number'/);
  assertThrows(() => call(bad, 'listStore.setColumnTypes', []), /at least one column/);
  destroy(s);
  destroy(bad);
});

test('a tree view shows a store through columns and reports the selection', () => {
  const before = stats().handles;
  const s = newStore();
  const view = create('GtkTreeView');
  set(view, 'model', s);
  const col = create('GtkTreeViewColumn');
  const text = create('GtkCellRendererText');
  const toggle = create('GtkCellRendererToggle');
  call(col, 'column.pack', text);
  call(col, 'column.addAttribute', text, 'text', 0);
  call(col, 'column.pack', toggle);
  call(col, 'column.addAttribute', toggle, 'active', 1);
  assertEqual(call(view, 'treeView.appendColumn', col), 1);
  assertEqual(call(view, 'treeView.renderer', 0), text);
  for (const k of ['a', 'b', 'c']) call(s, 'listStore.insert', -1, [k, k === 'b', 0]);
  const sel = call(view, 'treeView.selection');
  assertEqual(call(view, 'treeView.selection'), sel);
  let changes = 0;
  connect(sel, 'changed', () => { changes++; });
  assertEqual(call(view, 'treeView.selectedIndex'), -1);
  call(view, 'treeView.selectIndex', 2);
  assertEqual(call(view, 'treeView.selectedIndex'), 2);
  assertEqual(changes, 1);
  call(s, 'listStore.remove', 2); // the selected row goes away
  assertEqual(call(view, 'treeView.selectedIndex'), -1);
  call(view, 'treeView.selectIndex', 0);
  call(view, 'treeView.selectIndex', -1);
  assertEqual(call(view, 'treeView.selectedIndex'), -1);
  assertThrows(() => call(view, 'treeView.selectIndex', 9), /no row 9/);
  assertThrows(() => call(view, 'treeView.renderer', 3), /no column 3/);
  destroy(view);
  for (const h of [col, text, toggle, sel, s]) destroy(h);
  assertEqual(stats().handles, before);
});

test('a toggle renderer emits toggled with the row path', () => {
  const r = create('GtkCellRendererToggle');
  set(r, 'activatable', true);
  let got;
  connect(r, 'toggled', (path) => { got = path; });
  call(r, 'object.emit', 'toggled', '12');
  assertEqual(got, '12');
  destroy(r);
});

test('the helpers check the type of the object and of the arguments', () => {
  const l = create('GtkLabel');
  const view = create('GtkTreeView');
  const col = create('GtkTreeViewColumn');
  assertThrows(() => call(l, 'listStore.length'), /helper 'listStore.length' needs a GtkListStore, got a GtkLabel/);
  assertThrows(() => call(view, 'treeView.appendColumn', l), /expected a GtkTreeViewColumn, got a GtkLabel/);
  assertThrows(() => call(col, 'column.pack', l), /expected a cell renderer, got a GtkLabel/);
  assertThrows(() => call(col, 'column.addAttribute', l), /expected a cell renderer/);
  assertThrows(() => call(view, 'treeView.selectIndex', 'x'), /argument 1 must be a number/);
  destroy(l);
  destroy(view);
  destroy(col);
});

await run();
