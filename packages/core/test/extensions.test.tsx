import { describe, expect, test } from 'vitest';
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

describe('Scale (gtk-hscale, gtk-vscale)', () => {
  test('mount sets the policy, the range, the increments and the value', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-hscale min={0} max={255} step={5} value={40} />
      </hildon-window>,
    );
    const [s] = t.ofType('GtkHScale');
    expect(t.props(s)['update-policy']).toBe('discontinuous');
    expect(t.ops).toContainEqual(['call', s, 'range.setRange', 0, 255]);
    expect(t.ops).toContainEqual(['call', s, 'range.setIncrements', 5, 50]);
    expect(t.valueOf(s)).toBe(40);
  });

  test('defaults: 0 to 100 in steps of 1; a vertical scale is a GtkVScale', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-vscale />
      </hildon-window>,
    );
    const [s] = t.ofType('GtkVScale');
    expect(t.ops).toContainEqual(['call', s, 'range.setRange', 0, 100]);
    expect(t.ops).toContainEqual(['call', s, 'range.setIncrements', 1, 10]);
  });

  test('a value out of the range is clamped by GTK, with no error', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-hscale max={100} value={150} />
      </hildon-window>,
    );
    expect(t.valueOf(t.ofType('GtkHScale')[0])).toBe(100);
    expect(t.errors).toEqual([]);
  });

  test('onChangeValue runs when GTK changes the value; a controlled set does not echo', () => {
    const t = setup();
    const got: number[] = [];
    let changed = 0;
    const scale = (value: number) => (
      <hildon-window>
        <gtk-hscale value={value} onChangeValue={(v) => got.push(v)} onValueChanged={() => changed++} />
      </hildon-window>
    );
    const root = t.renderer.render(scale(10));
    const [s] = t.ofType('GtkHScale');
    t.drag(s, 42);
    expect(got).toEqual([42]);
    expect(changed).toBe(1);
    root.render(scale(70));
    expect(t.valueOf(s)).toBe(70);
    expect(got).toEqual([42]);
    expect(changed).toBe(1);
  });

  test('a range that clamps the value does not run onChangeValue', () => {
    const t = setup();
    const got: number[] = [];
    const scale = (max: number) => (
      <hildon-window>
        <gtk-hscale max={max} value={80} onChangeValue={(v) => got.push(v)} />
      </hildon-window>
    );
    const root = t.renderer.render(scale(100));
    root.render(scale(50));
    expect(t.valueOf(t.ofType('GtkHScale')[0])).toBe(50);
    expect(got).toEqual([]);
  });

  test('an out of range value makes no set call on later updates', () => {
    const t = setup();
    const scale = () => (
      <hildon-window>
        <gtk-hscale max={100} value={150} />
      </hildon-window>
    );
    const root = t.renderer.render(scale());
    const from = t.ops.length;
    root.render(scale());
    expect(t.ops.slice(from).filter((o) => o[2] === 'range.setValue')).toEqual([]);
  });

  test('an update with the same range makes no range call', () => {
    const t = setup();
    const root = t.renderer.render(
      <hildon-window>
        <gtk-hscale min={1} max={9} step={2} />
      </hildon-window>,
    );
    const from = t.ops.length;
    root.render(
      <hildon-window>
        <gtk-hscale min={1} max={9} step={2} />
      </hildon-window>,
    );
    expect(t.ops.slice(from).filter((o) => o[0] === 'call' && String(o[2]).startsWith('range.set'))).toEqual([]);
  });
});

describe('ComboBox (gtk-combo-box)', () => {
  test('items fill the combo box, and active is applied after the items', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-combo-box items={['heat', 'cool']} active={1} />
      </hildon-window>,
    );
    const [c] = t.ofType('GtkComboBox');
    expect(t.itemsOf(c)).toEqual(['heat', 'cool']);
    expect(t.props(c).active).toBe(1);
  });

  test('new items keep active and do not run onChanged', () => {
    const t = setup();
    const got: unknown[] = [];
    const combo = (items: string[]) => (
      <hildon-window>
        <gtk-combo-box items={items} active={1} onChanged={(target) => got.push(target.get('active'))} />
      </hildon-window>
    );
    const root = t.renderer.render(combo(['a', 'b']));
    root.render(combo(['a', 'b', 'c']));
    const [c] = t.ofType('GtkComboBox');
    expect(t.itemsOf(c)).toEqual(['a', 'b', 'c']);
    expect(t.props(c).active).toBe(1);
    expect(got).toEqual([]);
  });

  test('equal items make no call; the user picks a row and onChanged runs', () => {
    const t = setup();
    const got: unknown[] = [];
    const combo = () => (
      <hildon-window>
        <gtk-combo-box items={['a', 'b']} onChanged={(target) => got.push(target.get('active'))} />
      </hildon-window>
    );
    const root = t.renderer.render(combo());
    const from = t.ops.length;
    root.render(combo());
    expect(t.ops.slice(from).filter((o) => o[2] === 'comboBox.setItems')).toEqual([]);
    const [c] = t.ofType('GtkComboBox');
    t.poke(c, 'active', 0);
    t.emit(c, 'changed');
    expect(got).toEqual([0]);
  });
});

describe('a controlled value goes back to GTK when the handler keeps the state', () => {
  const cases: Array<[string, string, unknown, unknown]> = [
    ['gtk-toggle-button', 'GtkToggleButton', false, true],
    ['gtk-check-button', 'GtkCheckButton', false, true],
    ['gtk-combo-box', 'GtkComboBox', 0, 1],
  ];
  test.each(cases)('%s', (el, gtype, kept, changed) => {
    const t = setup();
    const got: unknown[] = [];
    const Tag = el as 'gtk-toggle-button';
    const tree = (label: string) => (
      <hildon-window>
        <gtk-vbox>
        <gtk-label>{label}</gtk-label>
        {el === 'gtk-combo-box' ? (
          <gtk-combo-box items={['a', 'b']} active={kept as number} onChanged={(target) => got.push(target.get('active'))} />
        ) : (
          <Tag active={kept as boolean} onToggled={(target) => got.push(target.get('active'))} />
        )}
        </gtk-vbox>
      </hildon-window>
    );
    const root = t.renderer.render(tree('one'));
    const [w] = t.ofType(gtype);
    // The user changes the widget; the handler runs and keeps the React state.
    t.poke(w, 'active', changed);
    t.emit(w, el === 'gtk-combo-box' ? 'changed' : 'toggled');
    expect(got).toEqual([changed]);
    // Any re-render puts the React value back, and no handler runs for it.
    root.render(tree('two'));
    expect(t.props(w).active).toBe(kept);
    expect(got).toEqual([changed]);
    expect(t.errors).toEqual([]);
  });
});

describe('extension edge cases', () => {
  test('a Scale value of NaN is absent: no setValue on any update', () => {
    const t = setup();
    const scale = (l: string) => (
      <hildon-window>
        <gtk-vbox>
          <gtk-label>{l}</gtk-label>
          <gtk-hscale value={NaN} />
        </gtk-vbox>
      </hildon-window>
    );
    const root = t.renderer.render(scale('a'));
    root.render(scale('b'));
    expect(t.ops.filter((o) => o[2] === 'range.setValue')).toEqual([]);
  });

  test('a ComboBox with no items does not call setItems on an update', () => {
    const t = setup();
    const combo = (l: string) => (
      <hildon-window>
        <gtk-vbox>
          <gtk-label>{l}</gtk-label>
          <gtk-combo-box />
        </gtk-vbox>
      </hildon-window>
    );
    const root = t.renderer.render(combo('a'));
    const from = t.ops.length;
    root.render(combo('b'));
    expect(t.ops.slice(from).filter((o) => o[2] === 'comboBox.setItems')).toEqual([]);
  });
});

test('an uncontrolled Entry keeps the user text on a re-render, with no reset', () => {
  const t = setup();
  const tree = (l: string) => (
    <hildon-window>
      <gtk-vbox>
        <gtk-label>{l}</gtk-label>
        <gtk-entry text={undefined} onChanged={() => {}} />
      </gtk-vbox>
    </hildon-window>
  );
  const root = t.renderer.render(tree('a'));
  const [e] = t.ofType('GtkEntry');
  t.poke(e, 'text', 'typed');
  t.emit(e, 'changed');
  root.render(tree('b'));
  expect(t.props(e).text).toBe('typed');
  expect(t.ops.filter((o) => o[0] === 'reset')).toEqual([]);
});

describe('Window (hildon-window)', () => {
  test('onTopmostChange follows notify::is-topmost on hildon', () => {
    const t = setup();
    const seen: boolean[] = [];
    t.renderer.render(<hildon-window onTopmostChange={(top) => seen.push(top)} />);
    const [win] = t.ofType('HildonWindow');
    expect(t.ops).toContainEqual(['connect', win, 'notify::is-topmost']);
    t.poke(win, 'is-topmost', false);
    t.emit(win, 'notify::is-topmost');
    t.poke(win, 'is-topmost', true);
    t.emit(win, 'notify::is-topmost');
    expect(seen).toEqual([false, true]);
  });

  test('onTopmostChange follows notify::is-active on the desktop', () => {
    const fake = fakeBridge();
    const renderer = createRenderer(fake.bridge, 'desktop');
    const seen: boolean[] = [];
    renderer.render(<hildon-window onTopmostChange={(top) => seen.push(top)} />);
    const [win] = fake.ofType('GtkWindow');
    expect(fake.ops).toContainEqual(['connect', win, 'notify::is-active']);
    fake.poke(win, 'is-active', true);
    fake.emit(win, 'notify::is-active');
    expect(seen).toEqual([true]);
  });

  test('a window without the prop connects nothing, and a later prop connects once', () => {
    const t = setup();
    const root = t.renderer.createRoot();
    root.render(<hildon-window />);
    const [win] = t.ofType('HildonWindow');
    expect(t.ops.filter((op) => op[0] === 'connect' && op[1] === win && String(op[2]).startsWith('notify::'))).toHaveLength(0);
    root.render(<hildon-window onTopmostChange={() => {}} />);
    root.render(<hildon-window onTopmostChange={() => {}} />);
    expect(t.ops.filter((op) => op[0] === 'connect' && op[1] === win && op[2] === 'notify::is-topmost')).toHaveLength(1);
  });
});
