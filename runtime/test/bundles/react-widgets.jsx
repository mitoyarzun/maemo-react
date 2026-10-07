import { useState } from 'react';
import { banner, render } from '@maemo-react/core';
import { Box, Button, CheckButton, ComboBox, Label, List, Menu, MenuItem, MenuSeparator, Scale, ToggleButton, Window } from '@maemo-react/widgets';
import { call, get, set } from 'maemo:gobject';
import { stats } from 'maemo:debug';
import { test, assertEqual, run } from '../harness.js';

const refs = {};
const events = [];
const before = stats().handles;
const COLUMNS = [{ field: 'name', title: 'Name', expand: true }, { field: 'state' }, { field: 'on', kind: 'toggle' }];

function rows(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ key: 'e' + i, name: 'Entity ' + i, state: 'off', on: i % 3 === 2 ? null : false });
  return out;
}

function App() {
  const [data, setData] = useState(rows(200));
  const [selected, setSelected] = useState(null);
  const [value, setValue] = useState(30);
  const [mode, setMode] = useState(1);
  const [flag, setFlag] = useState(false);
  return (
    <Window title="react-widgets test">
      <Menu>
        <MenuItem ref={(r) => (refs.item = r)} onActivate={() => events.push('menu')}>Reconnect</MenuItem>
        <MenuSeparator />
        <MenuItem onActivate={() => banner('About')}>About</MenuItem>
      </Menu>
      <Box vertical spacing={4}>
        <List
          ref={(r) => (refs.list = r)}
          data={data}
          columns={COLUMNS}
          selected={selected}
          expand
          onSelect={(key) => {
            events.push('select ' + key);
            setSelected(key);
          }}
          onToggle={(key, field, on) => {
            events.push('toggle ' + key + ' ' + on);
            setData(data.map((r) => (r.key === key ? { ...r, on, state: on ? 'on' : 'off' } : r)));
          }}
        />
        <Scale ref={(r) => (refs.scale = r)} min={0} max={100} value={value} onChangeValue={(v) => { events.push('scale ' + v); setValue(v); }} />
        <ComboBox ref={(r) => (refs.combo = r)} items={['heat', 'cool', 'off']} active={mode} onChangeActive={(i, item) => { events.push('combo ' + i + ' ' + item); setMode(i); }} />
        <ToggleButton ref={(r) => (refs.toggle = r)} active={flag} onToggle={(a) => { events.push('toggle-button ' + a); setFlag(a); }}>Favorite</ToggleButton>
        <CheckButton ref={(r) => (refs.check = r)} active={flag} onToggle={setFlag}>Same flag</CheckButton>
        <Label ref={(r) => (refs.status = r)}>{`selected ${selected} value ${value} mode ${mode} flag ${flag} rows ${data.length}`}</Label>
        <Button ref={(r) => (refs.drop = r)} onClick={() => setData(data.filter((r) => r.key !== selected))}>Remove selected</Button>
      </Box>
    </Window>
  );
}

const root = render(<App />);
const status = () => get(refs.status.handle, 'label');
const store = () => get(refs.list.handle, 'model');

test('the list has 200 rows in a GtkListStore, with hidden toggles on every third row', () => {
  assertEqual(call(store(), 'listStore.length'), 200);
  assertEqual(call(store(), 'listStore.get', 2, 0), 'Entity 2');
  assertEqual(call(store(), 'listStore.get', 2, 3), false);
  assertEqual(call(store(), 'listStore.get', 1, 3), true);
  // GTK 2.10 on Diablo selects the first row by itself, and the handler runs once.
  // Desktop GTK does not. Accept both here; the next tests set the selection.
  assertEqual(status().replace(/^selected (null|e0) /, 'selected - '), 'selected - value 30 mode 1 flag false rows 200');
});

test('a toggled row changes one store row through React state', () => {
  const toggle = call(refs.list.handle, 'treeView.renderer', 2);
  call(toggle, 'object.emit', 'toggled', '4');
  assertEqual(events.pop(), 'toggle e4 true');
  assertEqual([call(store(), 'listStore.get', 4, 1), call(store(), 'listStore.get', 4, 2)], ['on', true]);
  assertEqual(call(store(), 'listStore.get', 3, 1), 'off');
});

test('a selection goes through React state and back to the view', () => {
  call(refs.list.handle, 'treeView.selectIndex', 7); // as a tap does
  assertEqual(events.pop(), 'select e7');
  assertEqual(call(refs.list.handle, 'treeView.selectedIndex'), 7);
  assertEqual(status(), 'selected e7 value 30 mode 1 flag false rows 200');
});

test('a handler that removes the selected row', async () => {
  call(refs.drop.handle, 'button.clicked');
  assertEqual(call(store(), 'listStore.length'), 199);
  assertEqual(call(refs.list.handle, 'treeView.selectedIndex'), -1);
  await new Promise((r) => setTimeout(r, 0));
  assertEqual(events.pop(), 'select null');
  assertEqual(status(), 'selected null value 30 mode 1 flag false rows 199');
});

test('the scale reports a value change, and follows its prop', () => {
  assertEqual(call(refs.scale.handle, 'range.getValue'), 30);
  call(refs.scale.handle, 'range.setValue', 55); // GTK does this on the release
  assertEqual(events.pop(), 'scale 55');
  assertEqual(status(), 'selected null value 55 mode 1 flag false rows 199');
});

test('the combo box reports the chosen row', () => {
  assertEqual(call(refs.combo.handle, 'comboBox.activeText'), 'cool');
  set(refs.combo.handle, 'active', 2);
  assertEqual(events.pop(), 'combo 2 off');
  assertEqual(status(), 'selected null value 55 mode 2 flag false rows 199');
});

test('the toggle button and the check button share one state', () => {
  set(refs.toggle.handle, 'active', true);
  assertEqual(events.pop(), 'toggle-button true');
  assertEqual(get(refs.check.handle, 'active'), true);
  assertEqual(status(), 'selected null value 55 mode 2 flag true rows 199');
});

test('a menu item activates, and a banner shows', () => {
  call(refs.item.handle, 'object.emit', 'activate');
  assertEqual(events.pop(), 'menu');
  banner('Saved');
});

test('unmount releases every handle', () => {
  root.unmount();
  assertEqual(stats().handles, before);
});

run();
