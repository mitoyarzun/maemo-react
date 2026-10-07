import { useState } from 'react';
import { render } from '@maemo-react/core';
import { Box, Button, Entry, Label, Window } from '@maemo-react/widgets';
import { call, get, set } from 'maemo:gobject';
import { stats } from 'maemo:debug';
import { test, assertEqual, run } from '../harness.js';

const refs = {};
const before = stats().handles;

function App() {
  const [n, setN] = useState(0);
  const [text, setText] = useState('');
  const [gone, setGone] = useState(false);
  return (
    <Window title="react-gtk test">
      <Box vertical spacing={4}>
        <Label ref={(r) => (refs.count = r)}>{'count ' + n}</Label>
        <Button ref={(r) => (refs.inc = r)} onClick={() => setN(n + 1)}>
          +1
        </Button>
        <Entry ref={(r) => (refs.entry = r)} value={text} onChangeText={setText} />
        <Label ref={(r) => (refs.echo = r)}>{'echo ' + text}</Label>
        {gone ? null : (
          <Button ref={(r) => (refs.gone = r)} onClick={() => setGone(true)}>
            remove me
          </Button>
        )}
      </Box>
    </Window>
  );
}

const root = render(<App />);

test('the tree is made of GTK widgets', () => {
  assertEqual(get(refs.count.handle, 'label'), 'count 0');
  assertEqual(get(refs.inc.handle, 'label'), '+1');
});

test('a click updates the label before the click returns', () => {
  call(refs.inc.handle, 'button.clicked');
  assertEqual(get(refs.count.handle, 'label'), 'count 1');
  call(refs.inc.handle, 'button.clicked');
  assertEqual(get(refs.count.handle, 'label'), 'count 2');
});

test('typing goes through React state', () => {
  set(refs.entry.handle, 'text', 'abc'); // GTK emits "changed"
  assertEqual(get(refs.echo.handle, 'label'), 'echo abc');
  assertEqual(get(refs.entry.handle, 'text'), 'abc');
});

test('a button that removes itself in its click handler', () => {
  const h = refs.gone.handle;
  const handles = stats().handles;
  call(h, 'button.clicked');
  assertEqual(refs.gone, null);
  assertEqual(stats().handles, handles - 1);
});

test('unmount releases every handle', () => {
  root.unmount();
  assertEqual(stats().handles, before);
});

run();
