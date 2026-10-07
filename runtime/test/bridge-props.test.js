import { test, assertEqual, assertThrows, run } from './harness.js';
import { create, set, get, reset, destroy } from 'maemo:gobject';

test('create, then set and get a string', () => {
  const l = create('GtkLabel');
  set(l, 'label', 'hi');
  assertEqual(get(l, 'label'), 'hi');
  destroy(l);
});

test('UTF-8 text', () => {
  const l = create('GtkLabel');
  const s = 'Ñandú € 😀 日本';
  set(l, 'label', s);
  assertEqual(get(l, 'label'), s);
  destroy(l);
});

test('a boolean must be a boolean', () => {
  const l = create('GtkLabel');
  set(l, 'wrap', true);
  assertEqual(get(l, 'wrap'), true);
  assertThrows(() => set(l, 'wrap', 1), /TypeError: GtkLabel.wrap: expected a boolean/);
  destroy(l);
});

test('an integer with a range check', () => {
  const b = create('GtkVBox');
  set(b, 'spacing', 6);
  assertEqual(get(b, 'spacing'), 6);
  assertThrows(() => set(b, 'spacing', -1), /RangeError/);
  assertThrows(() => set(b, 'spacing', 1.5), /expected an integer/);
  assertThrows(() => set(b, 'spacing', '6'), /expected a number/);
  destroy(b);
});

test('a float with a range check', () => {
  const l = create('GtkLabel');
  set(l, 'xalign', 0.25);
  assertEqual(get(l, 'xalign'), 0.25);
  assertThrows(() => set(l, 'xalign', 2), /RangeError/);
  destroy(l);
});

test('an enum by nickname', () => {
  const s = create('GtkScrolledWindow');
  set(s, 'hscrollbar-policy', 'never');
  assertEqual(get(s, 'hscrollbar-policy'), 'never');
  assertThrows(() => set(s, 'hscrollbar-policy', 'sometimes'), /expected one of: always, automatic, never/);
  destroy(s);
});

test('flags as an array of nicknames', () => {
  const l = create('GtkEventBox');
  set(l, 'events', ['button-press-mask', 'key-press-mask']);
  assertEqual(get(l, 'events'), ['button-press-mask', 'key-press-mask']);
  destroy(l);
});

test('an object property takes a handle', () => {
  const l = create('GtkLabel');
  const b = create('GtkButton');
  set(l, 'mnemonic-widget', b);
  assertEqual(get(l, 'mnemonic-widget'), b);
  set(l, 'mnemonic-widget', null);
  assertEqual(get(l, 'mnemonic-widget'), null);
  destroy(l);
  destroy(b);
});

test('a GdkColor from #rrggbb', () => {
  const c = create('GtkCellRendererText');
  set(c, 'foreground-gdk', '#ff8000');
  assertEqual(get(c, 'foreground-gdk'), '#ff8000');
  assertThrows(() => set(c, 'foreground-gdk', 'not a color'), /is not a color/);
  destroy(c);
});

test('reset sets the default value', () => {
  const b = create('GtkVBox');
  set(b, 'spacing', 9);
  reset(b, 'spacing');
  assertEqual(get(b, 'spacing'), 0);
  destroy(b);
});

test('errors name the type and the property', () => {
  const l = create('GtkLabel');
  assertThrows(() => set(l, 'nope', 1), /GtkLabel has no property 'nope'/);
  assertThrows(() => create('GtkNope'), /'GtkNope' is not a GObject type/);
  assertThrows(() => create('GtkWidget'), /'GtkWidget' is not a GObject type that can be created/);
  destroy(l);
});

test('construct-only properties cannot be set', () => {
  const w = create('GtkWindow');
  assertThrows(() => set(w, 'type', 'popup'), /property 'type' of GtkWindow is not writable/);
  destroy(w);
});

test('destroy is idempotent, and the handle is then invalid', () => {
  const l = create('GtkLabel');
  destroy(l);
  destroy(l);
  assertThrows(() => get(l, 'label'), /invalid handle/);
});

test('an interface property takes a handle of an object that implements it', () => {
  const view = create('GtkTreeView');
  const store = create('GtkListStore');
  const label = create('GtkLabel');
  set(view, 'model', store);
  assertEqual(get(view, 'model'), store);
  assertThrows(() => set(view, 'model', label), /GtkTreeView.model: expected a GtkTreeModel, got a GtkLabel/);
  set(view, 'model', null);
  assertEqual(get(view, 'model'), null);
  destroy(view);
  destroy(store);
  destroy(label);
});

await run();
