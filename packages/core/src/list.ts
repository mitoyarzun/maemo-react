// <gtk-tree-view data columns>: a GtkTreeView over a GtkListStore (spec
// section 5). The rows are plain objects with a unique key. An update changes
// only the store rows that changed, so a change of one row in 200 costs one
// listStore.set for each changed cell.
import type { Bridge, Handle } from './bridge.js';
import type { ElementExt, ExtContext, ExtInstance } from './elements.js';

/** A row of the list. The key must be unique in the list. */
export interface ListRow {
  key: string;
  [field: string]: unknown;
}

/** A column of the list. */
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

interface StoreColumn {
  field: string;
  kind: 'text' | 'toggle';
  /** The first store column of this column. A toggle takes two: active and visible. */
  at: number;
}

interface ListState {
  store: Handle;
  columns: StoreColumn[];
  /** The GtkTreeViewColumn handles, in column order. */
  columnHandles: Handle[];
  /** The keys of the rows, in store order. */
  keys: string[];
  /** The row objects, by key. */
  rows: Map<string, ListRow>;
  /** The titles that GTK has now, in column order. */
  titles: string[];
  /** The key that the application last saw or asked for. */
  selectedKey: string | null;
}

type Props = Record<string, unknown>;

/** The store cells of one column of a row. */
function cellValues(col: StoreColumn, row: ListRow): unknown[] {
  const v = row[col.field];
  if (col.kind === 'toggle') return [v === true, v !== null && v !== undefined];
  return [v === null || v === undefined ? '' : String(v)];
}

function rowValues(columns: StoreColumn[], row: ListRow): unknown[] {
  const out: unknown[] = [];
  for (const c of columns) out.push(...cellValues(c, row));
  return out;
}

function storeColumns(columns: readonly ListColumn[]): { columns: StoreColumn[]; kinds: string[] } {
  const out: StoreColumn[] = [];
  const kinds: string[] = [];
  for (const c of columns) {
    const kind = c.kind ?? 'text';
    out.push({ field: c.field, kind, at: kinds.length });
    if (kind === 'toggle') kinds.push('boolean', 'boolean');
    else kinds.push('string');
  }
  return { columns: out, kinds };
}

/** Call onSelect when the selection of the view differs from the last known key. */
function reportSelection(ctx: ExtContext, inst: ExtInstance, st: ListState) {
  const index = ctx.bridge.call(inst.handle, 'treeView.selectedIndex') as number;
  const key = index >= 0 ? (st.keys[index] ?? null) : null;
  if (key === st.selectedKey) return;
  st.selectedKey = key;
  const fn = inst.props.onSelect;
  if (typeof fn === 'function') ctx.run(() => fn(key, inst.target));
}

function create(ctx: ExtContext, inst: ExtInstance, columns: readonly ListColumn[]): ListState {
  const b = ctx.bridge;
  const h = inst.handle;
  if (columns.length === 0) throw new Error('<List> needs at least one column');
  const { columns: cols, kinds } = storeColumns(columns);
  const store = b.create('GtkListStore');
  inst.extra.push(store);
  b.call(store, 'listStore.setColumnTypes', kinds);
  b.set(h, 'model', store);
  const st: ListState = { store, columns: cols, columnHandles: [], titles: columns.map((c) => c.title ?? ''), keys: [], rows: new Map(), selectedKey: null };
  columns.forEach((c, i) => {
    const col = b.create('GtkTreeViewColumn');
    inst.extra.push(col);
    st.columnHandles.push(col);
    if (c.title !== undefined) b.set(col, 'title', c.title);
    if (c.expand) b.set(col, 'expand', true);
    const sc = cols[i];
    const renderer = b.create(sc.kind === 'toggle' ? 'GtkCellRendererToggle' : 'GtkCellRendererText');
    inst.extra.push(renderer);
    b.call(col, 'column.pack', renderer);
    if (sc.kind === 'toggle') {
      b.set(renderer, 'activatable', true);
      b.call(col, 'column.addAttribute', renderer, 'active', sc.at);
      b.call(col, 'column.addAttribute', renderer, 'visible', sc.at + 1);
      b.connect(renderer, 'toggled', (path) => {
        const key = st.keys[Number(path)];
        const fn = inst.props.onToggle;
        if (key === undefined || inst.muted || typeof fn !== 'function') return;
        const row = st.rows.get(key)!;
        ctx.run(() => fn(key, sc.field, row[sc.field] !== true, inst.target));
      });
    } else {
      b.call(col, 'column.addAttribute', renderer, 'text', sc.at);
    }
    b.call(h, 'treeView.appendColumn', col);
  });
  const selection = b.call(h, 'treeView.selection') as Handle;
  inst.extra.push(selection);
  b.connect(selection, 'changed', () => {
    if (!inst.muted) reportSelection(ctx, inst, st);
  });
  return st;
}

function checkColumns(b: Bridge, st: ListState, columns: readonly ListColumn[]) {
  const same =
    columns.length === st.columns.length &&
    columns.every((c, i) => c.field === st.columns[i].field && (c.kind ?? 'text') === st.columns[i].kind);
  if (!same) throw new Error('<List>: the fields and kinds of the columns cannot change; give the List a new key');
  columns.forEach((c, i) => {
    const title = c.title ?? '';
    if (title === st.titles[i]) return;
    st.titles[i] = title;
    b.set(st.columnHandles[i], 'title', title);
  });
}

function applyData(b: Bridge, st: ListState, data: readonly ListRow[]) {
  const nextKeys = new Set<string>();
  for (const row of data) {
    if (typeof row.key !== 'string') throw new Error('<List>: each row needs a string key');
    if (nextKeys.has(row.key)) throw new Error(`<List>: the key '${row.key}' is in the data twice`);
    nextKeys.add(row.key);
  }
  // Remove the rows that are gone, from the end, so the indexes stay valid.
  for (let i = st.keys.length - 1; i >= 0; i--) {
    if (nextKeys.has(st.keys[i])) continue;
    b.call(st.store, 'listStore.remove', i);
    st.rows.delete(st.keys[i]);
    st.keys.splice(i, 1);
  }
  // Walk the new data. The rows before i are final, so a known key is at i or after it.
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const old = st.rows.get(row.key);
    if (!old) {
      b.call(st.store, 'listStore.insert', i, rowValues(st.columns, row));
      st.keys.splice(i, 0, row.key);
    } else {
      const from = st.keys.indexOf(row.key, i);
      if (from !== i) {
        b.call(st.store, 'listStore.move', from, i);
        st.keys.splice(from, 1);
        st.keys.splice(i, 0, row.key);
      }
      if (old !== row) {
        for (const c of st.columns) {
          if (old[c.field] === row[c.field]) continue;
          const values = cellValues(c, row);
          for (let k = 0; k < values.length; k++) b.call(st.store, 'listStore.set', i, c.at + k, values[k]);
        }
      }
    }
    st.rows.set(row.key, row);
  }
}

function applySelected(b: Bridge, inst: ExtInstance, st: ListState, selected: string | null) {
  const index = selected === null ? -1 : st.keys.indexOf(selected);
  st.selectedKey = selected; // what the application asked for; a missing key reports null later
  const current = b.call(inst.handle, 'treeView.selectedIndex') as number;
  if (current !== index) b.call(inst.handle, 'treeView.selectIndex', index);
}

export const LIST_EXT: ElementExt = {
  props: new Set(['data', 'columns', 'selected', 'onSelect', 'onToggle']),
  update(ctx: ExtContext, inst: ExtInstance, prev: Props | null, next: Props) {
    const b = ctx.bridge;
    const columns = (next.columns ?? []) as readonly ListColumn[];
    const data = (next.data ?? []) as readonly ListRow[];
    let st = inst.ext as ListState | undefined;
    if (!st) st = inst.ext = create(ctx, inst, columns);
    else if (prev && prev.columns !== next.columns) checkColumns(b, st, columns);
    // A removed row can change the selection. Do not report it inside the
    // commit: React must not get a state change here. Report it after.
    const was = inst.muted;
    inst.muted = true;
    try {
      if (!prev || prev.data !== next.data) applyData(b, st, data);
      if (next.selected !== undefined) applySelected(b, inst, st, next.selected as string | null);
    } finally {
      inst.muted = was;
    }
    const state = st;
    queueMicrotask(() => {
      if (!inst.muted) reportSelection(ctx, inst, state);
    });
  },
};
