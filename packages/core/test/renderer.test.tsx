import { Component, Suspense, lazy, startTransition, useState, useSyncExternalStore, type ReactNode } from 'react';
import { describe, expect, test } from 'vitest';
import type { Platform } from '../src/bridge.js';
import { createHostConfig } from '../src/hostConfig.js';
import { createRenderer } from '../src/renderer.js';
import { fakeBridge } from './fakeBridge.js';

function setup(platform: Platform = 'hildon') {
  const fake = fakeBridge();
  const errors: string[] = [];
  let closed = 0;
  let fatal = 0;
  const renderer = createRenderer(fake.bridge, platform, {
    onWindowClosed: () => {
      closed++;
    },
    onFatalError: () => {
      fatal++;
    },
    onError: (e) => {
      errors.push(String(e instanceof Error ? e.message : e));
    },
  });
  return {
    ...fake,
    renderer,
    errors,
    closed: () => closed,
    fatal: () => fatal,
    windowHandle: () => renderer.windowHandle(),
    /** Mute the instance of a handle, as an extension does while a helper runs. */
    muteOf: (h: number, on: boolean) => renderer.muteInstance(h, on),
  };
}

describe('mount', () => {
  test('a window with a box, a label and a button', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window title="T">
        <gtk-vbox spacing={4}>
          <gtk-label>Hello</gtk-label>
          <gtk-button>Go</gtk-button>
        </gtk-vbox>
      </hildon-window>,
    );
    const [win] = t.ofType('HildonWindow');
    expect(t.props(win).title).toBe('T');
    const [box] = t.childrenOf(win);
    expect(t.typeOf(box)).toBe('GtkVBox');
    expect(t.props(box).spacing).toBe(4);
    const [label, button] = t.childrenOf(box);
    expect([t.props(label).label, t.props(button).label]).toEqual(['Hello', 'Go']);
    expect(t.ops).toContainEqual(['call', win, 'window.registerProgram']);
    expect(t.ops).toContainEqual(['call', win, 'widget.show']);
    expect(t.ops).toContainEqual(['childSet', box, label, 'expand', false]);
    expect(t.ops).toContainEqual(['childSet', box, label, 'fill', true]);
  });

  test('the desktop platform makes a GtkWindow', () => {
    const t = setup('desktop');
    t.renderer.render(<hildon-window />);
    expect(t.ofType('GtkWindow')).toHaveLength(1);
  });

  test('camelCase props become GObject property names', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-scrolled-window hscrollbarPolicy="never" />
      </hildon-window>,
    );
    const [s] = t.ofType('GtkScrolledWindow');
    expect(t.ops).toContainEqual(['set', s, 'hscrollbar-policy', 'never']);
  });

  test('text from mixed children', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-label>Count: {3}</gtk-label>
      </hildon-window>,
    );
    expect(t.props(t.ofType('GtkLabel')[0]).label).toBe('Count: 3');
  });

  test('a raw string in a box becomes a label', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-vbox>just text</gtk-vbox>
      </hildon-window>,
    );
    expect(t.props(t.ofType('GtkLabel')[0]).label).toBe('just text');
  });
});

describe('errors', () => {
  test('an element inside a label', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-label>
          <gtk-button />
        </gtk-label>
      </hildon-window>,
    );
    expect(t.errors.join()).toMatch(/<gtk-label> can contain only text/);
  });

  test('an unknown element', () => {
    const t = setup();
    // @ts-expect-error: not an element
    t.renderer.render(<gtk-nope />);
    expect(t.errors.join()).toMatch(/unknown element <gtk-nope>/);
  });

  test('a widget at the top level', () => {
    const t = setup();
    t.renderer.render(<gtk-label>x</gtk-label>);
    expect(t.errors.join()).toMatch(/only a window can/);
  });

  test('two children in a window', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-label>a</gtk-label>
        <gtk-label>b</gtk-label>
      </hildon-window>,
    );
    expect(t.errors.join()).toMatch(/can contain only one child/);
  });
});

describe('updates', () => {
  function Counter() {
    const [n, setN] = useState(0);
    return (
      <hildon-window>
        <gtk-vbox>
          <gtk-label>{'n=' + n}</gtk-label>
          <gtk-button onClicked={() => setN(n + 1)}>+</gtk-button>
        </gtk-vbox>
      </hildon-window>
    );
  }

  test('a click renders before the signal returns, with the newest handler', () => {
    const t = setup();
    t.renderer.render(<Counter />);
    const [button] = t.ofType('GtkButton');
    const [label] = t.ofType('GtkLabel');
    t.emit(button, 'clicked');
    expect(t.props(label).label).toBe('n=1');
    t.emit(button, 'clicked');
    expect(t.props(label).label).toBe('n=2');
    expect(t.ops.filter((o) => o[0] === 'connect' && o[1] === button && o[2] === 'clicked')).toHaveLength(1);
  });

  test('unchanged props are not set again; a removed prop is reset', () => {
    const t = setup();
    const root = t.renderer.render(
      <hildon-window>
        <gtk-vbox spacing={4} homogeneous />
      </hildon-window>,
    );
    const [box] = t.ofType('GtkVBox');
    const before = t.ops.length;
    root.render(
      <hildon-window>
        <gtk-vbox spacing={4} />
      </hildon-window>,
    );
    const after = t.ops.slice(before);
    expect(after).not.toContainEqual(['set', box, 'spacing', 4]);
    expect(after).toContainEqual(['reset', box, 'homogeneous']);
  });

  test('a handler gets the signal arguments, then the target', () => {
    const t = setup();
    let got: unknown;
    t.renderer.render(
      <hildon-window>
        <gtk-entry onChanged={(target: { get(p: string): unknown }) => (got = target.get('text'))} />
      </hildon-window>,
    );
    const [entry] = t.ofType('GtkEntry');
    t.poke(entry, 'text', 'abc');
    t.emit(entry, 'changed');
    expect(got).toBe('abc');
  });

  test('a controlled text is not set again when GTK has it already', () => {
    const t = setup();
    function Field() {
      const [text, setText] = useState('a');
      return (
        <hildon-window>
          <gtk-entry text={text} onChanged={(target: { get(p: string): unknown }) => setText(target.get('text') as string)} />
        </hildon-window>
      );
    }
    t.renderer.render(<Field />);
    const [entry] = t.ofType('GtkEntry');
    t.poke(entry, 'text', 'ab'); // the user types
    t.emit(entry, 'changed');
    expect(t.ops.filter((o) => o[0] === 'set' && o[1] === entry && o[2] === 'text')).toEqual([['set', entry, 'text', 'a']]);
  });

  test('a keyed list keeps the widgets and changes their order', () => {
    const t = setup();
    const list = (keys: string[]) => (
      <hildon-window>
        <gtk-vbox>
          {keys.map((k) => (
            <gtk-label key={k}>{k}</gtk-label>
          ))}
        </gtk-vbox>
      </hildon-window>
    );
    const root = t.renderer.render(list(['a', 'b', 'c']));
    const [box] = t.ofType('GtkVBox');
    const order = () => t.childrenOf(box).map((h) => t.props(h).label);
    root.render(list(['c', 'a', 'b']));
    expect(order()).toEqual(['c', 'a', 'b']);
    root.render(list(['b', 'c', 'a']));
    expect(order()).toEqual(['b', 'c', 'a']);
    expect(t.ofType('GtkLabel')).toHaveLength(3);
  });

  test('a removed element and a removed text are destroyed', () => {
    const t = setup();
    const view = (show: boolean) => (
      <hildon-window>
        <gtk-vbox>
          {show ? <gtk-button>x</gtk-button> : null}
          {show ? 'text' : null}
        </gtk-vbox>
      </hildon-window>
    );
    const root = t.renderer.render(view(true));
    const [button] = t.ofType('GtkButton');
    const [text] = t.ofType('GtkLabel');
    root.render(view(false));
    expect(t.isDestroyed(button)).toBe(true);
    expect(t.isDestroyed(text)).toBe(true);
    expect(t.childrenOf(t.ofType('GtkVBox')[0])).toEqual([]);
  });

  test('a changed child prop goes to the box', () => {
    const t = setup();
    const view = (expand: boolean) => (
      <hildon-window>
        <gtk-vbox>
          <gtk-label expand={expand}>x</gtk-label>
        </gtk-vbox>
      </hildon-window>
    );
    const root = t.renderer.render(view(false));
    const [box] = t.ofType('GtkVBox');
    const [label] = t.ofType('GtkLabel');
    root.render(view(true));
    expect(t.ops[t.ops.length - 1]).toEqual(['childSet', box, label, 'expand', true]);
  });

  test('flushSync renders its updates before it returns', () => {
    const t = setup();
    let set!: (n: number) => void;
    function App() {
      const [n, setN] = useState(0);
      set = setN;
      return (
        <hildon-window>
          <gtk-label>{String(n)}</gtk-label>
        </hildon-window>
      );
    }
    t.renderer.render(<App />);
    t.renderer.flushSync(() => set(5));
    expect(t.props(t.ofType('GtkLabel')[0]).label).toBe('5');
  });
});

describe('windows', () => {
  test('the user closes the window: onWindowClosed', () => {
    const t = setup();
    t.renderer.render(<hildon-window />);
    t.bridge.destroy(t.ofType('HildonWindow')[0]);
    expect(t.closed()).toBe(1);
  });

  test('unmount destroys the window, and it is not a close', () => {
    const t = setup();
    const root = t.renderer.render(<hildon-window />);
    const [win] = t.ofType('HildonWindow');
    root.unmount();
    expect(t.isDestroyed(win)).toBe(true);
    expect(t.closed()).toBe(0);
  });

  test('a ref gives the widget target', () => {
    const t = setup();
    let target: { handle: number } | null = null;
    t.renderer.render(
      <hildon-window>
        <gtk-label ref={(r: { handle: number } | null) => (target = r)}>x</gtk-label>
      </hildon-window>,
    );
    expect(target!.handle).toBe(t.ofType('GtkLabel')[0]);
  });
});

describe('transitions and Suspense', () => {
  test('an update inside startTransition commits', async () => {
    const t = setup();
    let set!: (n: number) => void;
    function App() {
      const [n, setN] = useState(0);
      set = setN;
      return (
        <hildon-window>
          <gtk-label>{String(n)}</gtk-label>
        </hildon-window>
      );
    }
    t.renderer.render(<App />);
    startTransition(() => set(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(t.errors).toEqual([]);
    expect(t.props(t.ofType('GtkLabel')[0]).label).toBe('3');
  });

  test('a lazy component shows the fallback, then the content', async () => {
    const t = setup();
    const Late = lazy(async () => ({
      default: () => <gtk-label>loaded</gtk-label>,
    }));
    t.renderer.render(
      <hildon-window>
        <Suspense fallback={<gtk-label>wait</gtk-label>}>
          <Late />
        </Suspense>
      </hildon-window>,
    );
    const labels = () => t.ofType('GtkLabel').map((h) => t.props(h).label);
    expect(labels()).toContain('wait');
    await new Promise((r) => setTimeout(r, 700));
    expect(t.errors).toEqual([]);
    const [win] = t.ofType('HildonWindow');
    const shown = t.childrenOf(win);
    expect(shown.map((h) => t.props(h).label)).toEqual(['loaded']);
    expect(labels()).not.toContain('wait');
  });
});

describe('fatal errors', () => {
  function Bad(): ReactNode {
    throw new Error('boom');
  }

  test('an uncaught render error calls onError and onFatalError once', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <Bad />
      </hildon-window>,
    );
    expect(t.errors).toEqual(['boom']);
    expect(t.fatal()).toBe(1);
  });

  test('an error that a boundary catches calls neither', () => {
    const t = setup();
    const log = console.error;
    console.error = () => {};
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? <gtk-label>safe</gtk-label> : this.props.children;
      }
    }
    try {
      t.renderer.render(
        <hildon-window>
          <Boundary>
            <Bad />
          </Boundary>
        </hildon-window>,
      );
    } finally {
      console.error = log;
    }
    expect(t.errors).toEqual([]);
    expect(t.fatal()).toBe(0);
    expect(t.props(t.ofType('GtkLabel')[0]).label).toBe('safe');
  });
});

describe('the last window', () => {
  test('onWindowClosed runs only when the last window closes', () => {
    const t = setup();
    t.renderer.render(
      <>
        <hildon-window />
        <hildon-window />
      </>,
    );
    const [a, b] = t.ofType('HildonWindow');
    t.bridge.destroy(a);
    expect(t.closed()).toBe(0);
    t.bridge.destroy(b);
    expect(t.closed()).toBe(1);
  });
});

describe('moves', () => {
  test('a move under a window does not call box.reorder', () => {
    const fake = fakeBridge();
    const { config } = createHostConfig(fake.bridge, 'hildon', { onWindowClosed() {}, flushSync() {} });
    const win = config.createInstance('hildon-window', {});
    const label = config.createInstance('gtk-label', {});
    config.appendInitialChild(win, label);
    config.insertBefore(win, label, label);
    expect(fake.ops.filter((o) => o[2] === 'box.reorder')).toEqual([]);
  });
});

describe('the window menu', () => {
  const menuView = (items: string[]) => (
    <hildon-window>
      <gtk-vbox />
      <gtk-menu>
        {items.map((k) => (
          <gtk-menu-item key={k}>
            <gtk-label>{k}</gtk-label>
          </gtk-menu-item>
        ))}
        <gtk-separator-menu-item />
      </gtk-menu>
    </hildon-window>
  );

  test('a gtk-menu under a window is attached with window.setMenu, not added as a child', () => {
    const t = setup();
    const root = t.renderer.render(menuView(['One', 'Two']));
    const [win] = t.ofType('HildonWindow');
    const [menu] = t.ofType('GtkMenu');
    expect(t.childrenOf(win)).toEqual(t.ofType('GtkVBox'));
    expect(t.menuOf(win)).toBe(menu);
    expect(t.childrenOf(menu).map((h) => t.typeOf(h))).toEqual(['GtkMenuItem', 'GtkMenuItem', 'GtkSeparatorMenuItem']);
    expect(t.errors).toEqual([]);
    root.render(
      <hildon-window>
        <gtk-vbox />
      </hildon-window>,
    );
    expect(t.menuOf(win)).toBeNull();
    expect(t.isDestroyed(menu)).toBe(true);
  });

  test('menu items keep their order through a keyed update, with menu.reorder', () => {
    const t = setup();
    const root = t.renderer.render(menuView(['a', 'b', 'c']));
    const [menu] = t.ofType('GtkMenu');
    const order = () => t.childrenOf(menu).slice(0, 3).map((h) => t.props(t.childrenOf(h)[0]).label);
    root.render(menuView(['c', 'a', 'b']));
    expect(order()).toEqual(['c', 'a', 'b']);
    expect(t.ops.some((o) => o[0] === 'call' && o[2] === 'menu.reorder')).toBe(true);
    expect(t.ops.some((o) => o[0] === 'call' && o[2] === 'box.reorder')).toBe(false);
  });

  test('a menu item activates its handler', () => {
    const t = setup();
    let n = 0;
    t.renderer.render(
      <hildon-window>
        <gtk-menu>
          <gtk-menu-item onActivate={() => n++}>
            <gtk-label>Go</gtk-label>
          </gtk-menu-item>
        </gtk-menu>
      </hildon-window>,
    );
    t.emit(t.ofType('GtkMenuItem')[0], 'activate');
    expect(n).toBe(1);
  });

  test('a menu outside a window is an error', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-vbox>
          <gtk-menu />
        </gtk-vbox>
      </hildon-window>,
    );
    expect(t.errors.join()).toMatch(/<gtk-menu> must be a child of a window/);
  });
});

describe('element extensions', () => {
  test('a muted instance does not run its event props', () => {
    const t = setup();
    let n = 0;
    t.renderer.render(
      <hildon-window>
        <gtk-button onClicked={() => n++}>x</gtk-button>
      </hildon-window>,
    );
    const [button] = t.ofType('GtkButton');
    t.emit(button, 'clicked');
    t.muteOf(button, true);
    t.emit(button, 'clicked');
    expect(n).toBe(1);
  });

  test('the newest shown window is known, and forgotten when it closes', () => {
    const t = setup();
    const host = createHostConfig(t.bridge, 'hildon', { onWindowClosed: () => {}, flushSync: () => {} });
    expect(host.windowHandle()).toBeNull();
    const root = t.renderer.render(<hildon-window title="a" />);
    expect(t.windowHandle()).toBe(t.ofType('HildonWindow')[0]);
    root.unmount();
    expect(t.windowHandle()).toBeNull();
  });

  test('a destroy that throws for the widget still destroys the extras and forgets the instance', () => {
    const t = setup();
    const root = t.renderer.render(
      <hildon-window>
        <gtk-tree-view data={[]} columns={[{ field: 'a' }]} />
      </hildon-window>,
    );
    const [tv] = t.ofType('GtkTreeView');
    const extras = ['GtkListStore', 'GtkTreeViewColumn', 'GtkCellRendererText', 'GtkTreeSelection'].map((x) => t.ofType(x)[0]);
    const destroy = t.bridge.destroy;
    t.bridge.destroy = (h) => {
      if (h === tv) throw new Error('already destroyed');
      destroy(h);
    };
    expect(() => root.unmount()).toThrow(/already destroyed/);
    for (const h of extras) expect(t.isDestroyed(h)).toBe(true);
  });

  test('a window that the host adds twice is listed once', () => {
    const t = setup();
    const host = createHostConfig(t.bridge, 'hildon', { onWindowClosed: () => {}, flushSync: () => {} });
    const container = { windows: new Set() } as never;
    const win = host.config.createInstance('hildon-window', {});
    host.config.appendChildToContainer(container, win);
    host.config.insertInContainerBefore(container, win);
    host.config.removeChildFromContainer(container, win);
    expect(host.windowHandle()).toBeNull();
  });
});

describe('banner', () => {
  test('goes to the newest shown window, or to the log without a window', () => {
    const t = setup();
    const logged: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logged.push(args.join(' '));
    try {
      t.renderer.banner('no window yet');
      t.renderer.render(<hildon-window title="a" />);
      t.renderer.banner('Saved');
    } finally {
      console.log = original;
    }
    expect(logged).toEqual(['banner: no window yet']);
    expect(t.ops).toContainEqual(['call', t.ofType('HildonWindow')[0], 'window.banner', 'Saved']);
  });
});

describe('useSyncExternalStore', () => {
  function makeStore() {
    let value = 0;
    const listeners = new Set<() => void>();
    return {
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      get: () => value,
      set(v: number) {
        value = v;
        for (const fn of listeners) fn();
      },
      listenerCount: () => listeners.size,
    };
  }

  test('a change outside React renders in a microtask', async () => {
    const t = setup();
    const store = makeStore();
    function App() {
      const n = useSyncExternalStore(store.subscribe, store.get);
      return (
        <hildon-window>
          <gtk-label>{'n=' + n}</gtk-label>
        </hildon-window>
      );
    }
    t.renderer.render(<App />);
    const [label] = t.ofType('GtkLabel');
    expect(t.props(label).label).toBe('n=0');
    store.set(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.props(label).label).toBe('n=1');
    expect(t.errors).toEqual([]);
  });

  test('a change inside a signal handler renders before the handler returns', () => {
    const t = setup();
    const store = makeStore();
    function App() {
      const n = useSyncExternalStore(store.subscribe, store.get);
      return (
        <hildon-window>
          <gtk-vbox>
            <gtk-label>{'n=' + n}</gtk-label>
            <gtk-button onClicked={() => store.set(n + 1)}>+</gtk-button>
          </gtk-vbox>
        </hildon-window>
      );
    }
    t.renderer.render(<App />);
    const [label] = t.ofType('GtkLabel');
    const [button] = t.ofType('GtkButton');
    t.emit(button, 'clicked');
    expect(t.props(label).label).toBe('n=1');
    t.emit(button, 'clicked');
    expect(t.props(label).label).toBe('n=2');
  });

  test('unmount unsubscribes', () => {
    const t = setup();
    const store = makeStore();
    function App() {
      useSyncExternalStore(store.subscribe, store.get);
      return <hildon-window />;
    }
    const root = t.renderer.render(<App />);
    expect(store.listenerCount()).toBe(1);
    root.unmount();
    expect(store.listenerCount()).toBe(0);
  });
});
