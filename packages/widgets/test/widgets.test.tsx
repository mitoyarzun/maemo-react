import { describe, expect, test } from 'vitest';
import { createRenderer } from '../../core/src/renderer.js';
import { fakeBridge } from '../../core/test/fakeBridge.js';
import { Box, Button, CheckButton, ComboBox, Entry, Label, List, Menu, MenuItem, MenuSeparator, Scale, ScrolledWindow, ToggleButton, Window } from '../src/index.js';

function setup() {
  const fake = fakeBridge();
  const renderer = createRenderer(fake.bridge, 'hildon', { onError: (e) => { throw e; } });
  return { ...fake, renderer };
}

describe('widgets', () => {
  test('Box is a row by default and a column when vertical', () => {
    const t = setup();
    t.renderer.render(
      <Window>
        <Box vertical spacing={2}>
          <Box />
        </Box>
      </Window>,
    );
    expect(t.ofType('GtkVBox')).toHaveLength(1);
    expect(t.ofType('GtkHBox')).toHaveLength(1);
    expect(t.props(t.ofType('GtkVBox')[0]).spacing).toBe(2);
  });

  test('Button calls onClick on clicked', () => {
    const t = setup();
    let n = 0;
    t.renderer.render(
      <Window>
        <Button onClick={() => n++}>Go</Button>
      </Window>,
    );
    const [b] = t.ofType('GtkButton');
    expect(t.props(b).label).toBe('Go');
    t.emit(b, 'clicked');
    expect(n).toBe(1);
  });

  test('Entry gives the new text to onChangeText', () => {
    const t = setup();
    let got = '';
    t.renderer.render(
      <Window>
        <Entry value="a" onChangeText={(s) => (got = s)} />
      </Window>,
    );
    const [e] = t.ofType('GtkEntry');
    expect(t.props(e).text).toBe('a');
    t.poke(e, 'text', 'ab');
    t.emit(e, 'changed');
    expect(got).toBe('ab');
  });

  test('Label and ScrolledWindow pass their props', () => {
    const t = setup();
    t.renderer.render(
      <Window title="w">
        <ScrolledWindow vscrollbarPolicy="always">
          <Label wrap>hello</Label>
        </ScrolledWindow>
      </Window>,
    );
    const [s] = t.ofType('GtkScrolledWindow');
    expect(t.props(s)['vscrollbar-policy']).toBe('always');
    expect(t.props(t.ofType('GtkLabel')[0])).toMatchObject({ label: 'hello', wrap: true });
    expect(t.props(t.ofType('HildonWindow')[0]).title).toBe('w');
  });

  test('List: a scrolled tree view, the row in onSelect and onToggle, headers from the titles', () => {
    const t = setup();
    const got: unknown[] = [];
    const data = [
      { key: 'a', name: 'Lamp', on: false },
      { key: 'b', name: 'Fan', on: true },
    ];
    t.renderer.render(
      <Window>
        <Box vertical>
          <List
            data={data}
            columns={[{ field: 'name', title: 'Name' }, { field: 'on', kind: 'toggle' }]}
            expand
            onSelect={(key, row) => got.push(['select', key, row])}
            onToggle={(key, field, value, row) => got.push(['toggle', key, field, value, row])}
          />
        </Box>
      </Window>,
    );
    const [scrolled] = t.ofType('GtkScrolledWindow');
    const [tv] = t.ofType('GtkTreeView');
    expect(t.childrenOf(scrolled)).toEqual([tv]);
    expect(t.ops).toContainEqual(['childSet', t.ofType('GtkVBox')[0], scrolled, 'expand', true]);
    expect(t.props(tv)['headers-visible']).toBe(true);
    t.tap(tv, 1);
    t.emit(t.ofType('GtkCellRendererToggle')[0], 'toggled', '0');
    expect(got).toEqual([
      ['select', 'b', data[1]],
      ['toggle', 'a', 'on', true, data[0]],
    ]);
  });

  test('List visible={false} hides the whole list, with its scrolled window', () => {
    const t = setup();
    t.renderer.render(
      <Window>
        <List data={[]} columns={[{ field: 'name' }]} visible={false} />
      </Window>,
    );
    expect(t.props(t.ofType('GtkScrolledWindow')[0]).visible).toBe(false);
  });

  test('List without titles hides the headers', () => {
    const t = setup();
    t.renderer.render(
      <Window>
        <List data={[]} columns={[{ field: 'name' }]} />
      </Window>,
    );
    expect(t.props(t.ofType('GtkTreeView')[0])['headers-visible']).toBe(false);
  });
  test('ToggleButton and CheckButton give the new state to onToggle', () => {
    const t = setup();
    const got: boolean[] = [];
    t.renderer.render(
      <Window>
        <Box>
          <ToggleButton active={false} onToggle={(a) => got.push(a)}>
            Favorite
          </ToggleButton>
          <CheckButton active onToggle={(a) => got.push(a)}>
            Check
          </CheckButton>
        </Box>
      </Window>,
    );
    const [tb] = t.ofType('GtkToggleButton');
    const [cb] = t.ofType('GtkCheckButton');
    expect([t.props(tb).label, t.props(tb).active, t.props(cb).active]).toEqual(['Favorite', false, true]);
    t.poke(tb, 'active', true);
    t.emit(tb, 'toggled');
    t.poke(cb, 'active', false);
    t.emit(cb, 'toggled');
    expect(got).toEqual([true, false]);
  });

  test('Scale is horizontal by default, vertical on request, with 0 digits', () => {
    const t = setup();
    const got: number[] = [];
    t.renderer.render(
      <Window>
        <Box>
          <Scale min={0} max={10} value={3} onChangeValue={(v) => got.push(v)} />
          <Scale vertical digits={1} />
        </Box>
      </Window>,
    );
    const [h] = t.ofType('GtkHScale');
    const [v] = t.ofType('GtkVScale');
    expect([t.props(h).digits, t.props(v).digits]).toEqual([0, 1]);
    t.drag(h, 7);
    expect(got).toEqual([7]);
  });

  test('ComboBox gives the index and the item to onChangeActive', () => {
    const t = setup();
    const got: unknown[] = [];
    t.renderer.render(
      <Window>
        <ComboBox items={['heat', 'cool']} active={0} onChangeActive={(i, item) => got.push([i, item])} />
      </Window>,
    );
    const [c] = t.ofType('GtkComboBox');
    t.poke(c, 'active', 1);
    t.emit(c, 'changed');
    expect(got).toEqual([[1, 'cool']]);
  });

  test('Menu, MenuItem and MenuSeparator make the window menu', () => {
    const t = setup();
    let n = 0;
    t.renderer.render(
      <Window>
        <Box />
        <Menu>
          <MenuItem onActivate={() => n++}>Reconnect</MenuItem>
          <MenuSeparator />
          <MenuItem>About</MenuItem>
        </Menu>
      </Window>,
    );
    const [win] = t.ofType('HildonWindow');
    const [menu] = t.ofType('GtkMenu');
    expect(t.menuOf(win)).toBe(menu);
    const items = t.childrenOf(menu);
    expect(items.map((h) => t.typeOf(h))).toEqual(['GtkMenuItem', 'GtkSeparatorMenuItem', 'GtkMenuItem']);
    expect(t.props(t.childrenOf(items[0])[0])).toMatchObject({ label: 'Reconnect', xalign: 0 });
    t.emit(items[0], 'activate');
    expect(n).toBe(1);
  });

  test('a value from React does not run onToggle or onChangeActive; a user change does', () => {
    const t = setup();
    const got: unknown[] = [];
    const ui = (on: boolean, i: number) => (
      <Window>
        <Box>
          <ToggleButton active={on} onToggle={(a) => got.push(['t', a])} />
          <CheckButton active={on} onToggle={(a) => got.push(['c', a])} />
          <ComboBox items={['a', 'b']} active={i} onChangeActive={(n) => got.push(['o', n])} />
        </Box>
      </Window>
    );
    const root = t.renderer.render(ui(false, 0));
    root.render(ui(true, 1));
    expect(got).toEqual([]);
    const [tb] = t.ofType('GtkToggleButton');
    const [c] = t.ofType('GtkComboBox');
    t.poke(tb, 'active', false);
    t.emit(tb, 'toggled');
    t.poke(c, 'active', 0);
    t.emit(c, 'changed');
    expect(got).toEqual([['t', false], ['o', 0]]);
  });
});
