// Compile-time checks of the types. tsc must accept this file, and each line
// that is marked as an expected error must really be an error.
import { useState } from 'react';
import { banner, render } from '@maemo-react/core';
import { Box, Button, CheckButton, ComboBox, Entry, Label, List, Menu, MenuItem, MenuSeparator, Scale, ScrolledWindow, ToggleButton, Window } from '@maemo-react/widgets';
import { request } from 'maemo:http';
import { quit } from 'maemo:app';

function App() {
  const [n, setN] = useState(0);
  const [text, setText] = useState('');
  return (
    <Window title="t" onTopmostChange={(top) => console.log(top)}>
      <Box vertical spacing={4} homogeneous>
        <Label wrap expand>
          Count {n}
        </Label>
        <Button onClick={() => setN(n + 1)}>+</Button>
        <Entry value={text} onChangeText={setText} maxLength={20} />
        <ScrolledWindow hscrollbarPolicy="never">
          <gtk-vbox />
        </ScrolledWindow>
        <gtk-entry text="x" onChanged={(t) => console.log(t.get('text'))} />
        <gtk-tree-view data={[{ key: 'a', name: 'A', on: true }]} columns={[{ field: 'name', title: 'Name', expand: true }, { field: 'on', kind: 'toggle' }]} selected="a" onSelect={(k) => console.log(k)} onToggle={(k, f, v) => console.log(k, f, v)} headersVisible={false} />
        <gtk-hscale min={0} max={255} step={5} value={n} digits={0} onChangeValue={(v) => setN(v)} />
        <gtk-combo-box items={['heat', 'cool']} active={0} onChanged={(t) => console.log(t.get('active'))} />
        <gtk-toggle-button active onToggled={() => {}}>Favorite</gtk-toggle-button>
        <gtk-check-button active={false}>Check</gtk-check-button>
        <List data={[{ key: 'a', name: 'A', on: true }]} columns={[{ field: 'name', title: 'Name' }, { field: 'on', kind: 'toggle' }]} selected="a" expand onSelect={(k, row) => console.log(k, row?.name)} onToggle={(k, f, v, row) => console.log(k, f, v, row.key)} />
        <Scale min={0} max={100} value={n} onChangeValue={setN} />
        <Scale vertical />
        <ComboBox items={['heat', 'cool']} active={0} onChangeActive={(i, item) => console.log(i, item)} />
        <ToggleButton active onToggle={(a) => console.log(a)}>Favorite</ToggleButton>
        <CheckButton active={false}>Check</CheckButton>
        {/* @ts-expect-error: onToggle gets a boolean */}
        <ToggleButton onToggle={(a: string) => console.log(a)}>x</ToggleButton>
        {/* @ts-expect-error: a row key is a string */}
        <gtk-tree-view data={[{ key: 1 }]} />
        {/* @ts-expect-error: min is a number */}
        <gtk-hscale min="0" />
        {/* @ts-expect-error: items are strings */}
        <gtk-combo-box items={[1]} />
        {/* @ts-expect-error: GtkLabel has no such property */}
        <gtk-label nope />
        {/* @ts-expect-error: not a GtkPolicyType */}
        <gtk-scrolled-window hscrollbarPolicy="sometimes" />
        {/* @ts-expect-error: spacing is a number */}
        <gtk-vbox spacing="4" />
        {/* @ts-expect-error: an entry has no children */}
        <gtk-entry>text</gtk-entry>
      </Box>
      <Menu>
        <MenuItem onActivate={() => banner('Reconnecting')}>Reconnect</MenuItem>
        <MenuSeparator />
        <MenuItem onActivate={() => quit(0)}>Quit</MenuItem>
      </Menu>
    </Window>
  );
}

render(<App />);
fetch('https://example.com/').then((r) => r.json());
const u: URL = new URL('https://example.com/');
request({ url: u.href }, (ev) => {
  if (ev.type === 'data') console.log(ev.chunk.byteLength);
});
const sock = new WebSocket('wss://example.com/api/websocket', ['ha']);
sock.onmessage = (e) => console.log(typeof e.data === 'string' ? e.data : e.data.byteLength);
sock.onclose = (e) => console.log(e.code, e.reason, e.wasClean);
sock.addEventListener('open', () => sock.send(JSON.stringify({ type: 'auth' })));
sock.send(new Uint8Array(2));
sock.close(1000, 'bye');
// @ts-expect-error: there is no Blob on the tablet
sock.binaryType = 'blob';
localStorage.setItem('ha.server', 'http://h:8123');
const server: string | null = localStorage.getItem('ha.server');
console.log(server, localStorage.length, localStorage.key(0));
// @ts-expect-error: there is no sessionStorage on the tablet
sessionStorage.setItem('x', 'y');
quit(0);
// @ts-expect-error: there is no DOM on the tablet
document.title = 'x';
