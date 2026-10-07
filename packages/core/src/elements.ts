import type { Bridge, Handle, Platform, WidgetTarget } from './bridge.js';
import { COMBO_EXT, RANGE_EXT, WINDOW_EXT } from './extensions.js';
import { LIST_EXT } from './list.js';

/** How an element takes children. */
export type ChildModel = 'none' | 'text' | 'single' | 'box' | 'scrolled' | 'menu';

type Props = Record<string, unknown>;

/** The parts of an instance that an element extension may use. */
export interface ExtInstance {
  handle: Handle;
  props: Props;
  target: WidgetTarget;
  /** Handles that the extension made. The renderer destroys them with the widget. */
  extra: Handle[];
  /** While true, the event props do not run: a helper changes the widget, or it is destroyed. */
  muted: boolean;
  /** The state of the extension. */
  ext?: unknown;
}

export interface ExtContext {
  bridge: Bridge;
  /** 'hildon' on the tablet, 'desktop' in the desktop dev host. */
  platform: Platform;
  /** Run an event handler at discrete priority, and render its updates before it returns. */
  run<T>(fn: () => T): T;
}

/** Props that are not GObject properties: the extension applies them with helpers. */
export interface ElementExt {
  props: ReadonlySet<string>;
  /** Runs once after create (prev is null), and before the GObject properties of each update. */
  update(ctx: ExtContext, inst: ExtInstance, prev: Props | null, next: Props): void;
}

export interface ElementDef {
  /** The GType to create, or a function of the platform. */
  gtype: string | ((platform: Platform) => string);
  children: ChildModel;
  /** For the 'text' model: the property that gets the text. */
  textProp?: string;
  /** A top-level window. */
  toplevel?: boolean;
  /** The menu of a window: attached with window.setMenu, not added as a child. */
  windowMenu?: boolean;
  /** Runs once, after create. */
  init?: (b: Bridge, h: Handle) => void;
  ext?: ElementExt;
}

/** The intrinsic elements of maemo-react, by JSX name. Keep it equal to typegen/emit.mjs. */
export const ELEMENTS: Record<string, ElementDef> = {
  'hildon-window': {
    gtype: (p) => (p === 'hildon' ? 'HildonWindow' : 'GtkWindow'),
    children: 'single',
    toplevel: true,
    ext: WINDOW_EXT,
  },
  'gtk-vbox': { gtype: 'GtkVBox', children: 'box' },
  'gtk-hbox': { gtype: 'GtkHBox', children: 'box' },
  'gtk-label': { gtype: 'GtkLabel', children: 'text', textProp: 'label' },
  'gtk-button': { gtype: 'GtkButton', children: 'text', textProp: 'label' },
  'gtk-toggle-button': { gtype: 'GtkToggleButton', children: 'text', textProp: 'label' },
  'gtk-check-button': { gtype: 'GtkCheckButton', children: 'text', textProp: 'label' },
  'gtk-entry': { gtype: 'GtkEntry', children: 'none' },
  'gtk-hscale': { gtype: 'GtkHScale', children: 'none', ext: RANGE_EXT },
  'gtk-vscale': { gtype: 'GtkVScale', children: 'none', ext: RANGE_EXT },
  'gtk-combo-box': { gtype: 'GtkComboBox', children: 'none', ext: COMBO_EXT },
  'gtk-tree-view': { gtype: 'GtkTreeView', children: 'none', ext: LIST_EXT },
  'gtk-scrolled-window': {
    gtype: 'GtkScrolledWindow',
    children: 'scrolled',
    init: (b, h) => {
      b.set(h, 'hscrollbar-policy', 'automatic');
      b.set(h, 'vscrollbar-policy', 'automatic');
    },
  },
  'gtk-menu': { gtype: 'GtkMenu', children: 'menu', windowMenu: true },
  'gtk-menu-item': { gtype: 'GtkMenuItem', children: 'single' },
  'gtk-separator-menu-item': { gtype: 'GtkSeparatorMenuItem', children: 'none' },
};

/** "hscrollbarPolicy" -> "hscrollbar-policy"; "DeleteEvent" -> "delete-event". */
export function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (m: string, i: number) => (i ? '-' : '') + m.toLowerCase());
}

/** Properties that GTK also changes (the user types). Set them only when the value differs. */
export const SYNC_PROPS = new Set(['text', 'value', 'active']);

/** Props that become child properties when the parent is a box, with their first values. */
export const CHILD_PROPS: Record<string, { name: string; initial: unknown }> = {
  expand: { name: 'expand', initial: false },
  fill: { name: 'fill', initial: true },
  padding: { name: 'padding', initial: 0 },
  packType: { name: 'pack-type', initial: 'start' },
};

/** Props that the renderer uses itself; they are not GObject properties. */
export const RESERVED = new Set(['children', 'key', 'ref']);
