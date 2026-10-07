import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import type { ListColumn, ListRow } from '../src/list.js';
import { createRenderer } from '../src/renderer.js';
import { fakeBridge } from './fakeBridge.js';

function setup() {
  const fake = fakeBridge();
  const errors: string[] = [];
  const renderer = createRenderer(fake.bridge, 'hildon', {
    onError: (e) => {
      errors.push(String(e instanceof Error ? e.message : e));
    },
  });
  return { ...fake, renderer, errors };
}

const COLUMNS: ListColumn[] = [
  { field: 'name', title: 'Name', expand: true },
  { field: 'state' },
  { field: 'on', kind: 'toggle' },
];

interface Row extends ListRow {
  name: string;
  state: string | number;
  on?: boolean | null;
}

const rows = (n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({ key: 'e' + (from + i), name: 'Entity ' + (from + i), state: 'off', on: false }));

function view(data: Row[], extra: Record<string, unknown> = {}, columns: ListColumn[] = COLUMNS) {
  return (
    <hildon-window>
      <gtk-tree-view data={data} columns={columns} {...extra} />
    </hildon-window>
  );
}

const storeOps = (t: ReturnType<typeof setup>, from: number) =>
  t.ops.slice(from).filter((o) => o[0] === 'call' && String(o[2]).startsWith('listStore.'));

describe('List: mount', () => {
  test('makes a store with the column types, the columns and their renderers', () => {
    const t = setup();
    t.renderer.render(view(rows(2)));
    const [store] = t.ofType('GtkListStore');
    const [tv] = t.ofType('GtkTreeView');
    expect(t.props(tv).model).toBe(store);
    expect(t.ops).toContainEqual(['call', store, 'listStore.setColumnTypes', ['string', 'string', 'boolean', 'boolean']]);
    const cols = t.ofType('GtkTreeViewColumn');
    expect(cols).toHaveLength(3);
    expect(t.childrenOf(tv)).toEqual(cols);
    expect(t.props(cols[0])).toMatchObject({ title: 'Name', expand: true });
    expect(t.ofType('GtkCellRendererText')).toHaveLength(2);
    const [toggle] = t.ofType('GtkCellRendererToggle');
    expect(t.props(toggle).activatable).toBe(true);
    expect(t.ops).toContainEqual(['call', cols[2], 'column.addAttribute', toggle, 'active', 2]);
    expect(t.ops).toContainEqual(['call', cols[2], 'column.addAttribute', toggle, 'visible', 3]);
    expect(t.rowsOf(store)).toEqual([
      ['Entity 0', 'off', false, true],
      ['Entity 1', 'off', false, true],
    ]);
    expect(t.errors).toEqual([]);
  });

  test('a toggle of null hides the check box; a number shows as text; null text is empty', () => {
    const t = setup();
    t.renderer.render(view([{ key: 'a', name: 'Thermostat', state: 21.5, on: null }, { key: 'b', name: null as unknown as string, state: '' }]));
    const [store] = t.ofType('GtkListStore');
    expect(t.rowsOf(store)).toEqual([
      ['Thermostat', '21.5', false, false],
      ['', '', false, false],
    ]);
  });

  test('errors: no columns, a duplicate key', () => {
    const t = setup();
    t.renderer.render(view([], {}, []));
    expect(t.errors.join()).toMatch(/<List> needs at least one column/);
    const u = setup();
    u.renderer.render(view([...rows(1), ...rows(1)]));
    expect(u.errors.join()).toMatch(/the key 'e0' is in the data twice/);
  });

  test('an error in the create leaves no live handle', () => {
    const t = setup();
    t.renderer.render(view([], {}, []));
    expect(t.errors.join()).toMatch(/<List> needs at least one column/);
    const live = [...t.objects.values()].filter((o) => !o.destroyed && o.type !== 'HildonWindow' && o.type !== 'GtkScrolledWindow');
    expect(live).toEqual([]);
  });
});

describe('List: updates', () => {
  test('one changed row in 200 makes one listStore.set for each changed cell', () => {
    const t = setup();
    const data = rows(200);
    const root = t.renderer.render(view(data));
    const [store] = t.ofType('GtkListStore');
    const from = t.ops.length;
    const next = data.slice();
    next[57] = { ...next[57], state: 'on', on: true };
    root.render(view(next));
    expect(storeOps(t, from)).toEqual([
      ['call', store, 'listStore.set', 57, 1, 'on'],
      ['call', store, 'listStore.set', 57, 2, true],
      ['call', store, 'listStore.set', 57, 3, true],
    ]);
    expect(t.rowsOf(store)[57]).toEqual(['Entity 57', 'on', true, true]);
  });

  test('the same data array makes no store call', () => {
    const t = setup();
    const data = rows(5);
    const root = t.renderer.render(view(data));
    const from = t.ops.length;
    root.render(view(data));
    expect(storeOps(t, from)).toEqual([]);
  });

  test('insert, remove and move by key', () => {
    const t = setup();
    const a = rows(4);
    const root = t.renderer.render(view(a));
    const [store] = t.ofType('GtkListStore');
    const names = () => t.rowsOf(store).map((r) => r[0]);
    let from = t.ops.length;
    root.render(view([a[3], a[0], a[2]])); // e1 removed, e3 moved to the front
    expect(storeOps(t, from)).toEqual([
      ['call', store, 'listStore.remove', 1],
      ['call', store, 'listStore.move', 2, 0],
    ]);
    expect(names()).toEqual(['Entity 3', 'Entity 0', 'Entity 2']);
    from = t.ops.length;
    const n = rows(1, 9)[0];
    root.render(view([a[3], n, a[0], a[2]]));
    expect(storeOps(t, from)).toEqual([['call', store, 'listStore.insert', 1, ['Entity 9', 'off', false, true]]]);
    expect(names()).toEqual(['Entity 3', 'Entity 9', 'Entity 0', 'Entity 2']);
    root.render(view([]));
    expect(names()).toEqual([]);
  });

  test('a tap on a toggle calls onToggle with the key, the field and the new value', () => {
    const t = setup();
    const got: unknown[] = [];
    t.renderer.render(view(rows(3), { onToggle: (key: string, field: string, value: boolean) => got.push([key, field, value]) }));
    const [toggle] = t.ofType('GtkCellRendererToggle');
    t.emit(toggle, 'toggled', '2');
    expect(got).toEqual([['e2', 'on', true]]);
    t.emit(toggle, 'toggled', '7'); // no such row
    expect(got).toHaveLength(1);
  });

  test('a toggle handler that removes the row: no error, the store shrinks', () => {
    const t = setup();
    function App() {
      const [data, setData] = useState(rows(3));
      return (
        <hildon-window>
          <gtk-tree-view data={data} columns={COLUMNS} onToggle={(key: string) => setData(data.filter((r) => r.key !== key))} />
        </hildon-window>
      );
    }
    t.renderer.render(<App />);
    const [store] = t.ofType('GtkListStore');
    const [toggle] = t.ofType('GtkCellRendererToggle');
    t.emit(toggle, 'toggled', '1');
    expect(t.errors).toEqual([]);
    expect(t.rowsOf(store).map((r) => r[0])).toEqual(['Entity 0', 'Entity 2']);
  });

  test('new titles are applied; a changed field or kind is an error', () => {
    const t = setup();
    const root = t.renderer.render(view(rows(1)));
    const cols = t.ofType('GtkTreeViewColumn');
    root.render(view(rows(1), {}, [{ field: 'name', title: 'Entity' }, { field: 'state', title: 'State' }, { field: 'on', kind: 'toggle' }]));
    expect(t.props(cols[0]).title).toBe('Entity');
    expect(t.props(cols[1]).title).toBe('State');
    root.render(view(rows(1), {}, [{ field: 'name' }, { field: 'on', kind: 'toggle' }]));
    expect(t.errors.join()).toMatch(/fields and kinds of the columns cannot change/);
  });

  test('an equal new columns array makes no title set', () => {
    const t = setup();
    const root = t.renderer.render(view(rows(1)));
    const from = t.ops.length;
    root.render(view(rows(1), {}, COLUMNS.map((c) => ({ ...c }))));
    expect(t.ops.slice(from).filter((o) => o[0] === 'set' && o[2] === 'title')).toEqual([]);
  });
});

describe('List: selection', () => {
  test('a tap on a row calls onSelect with the key; the same row again does not', () => {
    const t = setup();
    const got: unknown[] = [];
    t.renderer.render(view(rows(3), { onSelect: (k: string | null) => got.push(k) }));
    const [tv] = t.ofType('GtkTreeView');
    t.tap(tv, 1);
    t.tap(tv, 1);
    t.tap(tv, -1);
    expect(got).toEqual(['e1', null]);
  });

  test('selected is controlled: the view follows the prop, and the prop does not echo', async () => {
    const t = setup();
    const got: unknown[] = [];
    const onSelect = (k: string | null) => got.push(k);
    const root = t.renderer.render(view(rows(3), { selected: 'e2', onSelect }));
    const [tv] = t.ofType('GtkTreeView');
    expect(t.selectedOf(tv)).toBe(2);
    root.render(view(rows(3), { selected: 'e0', onSelect }));
    expect(t.selectedOf(tv)).toBe(0);
    root.render(view(rows(3), { selected: null, onSelect }));
    expect(t.selectedOf(tv)).toBe(-1);
    await Promise.resolve();
    expect(got).toEqual([]);
  });

  test('an insert above and a move keep the selection on its row, with no report', async () => {
    const t = setup();
    const got: unknown[] = [];
    const onSelect = (k: string | null) => got.push(k);
    const a = rows(3);
    const root = t.renderer.render(view(a, { onSelect }));
    const [tv] = t.ofType('GtkTreeView');
    t.tap(tv, 1);
    expect(got).toEqual(['e1']);
    const z = rows(1, 9)[0];
    root.render(view([z, ...a], { onSelect }));
    expect(t.selectedOf(tv)).toBe(2);
    root.render(view([z, a[1], a[0], a[2]], { onSelect }));
    expect(t.selectedOf(tv)).toBe(1);
    root.render(view([a[1], z, a[0], a[2]], { onSelect }));
    expect(t.selectedOf(tv)).toBe(0);
    await Promise.resolve();
    expect(got).toEqual(['e1']);
  });

  test('the selected row goes away: onSelect(null) once, after the commit', async () => {
    const t = setup();
    const got: unknown[] = [];
    const onSelect = (k: string | null) => got.push(k);
    const data = rows(3);
    const root = t.renderer.render(view(data, { onSelect }));
    const [tv] = t.ofType('GtkTreeView');
    t.tap(tv, 1);
    expect(got).toEqual(['e1']);
    root.render(view([data[0], data[2]], { onSelect }));
    expect(got).toEqual(['e1']); // the report waits for the end of the commit
    await Promise.resolve();
    expect(got).toEqual(['e1', null]);
    await Promise.resolve();
    expect(got).toEqual(['e1', null]);
    expect(t.errors).toEqual([]);
  });

  test('a selected key that is not in the data reports null', async () => {
    const t = setup();
    const got: unknown[] = [];
    t.renderer.render(view(rows(2), { selected: 'zz', onSelect: (k: string | null) => got.push(k) }));
    const [tv] = t.ofType('GtkTreeView');
    expect(t.selectedOf(tv)).toBe(-1);
    await Promise.resolve();
    expect(got).toEqual([null]);
  });

  test('unmount destroys the store, the columns, the renderers and the selection', () => {
    const t = setup();
    const root = t.renderer.render(view(rows(2), { onSelect: () => {} }));
    expect(t.ofType('GtkTreeSelection')).toHaveLength(1);
    root.unmount();
    for (const type of ['GtkTreeView', 'GtkListStore', 'GtkTreeViewColumn', 'GtkCellRendererText', 'GtkCellRendererToggle', 'GtkTreeSelection']) {
      expect(t.ofType(type)).toEqual([]);
    }
  });
});
