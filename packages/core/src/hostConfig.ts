/// <reference path="./react-reconciler.d.ts" />
import { createContext } from 'react';
import { DefaultEventPriority, DiscreteEventPriority, NoEventPriority } from 'react-reconciler/constants.js';
import type { Bridge, Handle, Platform, WidgetTarget } from './bridge.js';
import { CHILD_PROPS, ELEMENTS, RESERVED, SYNC_PROPS, kebab, type ElementDef, type ExtContext } from './elements.js';

type Props = Record<string, unknown>;

/** One widget that React manages. */
export interface Instance {
  handle: Handle;
  type: string;
  def: ElementDef;
  props: Props;
  parent: Instance | null;
  childCount: number;
  signals: Set<string>;
  isText: boolean;
  target: WidgetTarget;
  /** Handles that an element extension made; destroyed with the widget. */
  extra: Handle[];
  /** While true, the event props do not run: a helper changes the widget, or it is destroyed. */
  muted: boolean;
  /** The state of the element extension. */
  ext?: unknown;
  /** For a window: the container that holds it. */
  container?: Container;
}

/** The React root container: it holds the windows. */
export interface Container {
  windows: Set<Instance>;
}

export interface HostHooks {
  /** The user closed a window that React did not remove. */
  onWindowClosed(): void;
  /** Run the synchronous React work now (set by the renderer). */
  flushSync(): void;
}

/** The text of string, number and array children; null if there is an element. */
function textOf(children: unknown): string | null {
  if (children === undefined || children === null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    let out = '';
    for (const c of children) {
      const t = textOf(c);
      if (t === null) return null;
      out += t;
    }
    return out;
  }
  return null;
}

export function createHostConfig(b: Bridge, platform: Platform, hooks: HostHooks) {
  let priority: number = NoEventPriority;
  const destroying = new Set<Handle>();
  const instances = new Map<Handle, Instance>();

  const gtypeOf = (def: ElementDef) => (typeof def.gtype === 'function' ? def.gtype(platform) : def.gtype);
  const makeTarget = (handle: Handle): WidgetTarget => ({ handle, get: (prop) => b.get(handle, kebab(prop)) });

  /** Run fn at discrete priority, then render synchronously, as a click must. */
  function runDiscrete<T>(fn: () => T): T {
    const prev = priority;
    priority = DiscreteEventPriority;
    try {
      return fn();
    } finally {
      priority = prev;
      hooks.flushSync();
    }
  }

  const ext: ExtContext = { bridge: b, platform, run: runDiscrete };

  /** The shown windows, oldest first. The newest one gets the banners. */
  const shown: Instance[] = [];
  const forget = (inst: Instance) => {
    const i = shown.indexOf(inst);
    if (i >= 0) shown.splice(i, 1);
  };
  const windowHandle = (): Handle | null => (shown.length ? shown[shown.length - 1].handle : null);

  function muteInstance(h: Handle, muted: boolean) {
    const inst = instances.get(h);
    if (inst) inst.muted = muted;
  }

  function dispatch(inst: Instance, prop: string, args: unknown[]): unknown {
    const fn = inst.props[prop];
    if (inst.muted || typeof fn !== 'function') return undefined;
    return runDiscrete(() => fn(...args, inst.target));
  }

  function applyText(inst: Instance, prev: Props | null, next: Props) {
    if (inst.def.children !== 'text') return;
    const after = textOf(next.children);
    if (after === null) throw new Error(`<${inst.type}> can contain only text`);
    if (prev && textOf(prev.children) === after) return;
    b.set(inst.handle, inst.def.textProp!, after);
  }

  /** Run fn with the handlers off: GTK can emit a signal during a set that React asked for. */
  function quiet(inst: Instance, fn: () => void) {
    const was = inst.muted;
    inst.muted = true;
    try {
      fn();
    } finally {
      inst.muted = was;
    }
  }

  function applyProps(inst: Instance, prev: Props | null, next: Props) {
    inst.def.ext?.update(ext, inst, prev, next);
    const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
    for (const key of keys) {
      if (RESERVED.has(key) || key in CHILD_PROPS || inst.def.ext?.props.has(key)) continue;
      const value = next[key];
      if (/^on[A-Z]/.test(key)) {
        const signal = kebab(key.slice(2));
        if (typeof value === 'function' && !inst.signals.has(signal)) {
          inst.signals.add(signal);
          b.connect(inst.handle, signal, (...args) => dispatch(inst, key, args));
        }
        continue;
      }
      const prop = kebab(key);
      // A sync prop can differ in GTK although React did not change it: the user changed the widget.
      // Compare with GTK for these props, so a re-render puts the React value back.
      if (!SYNC_PROPS.has(prop) && prev && key in prev && prev[key] === value) continue;
      if (value === undefined) {
        // Reset only a prop that went from a value to undefined, not on each update.
        if (prev && prev[key] !== undefined) quiet(inst, () => b.reset(inst.handle, prop));
        continue;
      }
      if (SYNC_PROPS.has(prop) && b.get(inst.handle, prop) === value) continue;
      quiet(inst, () => b.set(inst.handle, prop, value));
    }
    applyText(inst, prev, next);
  }

  function applyChildProps(child: Instance, prev: Props | null) {
    const parent = child.parent;
    if (!parent || parent.def.children !== 'box') return;
    for (const key of Object.keys(CHILD_PROPS)) {
      const value = child.props[key];
      if (prev && prev[key] === value) continue;
      b.childSet(parent.handle, child.handle, CHILD_PROPS[key].name, value === undefined ? CHILD_PROPS[key].initial : value);
    }
  }

  function attach(parent: Instance, child: Instance, before: Instance | null) {
    const model = parent.def.children;
    if (child.def.windowMenu) {
      if (!parent.def.toplevel) throw new Error(`<${child.type}> must be a child of a window`);
      if (child.parent === parent) return;
      child.parent = parent;
      b.call(parent.handle, 'window.setMenu', child.handle);
      return;
    }
    if (model === 'none' || model === 'text') {
      throw new Error(`<${parent.type}> cannot contain <${child.type}>`);
    }
    // Only a box and a menu have an order to change.
    const reorder = model === 'box' ? 'box.reorder' : model === 'menu' ? 'menu.reorder' : null;
    if (child.parent === parent) {
      if (!reorder) return;
      // React moves a child that is in this container already.
      const from = b.call(parent.handle, 'container.indexOf', child.handle) as number;
      let to = -1;
      if (before) {
        const at = b.call(parent.handle, 'container.indexOf', before.handle) as number;
        to = from < at ? at - 1 : at;
      }
      b.call(parent.handle, reorder, child.handle, to);
      return;
    }
    if ((model === 'single' || model === 'scrolled') && parent.childCount > 0) {
      throw new Error(`<${parent.type}> can contain only one child; put the children in a box`);
    }
    child.parent = parent;
    parent.childCount++;
    b.call(parent.handle, model === 'scrolled' ? 'scrolled.add' : 'container.add', child.handle);
    if (reorder && before) {
      const at = b.call(parent.handle, 'container.indexOf', before.handle) as number;
      b.call(parent.handle, reorder, child.handle, at);
    }
    if (model === 'box') applyChildProps(child, null);
  }

  function detach(parent: Instance, child: Instance) {
    if (child.def.windowMenu) {
      b.call(parent.handle, 'window.setMenu', null);
      child.parent = null;
      return;
    }
    b.call(child.handle, 'widget.removeFromParent');
    child.parent = null;
    parent.childCount--;
    // React does not call detachDeletedInstance for text instances.
    if (child.isText) b.destroy(child.handle);
  }

  function destroyInstance(inst: Instance) {
    inst.muted = true; // a late signal must not run a handler
    if (inst.def.toplevel) forget(inst);
    destroying.add(inst.handle);
    try {
      b.destroy(inst.handle);
    } finally {
      destroying.delete(inst.handle);
      instances.delete(inst.handle);
      // Destroy each extra. One failure must not keep the others alive.
      for (const h of inst.extra) {
        try {
          b.destroy(h);
        } catch (e) {
          // GTK can destroy an extra with its widget; destroy returns with no error then.
          console.error(`maemo-react: cannot destroy the extra handle ${h}`, e);
        }
      }
      inst.extra = [];
    }
  }

  function addWindow(c: Container, win: Instance) {
    if (!win.def.toplevel) {
      throw new Error(`<${win.type}> cannot be at the top level; only a window can`);
    }
    c.windows.add(win);
    win.container = c;
    if (!shown.includes(win)) shown.push(win);
    b.call(win.handle, 'window.registerProgram');
    if (win.props.visible !== false) b.call(win.handle, 'widget.show');
  }

  const config = {
    rendererPackageName: '@maemo-react/core',
    rendererVersion: '0.2.0',
    extraDevToolsConfig: null,
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    supportsMicrotasks: true,
    supportsResources: false,
    supportsSingletons: false,
    supportsTestSelectors: false,
    isPrimaryRenderer: true,
    noTimeout: -1,
    scheduleMicrotask: (fn: () => void) => queueMicrotask(fn),
    scheduleTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    cancelTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),

    getRootHostContext: () => null,
    getChildHostContext: (parent: unknown) => parent,
    getPublicInstance: (inst: Instance) => inst.target,
    prepareForCommit: () => null,
    resetAfterCommit: () => {},
    preparePortalMount: () => {},

    shouldSetTextContent: (type: string) => ELEMENTS[type]?.children === 'text',

    createInstance(type: string, props: Props): Instance {
      const def = ELEMENTS[type];
      if (!def) throw new Error(`unknown element <${type}>; the known elements are ${Object.keys(ELEMENTS).join(', ')}`);
      const handle = b.create(gtypeOf(def));
      const inst: Instance = {
        handle, type, def, props, parent: null, childCount: 0, signals: new Set(), isText: false, extra: [], muted: false, target: makeTarget(handle),
      };
      instances.set(handle, inst);
      def.init?.(b, handle);
      if (def.toplevel) {
        b.connect(handle, 'destroy', () => {
          if (destroying.has(handle)) return;
          forget(inst);
          const c = inst.container;
          if (!c) return;
          c.windows.delete(inst);
          if (c.windows.size === 0) hooks.onWindowClosed();
        });
      }
      try {
        applyProps(inst, null, props);
      } catch (e) {
        // Do not leave a live widget that React does not know. Destroy it, then rethrow.
        destroyInstance(inst);
        throw e;
      }
      if (!def.toplevel && props.visible !== false) b.call(handle, 'widget.show');
      return inst;
    },

    createTextInstance(text: string): Instance {
      const handle = b.create('GtkLabel');
      b.set(handle, 'label', text);
      b.call(handle, 'widget.show');
      return {
        handle, type: '#text', def: ELEMENTS['gtk-label'], props: {}, parent: null, childCount: 0, signals: new Set(), isText: true, extra: [], muted: false, target: makeTarget(handle),
      };
    },

    appendInitialChild: (p: Instance, c: Instance) => attach(p, c, null),
    appendChild: (p: Instance, c: Instance) => attach(p, c, null),
    insertBefore: (p: Instance, c: Instance, before: Instance) => attach(p, c, before),
    removeChild: (p: Instance, c: Instance) => detach(p, c),
    appendChildToContainer: (c: Container, win: Instance) => addWindow(c, win),
    insertInContainerBefore: (c: Container, win: Instance) => addWindow(c, win),
    removeChildFromContainer(c: Container, win: Instance) {
      c.windows.delete(win);
      destroyInstance(win);
    },

    finalizeInitialChildren: () => false,
    commitMount: () => {},
    commitUpdate(inst: Instance, _type: string, prev: Props, next: Props) {
      inst.props = next;
      applyProps(inst, prev, next);
      applyChildProps(inst, prev);
    },
    commitTextUpdate: (inst: Instance, _prev: string, next: string) => b.set(inst.handle, 'label', next),
    resetTextContent: () => {},
    clearContainer: () => {},
    hideInstance: (inst: Instance) => b.call(inst.handle, 'widget.hide'),
    unhideInstance: (inst: Instance) => b.call(inst.handle, 'widget.show'),
    hideTextInstance: (inst: Instance) => b.call(inst.handle, 'widget.hide'),
    unhideTextInstance: (inst: Instance) => b.call(inst.handle, 'widget.show'),
    detachDeletedInstance: (inst: Instance) => destroyInstance(inst),

    getInstanceFromNode: () => null,
    beforeActiveInstanceBlur: () => {},
    afterActiveInstanceBlur: () => {},
    prepareScopeUpdate: () => {},
    getInstanceFromScope: () => null,

    setCurrentUpdatePriority: (p: number) => {
      priority = p;
    },
    getCurrentUpdatePriority: () => priority,
    resolveUpdatePriority: () => (priority !== NoEventPriority ? priority : DefaultEventPriority),
    trackSchedulerEvent: () => {},
    resolveEventType: () => null,
    resolveEventTimeStamp: () => -1.1,
    shouldAttemptEagerTransition: () => false,
    requestPostPaintCallback: () => {},
    maySuspendCommit: () => false,
    maySuspendCommitOnUpdate: () => false,
    maySuspendCommitInSyncRender: () => false,
    preloadInstance: () => true,
    startSuspendingCommit: () => {},
    suspendInstance: () => {},
    waitForCommitToBeReady: () => null,
    getSuspendedCommitReason: () => null,
    NotPendingTransition: null,
    HostTransitionContext: createContext(null),
    resetFormInstance: () => {},
    // React 0.34 reads the ViewTransition hooks on each transition and retry
    // commit. maemo-react has no view transitions, so they do nothing.
    startViewTransition: (
      _state: unknown, _container: unknown, _types: unknown,
      mutation: () => void, layout: () => void, _afterMutation: unknown, spawned: () => void,
    ) => {
      mutation();
      layout();
      spawned();
      return null;
    },
    suspendOnActiveViewTransition: () => {},
    applyViewTransitionName: () => {},
    restoreViewTransitionName: () => {},
    cancelViewTransitionName: () => {},
    cancelRootViewTransitionName: () => {},
    restoreRootViewTransitionName: () => {},
    cloneRootViewTransitionContainer: () => null,
    removeRootViewTransitionClone: () => {},
    measureInstance: () => null,
    measureClonedInstance: () => null,
    wasInstanceInViewport: () => false,
    hasInstanceChanged: () => false,
    hasInstanceAffectedParent: () => false,
    startGestureTransition: () => null,
    stopViewTransition: () => {},
    addViewTransitionFinishedListener: () => {},
    getCurrentGestureOffset: () => 0,
    createViewTransitionInstance: () => null,
    bindToConsole: (method: 'log' | 'warn' | 'error', args: unknown[]) =>
      Function.prototype.bind.call(console[method], console, ...args),
  };

  return { config, runDiscrete, windowHandle, muteInstance };
}
