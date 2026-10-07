import { expect, test } from 'vitest';
import { camel, emit, pascal, tsType } from '../emit.mjs';

const prop = (name, value, extra = {}) => ({ name, value, readable: true, writable: true, constructOnly: false, ...extra });
const DATA = {
  gtk: '2.10.12',
  classes: [
    {
      name: 'GtkWidget',
      parent: null,
      abstract: true,
      properties: [
        prop('visible', { type: 'gboolean', kind: 'boolean' }),
        prop('parent', { type: 'GtkContainer', kind: 'object' }),
      ],
      childProperties: [],
      signals: [{ name: 'show', returns: { type: 'void', kind: 'other' }, params: [] }],
    },
    {
      name: 'GtkLabel',
      parent: 'GtkWidget',
      abstract: false,
      properties: [
        prop('label', { type: 'gchararray', kind: 'string' }),
        prop('max-width-chars', { type: 'gint', kind: 'number' }),
        prop('justify', { type: 'GtkJustification', kind: 'enum', values: ['left', 'right'] }),
        prop('cursor-position', { type: 'gint', kind: 'number' }, { writable: false }),
        prop('pattern', { type: 'gchararray', kind: 'string' }, { constructOnly: true }),
        prop('attributes', { type: 'PangoAttrList', kind: 'other' }),
      ],
      childProperties: [],
      signals: [
        { name: 'populate-popup', returns: { type: 'void', kind: 'other' }, params: [{ type: 'GtkMenu', kind: 'object' }] },
        { name: 'activate-link', returns: { type: 'gboolean', kind: 'boolean' }, params: [] },
      ],
    },
  ],
};

test('emit writes a props interface for each class', () => {
  const out = emit(DATA, { 'gtk-label': ['GtkLabel', 'text'] });
  expect(out).toContain('export interface GtkWidgetProps extends CommonProps {');
  expect(out).toContain('export interface GtkLabelProps extends GtkWidgetProps {');
  expect(out).toContain('  label?: string | null;');
  expect(out).toContain('  maxWidthChars?: number;');
  expect(out).toContain('  justify?: "left" | "right";');
  expect(out).toContain('  onShow?: (target: WidgetTarget) => void;');
  expect(out).toContain('  onPopulatePopup?: (arg0: Handle | null, target: WidgetTarget) => void;');
  expect(out).toContain('  onActivateLink?: (target: WidgetTarget) => boolean | void;');
  expect(out).toContain("  'gtk-label': GtkLabelProps & { children?: string | number | Array<string | number> };");
});

test('emit leaves out what JSX cannot set', () => {
  const out = emit(DATA, { 'gtk-label': ['GtkLabel', 'text'] });
  expect(out).not.toContain('parent?:');
  expect(out).not.toContain('cursorPosition');
  expect(out).not.toContain('pattern?:');
  expect(out).not.toContain('attributes?:');
});

test('emit refuses an element whose class is missing', () => {
  expect(() => emit(DATA, { 'gtk-nope': ['GtkNope', 'none'] })).toThrow(/no class GtkNope/);
});

test('emit mixes the extension props into an element and writes their interfaces', () => {
  const out = emit(DATA, { 'gtk-label': ['GtkLabel', 'text'] }, { 'gtk-label': 'RangeElementProps' });
  expect(out).toContain('export interface ListRow {');
  expect(out).toContain('export interface RangeElementProps {');
  expect(out).toContain("  'gtk-label': GtkLabelProps & RangeElementProps & { children?: string | number | Array<string | number> };");
});

test('emit omits a class prop that an extension prop replaces', () => {
  const data = {
    gtk: '2.10.12',
    classes: [{ name: 'GtkRange', parent: null, properties: [], signals: [{ name: 'change-value', params: [], returns: { kind: 'boolean' } }] }],
  };
  const out = emit(data, { 'gtk-range': ['GtkRange', 'none'] }, { 'gtk-range': 'RangeElementProps' });
  expect(out).toContain("  'gtk-range': Omit<GtkRangeProps, 'onChangeValue'> & RangeElementProps & { children?: never };");
});

test('emit omits the model of a tree view and a combo box: the renderer owns it', () => {
  const data = {
    gtk: '2.10.12',
    classes: [
      { name: 'GtkTreeView', parent: null, properties: [{ name: 'model', writable: true, constructOnly: false, value: { kind: 'object' } }], signals: [] },
      { name: 'GtkComboBox', parent: null, properties: [{ name: 'model', writable: true, constructOnly: false, value: { kind: 'object' } }], signals: [] },
    ],
  };
  const out = emit(data, { 'gtk-tree-view': ['GtkTreeView', 'none'], 'gtk-combo-box': ['GtkComboBox', 'none'] }, { 'gtk-tree-view': 'ListElementProps', 'gtk-combo-box': 'ComboElementProps' });
  expect(out).toContain("  'gtk-tree-view': Omit<GtkTreeViewProps, 'model'> & ListElementProps & { children?: never };");
  expect(out).toContain("  'gtk-combo-box': Omit<GtkComboBoxProps, 'model'> & ComboElementProps & { children?: never };");
});

test('names and types', () => {
  expect(camel('hscrollbar-policy')).toBe('hscrollbarPolicy');
  expect(pascal('delete-event')).toBe('DeleteEvent');
  expect(tsType({ kind: 'flags', values: ['a', 'b'] })).toBe('Array<"a" | "b">');
  expect(tsType({ kind: 'color' })).toBe('string');
});

test('typegen and core list the same elements', async () => {
  const { ELEMENTS: core } = await import('../../packages/core/src/elements.ts');
  const { ELEMENTS: typegen } = await import('../emit.mjs');
  expect(Object.keys(typegen).sort()).toEqual(Object.keys(core).sort());
  for (const [name, [gtype]] of Object.entries(typegen)) {
    const g = core[name].gtype;
    expect(typeof g === 'function' ? g('hildon') : g).toBe(gtype);
  }
});
