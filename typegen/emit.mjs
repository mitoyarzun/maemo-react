// Turn packages/types/generated/gtk.json (made by typegen on Diablo) into
// packages/types/generated/intrinsics.d.ts: the JSX types of the
// maemo-react intrinsic elements.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** JSX element name -> [GTK class, children model]. Keep it equal to packages/core/src/elements.ts. */
export const ELEMENTS = {
  'hildon-window': ['HildonWindow', 'node'],
  'gtk-vbox': ['GtkVBox', 'node'],
  'gtk-hbox': ['GtkHBox', 'node'],
  'gtk-label': ['GtkLabel', 'text'],
  'gtk-button': ['GtkButton', 'text'],
  'gtk-toggle-button': ['GtkToggleButton', 'text'],
  'gtk-check-button': ['GtkCheckButton', 'text'],
  'gtk-entry': ['GtkEntry', 'none'],
  'gtk-hscale': ['GtkHScale', 'none'],
  'gtk-vscale': ['GtkVScale', 'none'],
  'gtk-combo-box': ['GtkComboBox', 'none'],
  'gtk-tree-view': ['GtkTreeView', 'none'],
  'gtk-scrolled-window': ['GtkScrolledWindow', 'node'],
  'gtk-menu': ['GtkMenu', 'node'],
  'gtk-menu-item': ['GtkMenuItem', 'node'],
  'gtk-separator-menu-item': ['GtkSeparatorMenuItem', 'none'],
};

/** Element -> the interface of its extension props (packages/core/src/list.ts and extensions.ts). */
export const EXTRA_PROPS = {
  'gtk-tree-view': 'ListElementProps',
  'gtk-hscale': 'RangeElementProps',
  'gtk-vscale': 'RangeElementProps',
  'gtk-combo-box': 'ComboElementProps',
  'hildon-window': 'WindowElementProps',
};

/** The hand-written interfaces of the extension props. They go into intrinsics.d.ts as they are. */
export const EXTENSION_TYPES = `
/** A row of a List. The key must be unique in the list. */
export interface ListRow {
  key: string;
  [field: string]: unknown;
}

/** A column of a List. */
export interface ListColumn {
  /** The field of the row that the column shows. */
  field: string;
  /** 'text' (default) shows the value as text. 'toggle' shows a check box for a boolean, and nothing for null. */
  kind?: 'text' | 'toggle';
  /** The header text. */
  title?: string;
  /** Take the extra width. */
  expand?: boolean;
}

/** The props of <gtk-tree-view> that the renderer applies itself. */
export interface ListElementProps {
  data?: ReadonlyArray<ListRow>;
  /** Read when the list mounts. To change the fields or kinds, give the list a new key. */
  columns?: ReadonlyArray<ListColumn>;
  /** The key of the selected row, or null. Give it to control the selection. */
  selected?: string | null;
  onSelect?: (key: string | null, target: WidgetTarget) => void;
  /** The user tapped a toggle. value is the new value; the row keeps its old value until data changes. */
  onToggle?: (key: string, field: string, value: boolean, target: WidgetTarget) => void;
}

/** The props of <gtk-hscale> and <gtk-vscale> that the renderer applies itself. */
export interface RangeElementProps {
  /** Default 0. */
  min?: number;
  /** Default 100. */
  max?: number;
  /** Default 1. The page increment is ten steps. */
  step?: number;
  value?: number;
  /** The user released the slider, or changed the value with a key. */
  onChangeValue?: (value: number, target: WidgetTarget) => void;
}

/** The props of <gtk-combo-box> that the renderer applies itself. */
export interface ComboElementProps {
  /** The text rows. A change of the rows keeps the active prop. */
  items?: ReadonlyArray<string>;
}

/** The props of <hildon-window> that the renderer applies itself. */
export interface WindowElementProps {
  /** The window came on top (true) or went behind another (false). Not called at mount. */
  onTopmostChange?: (topmost: boolean, target: WidgetTarget) => void;
}
`;

// Properties that the renderer manages, or that make no sense in JSX.
const SKIP_PROPS = new Set(['parent', 'child', 'user-data']);

// Per element: the renderer owns these properties (the extension makes the model).
const SKIP_ELEMENT_PROPS = {
  'gtk-tree-view': new Set(['model']),
  'gtk-combo-box': new Set(['model']),
};

const CHILDREN = {
  node: 'children?: ReactNode',
  text: 'children?: string | number | Array<string | number>',
  none: 'children?: never',
};

export const camel = (s) => s.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());
export const pascal = (s) => {
  const c = camel(s);
  return c[0].toUpperCase() + c.slice(1);
};

export function tsType(v) {
  switch (v.kind) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'string | null';
    case 'enum':
      return v.values.map((x) => JSON.stringify(x)).join(' | ');
    case 'flags':
      return 'Array<' + v.values.map((x) => JSON.stringify(x)).join(' | ') + '>';
    case 'object':
      return 'Handle | null';
    case 'color':
      return 'string';
    default:
      return v.type === 'void' ? 'void' : 'unknown';
  }
}

/** The prop names that one hand-written interface of EXTENSION_TYPES declares. */
function extensionKeys(name) {
  const m = EXTENSION_TYPES.match(new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  return m ? [...m[1].matchAll(/^ {2}(\w+)\??:/gm)].map((x) => x[1]) : [];
}

export function emit(data, elements = ELEMENTS, extra = EXTRA_PROPS) {
  const names = new Set(data.classes.map((c) => c.name));
  const out = [
    `// Generated by typegen/emit.mjs from GTK ${data.gtk} (typegen on the target). Do not edit.`,
    `import type { ReactNode } from 'react';`,
    '',
    '/** A GObject handle from maemo:gobject. */',
    'export type Handle = number;',
    '',
    '/** The last argument of every event handler, and the value of a ref. */',
    'export interface WidgetTarget {',
    '  readonly handle: Handle;',
    '  get(prop: string): unknown;',
    '}',
    '',
    "/** Props of every element: React's own, and the child properties in a box. */",
    'export interface CommonProps {',
    '  key?: string | number | null;',
    '  ref?: ((target: WidgetTarget | null) => void) | { current: WidgetTarget | null } | null;',
    '  /** In a box: take extra space. Default false. */',
    '  expand?: boolean;',
    '  /** In a box: fill the space given. Default true. */',
    '  fill?: boolean;',
    '  /** In a box: pixels around the child. Default 0. */',
    '  padding?: number;',
    "  /** In a box: pack from the start or the end. Default 'start'. */",
    "  packType?: 'start' | 'end';",
    '}',
    '',
    EXTENSION_TYPES.trimEnd(),
    '',
  ];
  const keysOf = new Map(); // class -> the prop names of the class and its parents
  for (const c of data.classes) {
    const own = new Set(c.parent && keysOf.has(c.parent) ? keysOf.get(c.parent) : []);
    keysOf.set(c.name, own);
    const parent = c.parent && names.has(c.parent) ? `${c.parent}Props` : 'CommonProps';
    out.push(`export interface ${c.name}Props extends ${parent} {`);
    for (const p of c.properties) {
      if (!p.writable || p.constructOnly || p.value.kind === 'other' || SKIP_PROPS.has(p.name)) continue;
      own.add(camel(p.name));
      out.push(`  ${camel(p.name)}?: ${tsType(p.value)};`);
    }
    for (const s of c.signals) {
      const params = s.params.map((v, i) => `arg${i}: ${tsType(v)}`).concat('target: WidgetTarget').join(', ');
      const ret = tsType(s.returns);
      own.add(`on${pascal(s.name)}`);
      out.push(`  on${pascal(s.name)}?: (${params}) => ${ret === 'void' ? 'void' : ret + ' | void'};`);
    }
    out.push('}', '');
  }
  out.push('/** The JSX intrinsic elements of maemo-react. */', 'export interface MaemoIntrinsicElements {');
  for (const [el, [cls, model]] of Object.entries(elements)) {
    if (!names.has(cls)) throw new Error(`the typegen data has no class ${cls}`);
    // An extension prop replaces a class prop of the same name (onChangeValue of a range).
    const clashing = extra[el] ? extensionKeys(extra[el]).filter((k) => keysOf.get(cls).has(k)) : [];
    // A prop that the renderer owns is also left out of the element.
    const owned = [...(SKIP_ELEMENT_PROPS[el] ?? [])].map(camel).filter((k) => keysOf.get(cls).has(k));
    const clash = [...new Set([...clashing, ...owned])];
    const base = clash.length ? `Omit<${cls}Props, ${clash.map((k) => `'${k}'`).join(' | ')}>` : `${cls}Props`;
    const mix = extra[el] ? ` & ${extra[el]}` : '';
    out.push(`  '${el}': ${base}${mix} & { ${CHILDREN[model]} };`);
  }
  out.push('}', '');
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../packages/types/generated/', import.meta.url);
  const data = JSON.parse(readFileSync(new URL('gtk.json', dir), 'utf8'));
  writeFileSync(new URL('intrinsics.d.ts', dir), emit(data));
  console.log(`wrote packages/types/generated/intrinsics.d.ts from GTK ${data.gtk}`);
}
