import type { Bridge, Handle } from '../src/bridge.js';

interface FakeObject {
  type: string;
  props: Record<string, unknown>;
  handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
  parent: Handle | null;
  children: Handle[];
  destroyed: boolean;
  /** For a window: the menu from window.setMenu. */
  menu: Handle | null;
  /** For a list store: the rows, each an array of cell values. */
  rows: unknown[][];
  /** For a list store: the column kinds. */
  columns: string[];
  /** For a tree view: the selected row, -1 for none. */
  selected: number;
  /** For a tree view: the GtkTreeSelection, made on the first treeView.selection. */
  selection: Handle | null;
  /** For a range: the value, clamped to the range. */
  value: number;
  min: number;
  max: number;
  /** For a combo box: the text rows. */
  items: string[];
}

/** A bridge that keeps a widget tree in memory and records each operation. */
export function fakeBridge() {
  let next = 1;
  const ops: unknown[][] = [];
  const objects = new Map<Handle, FakeObject>();
  const obj = (h: Handle) => {
    const o = objects.get(h);
    if (!o || o.destroyed) throw new Error('fake bridge: invalid handle ' + h);
    return o;
  };

  /** Emit a signal as GTK would. Returns the last handler's result. */
  function emit(h: Handle, signal: string, ...args: unknown[]) {
    let r: unknown;
    for (const fn of obj(h).handlers.get(signal) ?? []) r = fn(...args);
    return r;
  }

  /** The tree views that show the store h. */
  const viewsOf = (h: Handle) => [...objects.values()].filter((o) => !o.destroyed && o.props.model === h);

  const bridge: Bridge = {
    create(type) {
      const h = next++;
      objects.set(h, { type, props: {}, handlers: new Map(), parent: null, children: [], destroyed: false, menu: null, rows: [], columns: [], selected: -1, selection: null, value: 0, min: 0, max: 0, items: [] });
      ops.push(['create', type, h]);
      return h;
    },
    set(h, prop, value) {
      const o = obj(h);
      const old = o.props[prop];
      o.props[prop] = value;
      ops.push(['set', h, prop, value]);
      // GTK emits toggled or changed at once when active changes.
      if (prop === 'active' && old !== value) {
        if (o.type === 'GtkToggleButton' || o.type === 'GtkCheckButton') emit(h, 'toggled');
        else if (o.type === 'GtkComboBox') emit(h, 'changed');
      }
    },
    get(h, prop) {
      return obj(h).props[prop];
    },
    reset(h, prop) {
      delete obj(h).props[prop];
      ops.push(['reset', h, prop]);
    },
    connect(h, signal, fn) {
      const o = obj(h);
      if (!o.handlers.has(signal)) o.handlers.set(signal, []);
      o.handlers.get(signal)!.push(fn);
      ops.push(['connect', h, signal]);
      return o.handlers.get(signal)!.length;
    },
    childSet(parent, child, prop, value) {
      ops.push(['childSet', parent, child, prop, value]);
    },
    call(h, helper, ...args) {
      ops.push(['call', h, helper, ...args]);
      const o = obj(h);
      switch (helper) {
        case 'container.add':
        case 'scrolled.add': {
          const c = args[0] as Handle;
          o.children.push(c);
          obj(c).parent = h;
          return undefined;
        }
        case 'container.indexOf':
          return o.children.indexOf(args[0] as Handle);
        case 'box.reorder':
        case 'menu.reorder': {
          const c = args[0] as Handle;
          let pos = args[1] as number;
          o.children.splice(o.children.indexOf(c), 1);
          if (pos < 0 || pos > o.children.length) pos = o.children.length;
          o.children.splice(pos, 0, c);
          return undefined;
        }
        case 'widget.removeFromParent':
          if (o.parent !== null) {
            const list = obj(o.parent).children;
            list.splice(list.indexOf(h), 1);
            o.parent = null;
          }
          return undefined;
        case 'window.setMenu':
          o.menu = (args[0] as Handle | null) ?? null;
          return undefined;
        case 'window.banner':
          return undefined;
        case 'listStore.setColumnTypes':
          o.columns = (args[0] as string[]).slice();
          return undefined;
        case 'listStore.insert': {
          let i = args[0] as number;
          const row = (args[1] as unknown[]).slice();
          if (row.length !== o.columns.length) {
            throw new Error(`fake bridge: the row has ${row.length} values, the store has ${o.columns.length} columns`);
          }
          if (i < 0 || i > o.rows.length) i = o.rows.length;
          o.rows.splice(i, 0, row);
          // GTK keeps the selection on the same row. It emits no changed.
          for (const v of viewsOf(h)) if (v.selected >= i) v.selected++;
          return undefined;
        }
        case 'listStore.set': {
          const row = o.rows[args[0] as number];
          if (!row) throw new Error(`fake bridge: no row ${args[0]}`);
          row[args[1] as number] = args[2];
          return undefined;
        }
        case 'listStore.get':
          return o.rows[args[0] as number][args[1] as number];
        case 'listStore.remove': {
          const i = args[0] as number;
          if (!o.rows[i]) throw new Error(`fake bridge: no row ${i}`);
          o.rows.splice(i, 1);
          // GTK unselects a selected row that goes away, and the selection emits changed.
          for (const v of viewsOf(h)) {
            if (v.selected === i) {
              v.selected = -1;
              if (v.selection !== null) emit(v.selection, 'changed');
            } else if (v.selected > i) {
              v.selected--;
            }
          }
          return undefined;
        }
        case 'listStore.move': {
          const [from, to] = args as number[];
          const [row] = o.rows.splice(from, 1);
          o.rows.splice(to, 0, row);
          // The selection follows its row. It emits no changed.
          for (const v of viewsOf(h)) {
            if (v.selected === from) v.selected = to;
            else if (from < to && v.selected > from && v.selected <= to) v.selected--;
            else if (from > to && v.selected >= to && v.selected < from) v.selected++;
          }
          return undefined;
        }
        case 'listStore.clear':
          o.rows = [];
          return undefined;
        case 'listStore.length':
          return o.rows.length;
        case 'treeView.appendColumn':
          o.children.push(args[0] as Handle);
          return o.children.length;
        case 'treeView.selection':
          if (o.selection === null) o.selection = bridge.create('GtkTreeSelection');
          return o.selection;
        case 'treeView.selectedIndex':
          return o.selected;
        case 'treeView.selectIndex': {
          const i = args[0] as number;
          const store = o.props.model as Handle | undefined;
          const n = store === undefined ? 0 : obj(store).rows.length;
          if (i >= n) throw new Error(`fake bridge: no row ${i}`);
          const next = i < 0 ? -1 : i;
          if (next !== o.selected) {
            o.selected = next;
            if (o.selection !== null) emit(o.selection, 'changed');
          }
          return undefined;
        }
        case 'treeView.renderer':
        case 'column.pack':
        case 'column.addAttribute':
          return undefined;
        case 'range.setRange':
          o.min = args[0] as number;
          o.max = args[1] as number;
          if (o.value > o.max || o.value < o.min) {
            o.value = Math.min(o.max, Math.max(o.min, o.value));
            emit(h, 'value-changed');
          }
          return undefined;
        case 'range.setIncrements':
          return undefined;
        case 'range.setValue': {
          const v = Math.min(o.max, Math.max(o.min, args[0] as number));
          if (v !== o.value) {
            o.value = v;
            emit(h, 'value-changed');
          }
          return undefined;
        }
        case 'range.getValue':
          return o.value;
        case 'comboBox.setItems':
          o.items = (args[0] as string[]).slice();
          // GTK: the rows go away, so an active row becomes -1 and changed is emitted.
          if (o.props.active !== undefined && o.props.active !== -1) {
            o.props.active = -1;
            emit(h, 'changed');
          }
          return undefined;
        case 'comboBox.activeText': {
          const i = o.props.active as number | undefined;
          return i === undefined || i < 0 ? null : (o.items[i] ?? null);
        }
        default:
          return undefined;
      }
    },
    destroy(h) {
      const o = objects.get(h);
      if (!o || o.destroyed) return;
      ops.push(['destroy', h]);
      for (const fn of o.handlers.get('destroy') ?? []) fn();
      o.destroyed = true;
    },
  };

  return {
    bridge,
    ops,
    objects,
    emit,
    /** Change a property as GTK would (for example the user types), with no op. */
    poke(h: Handle, prop: string, value: unknown) {
      obj(h).props[prop] = value;
    },
    props: (h: Handle) => obj(h).props,
    childrenOf: (h: Handle) => obj(h).children,
    typeOf: (h: Handle) => obj(h).type,
    ofType: (type: string) => [...objects].filter(([, o]) => o.type === type && !o.destroyed).map(([h]) => h),
    isDestroyed: (h: Handle) => objects.get(h)!.destroyed,
    menuOf: (h: Handle) => obj(h).menu,
    rowsOf: (h: Handle) => obj(h).rows,
    selectedOf: (h: Handle) => obj(h).selected,
    /** Select a row as a tap does: the selection emits changed. */
    tap(view: Handle, index: number) {
      const o = obj(view);
      if (o.selected === index) return;
      o.selected = index;
      if (o.selection !== null) emit(o.selection, 'changed');
    },
    valueOf: (h: Handle) => obj(h).value,
    itemsOf: (h: Handle) => obj(h).items,
    /** Move the slider as the user does; GTK then emits value-changed on the release. */
    drag(h: Handle, value: number) {
      bridge.call(h, 'range.setValue', value);
    },
  };
}
