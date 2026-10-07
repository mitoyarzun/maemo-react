import { test, assertEqual, assertThrows, run } from './harness.js';
import { create, set, get, call, connect, destroy } from 'maemo:gobject';
import { stats } from 'maemo:debug';
import { platform } from 'maemo:app';

const WINDOW = platform === 'hildon' ? 'HildonWindow' : 'GtkWindow';

test('range helpers: setRange, setIncrements, setValue and getValue', () => {
  const s = create('GtkHScale');
  call(s, 'range.setRange', 0, 100);
  call(s, 'range.setIncrements', 5, 50);
  let n = 0;
  connect(s, 'value-changed', () => { n++; });
  call(s, 'range.setValue', 40);
  assertEqual(call(s, 'range.getValue'), 40);
  assertEqual(n, 1);
  call(s, 'range.setValue', 150); // out of the range: GTK clamps it
  assertEqual(call(s, 'range.getValue'), 100);
  call(s, 'range.setValue', -3);
  assertEqual(call(s, 'range.getValue'), 0);
  assertThrows(() => call(s, 'range.setRange', 10, 10), /RangeError: range.setRange: min must be less than max/);
  assertThrows(() => call(s, 'range.setValue', 'x'), /argument 1 must be a number/);
  destroy(s);
});

test('a discontinuous range reports the value once, when the slider is released', () => {
  // The Scale element uses this policy: the value changes on the release, not
  // during the drag (the HA Remote spec, section 4). The property must exist.
  const s = create('GtkVScale');
  set(s, 'update-policy', 'discontinuous');
  assertEqual(get(s, 'update-policy'), 'discontinuous');
  destroy(s);
});

test('comboBox.setItems fills a text combo box', () => {
  const c = create('GtkComboBox');
  call(c, 'comboBox.setItems', ['heat', 'cool', 'off']);
  assertEqual(get(c, 'active'), -1);
  assertEqual(call(c, 'comboBox.activeText'), null);
  set(c, 'active', 1);
  assertEqual(call(c, 'comboBox.activeText'), 'cool');
  let changes = 0;
  connect(c, 'changed', () => { changes++; });
  call(c, 'comboBox.setItems', ['auto']);
  assertEqual(get(c, 'active'), -1);
  assertEqual(changes >= 1, true);
  set(c, 'active', 0);
  assertEqual(call(c, 'comboBox.activeText'), 'auto');
  assertThrows(() => call(c, 'comboBox.setItems', [1]), /item 0 is not a string/);
  assertThrows(() => call(c, 'comboBox.setItems', 'x'), /argument 1 must be an array/);
  destroy(c);
});

test('a window menu: items, order, set, replace and remove', () => {
  const before = stats().handles;
  const w = create(WINDOW);
  const m = create('GtkMenu');
  const a = create('GtkMenuItem');
  const b = create('GtkMenuItem');
  const label = create('GtkLabel');
  set(label, 'label', 'Reconnect');
  call(a, 'container.add', label);
  call(m, 'container.add', a);
  call(m, 'container.add', b);
  assertEqual([call(m, 'container.indexOf', a), call(m, 'container.indexOf', b)], [0, 1]);
  call(m, 'menu.reorder', b, 0);
  assertEqual(call(m, 'container.indexOf', b), 0);
  call(m, 'menu.reorder', b, -1);
  assertEqual(call(m, 'container.indexOf', b), 1);
  let fired = 0;
  connect(a, 'activate', () => { fired++; });
  call(a, 'object.emit', 'activate');
  assertEqual(fired, 1);
  call(w, 'window.setMenu', m);
  call(w, 'window.setMenu', null);
  call(w, 'window.setMenu', m);
  assertThrows(() => call(w, 'window.setMenu', a), /expected a GtkMenu, got a GtkMenuItem/);
  assertThrows(() => call(a, 'menu.reorder', b, 0), /needs a GtkMenu, got a GtkMenuItem/);
  call(b, 'widget.removeFromParent');
  destroy(b);
  call(w, 'window.setMenu', null);
  destroy(m); // frees the menu, its items and its popup window
  destroy(w);
  assertEqual(stats().handles, before);
});

test('a window menu destroyed first leaves no stale pointer in the window', () => {
  const before = stats().handles;
  const w = create(WINDOW);
  const m = create('GtkMenu');
  call(w, 'window.setMenu', m);
  destroy(m); // the window still has the menu: it must not keep a stale pointer
  call(w, 'window.setMenu', null);
  const m2 = create('GtkMenu');
  call(w, 'window.setMenu', m2);
  destroy(m2);
  destroy(w);
  assertEqual(stats().handles, before);
});

test('window.banner shows a banner on Hildon and prints on the desktop', () => {
  const w = create(WINDOW);
  call(w, 'window.registerProgram');
  call(w, 'widget.show');
  call(w, 'window.banner', 'Saved');
  assertThrows(() => call(w, 'window.banner', 5), /window.banner: give the text/);
  destroy(w);
});

await run();
