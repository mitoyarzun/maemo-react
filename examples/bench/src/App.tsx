import { useEffect, useRef, useState } from 'react';
import { args, quit } from 'maemo:app';
import { call } from 'maemo:gobject';
import { bridgeTime, cpu, flushPaint } from 'maemo:debug';
import type { WidgetTarget } from '@maemo-react/types';
import { Box, Button, Label, List, ScrolledWindow, Window, type ListColumn, type ListRow } from '@maemo-react/widgets';

type Mode = 'counter' | 'list' | 'tree' | 'tree1';
const ROWS = 200;

function Counter({ n }: { n: number }) {
  return <Label>{'Count: ' + n}</Label>;
}

function BoxList({ n }: { n: number }) {
  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      <Box key={i} spacing={4}>
        <Label>{'Node !' + (0x1000 + i).toString(16)}</Label>
        <Label>{'heard ' + ((i * 7 + n) % 60) + ' min ago'}</Label>
      </Box>,
    );
  }
  return (
    <ScrolledWindow expand>
      <Box vertical spacing={2}>
        {rows}
      </Box>
    </ScrolledWindow>
  );
}

const TREE_COLUMNS: ListColumn[] = [{ field: 'name', expand: true }, { field: 'heard' }];

/** The rows of the tree modes. With one, only row n % ROWS gets a new object; the others keep their identity. */
function treeRows(n: number, one: boolean, prev: ListRow[] | null): ListRow[] {
  const out: ListRow[] = [];
  for (let i = 0; i < ROWS; i++) {
    if (one && prev && i !== n % ROWS) {
      out.push(prev[i]);
      continue;
    }
    out.push({ key: 'r' + i, name: 'Node !' + (0x1000 + i).toString(16), heard: 'heard ' + ((i * 7 + n) % 60) + ' min ago' });
  }
  return out;
}

function TreeList({ data }: { data: ListRow[] }) {
  return <List data={data} columns={TREE_COLUMNS} expand />;
}

function stat(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 10) / 10;
  return { median: r(s[s.length >> 1]), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s[s.length - 1]) };
}

export function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [n, setN] = useState(0);
  const [report, setReport] = useState('Press a button. One update every 50 ms, timed from click to paint.');
  const step = useRef<WidgetTarget | null>(null);
  const treeData = useRef<ListRow[] | null>(null);
  const isTree = mode === 'tree' || mode === 'tree1';
  treeData.current = isTree ? treeRows(n, mode === 'tree1', treeData.current) : null;

  function run(m: Mode, count: number, then?: () => void) {
    setMode(m);
    setN(0);
    setTimeout(() => {
      flushPaint(); // the first paint of the new screen
      const total: number[] = [];
      const js: number[] = [];
      const gtk: number[] = [];
      const paint: number[] = [];
      let i = 0;
      let clock: ReturnType<typeof cpu> = null;
      const id = setInterval(() => {
        if (i === count >> 1) clock = cpu(); // sample the clock in the middle of the loop
        bridgeTime();
        const t0 = performance.now();
        call(step.current!.handle, 'button.clicked'); // renders before it returns
        const t1 = performance.now();
        const g = bridgeTime();
        flushPaint();
        const t2 = performance.now();
        total.push(t2 - t0);
        js.push(t1 - t0 - g);
        gtk.push(g);
        paint.push(t2 - t1);
        if (++i < count) return;
        clearInterval(id);
        const result = { mode: m, n: count, cpu: clock, total: stat(total), js: stat(js), gtk: stat(gtk), paint: stat(paint) };
        console.log('BENCH ' + JSON.stringify(result));
        setReport(
          `${m}: click to paint ${result.total.median} ms median ` +
            `(JS ${result.js.median}, GTK ${result.gtk.median}, paint ${result.paint.median})`,
        );
        then?.();
      }, 50);
    }, 500);
  }

  useEffect(() => {
    if (args.includes('--auto')) {
      run('counter', 100, () => run('list', 10, () => run('tree', 10, () => run('tree1', 100, () => quit(0)))));
    }
  }, []);

  return (
    <Window title="React Bench">
      <Box vertical spacing={6}>
        <Box spacing={6}>
          <Button onClick={() => run('counter', 100)}>Counter x100</Button>
          <Button onClick={() => run('list', 10)}>List of 200 x10</Button>
          <Button onClick={() => run('tree', 10)}>Tree of 200 x10</Button>
          <Button onClick={() => run('tree1', 100)}>Tree 1 row x100</Button>
        </Box>
        <Label wrap>{report}</Label>
        <Button ref={step} onClick={() => setN((x) => x + 1)}>
          {'Step ' + n}
        </Button>
        {mode === 'counter' ? <Counter n={n} /> : null}
        {mode === 'list' ? <BoxList n={n} /> : null}
        {isTree ? <TreeList data={treeData.current!} /> : null}
      </Box>
    </Window>
  );
}
