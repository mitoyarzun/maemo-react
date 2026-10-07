import React, { createContext, useState } from 'react';
import Reconciler from 'react-reconciler';
import {
  ConcurrentRoot,
  DefaultEventPriority,
  DiscreteEventPriority,
  NoEventPriority,
} from 'react-reconciler/constants.js';
import { test, assertEqual, run } from '../harness.js';

const ops = [];
let next = 1;
let priority = NoEventPriority;
const host = {
  supportsMutation: true, supportsPersistence: false, supportsHydration: false,
  supportsMicrotasks: true, supportsResources: false, supportsSingletons: false,
  supportsTestSelectors: false, isPrimaryRenderer: true, noTimeout: -1,
  rendererPackageName: 'react19-smoke', rendererVersion: '0.0.0', extraDevToolsConfig: null,
  scheduleMicrotask: (fn) => Promise.resolve().then(fn),
  scheduleTimeout: (fn, ms) => setTimeout(fn, ms),
  cancelTimeout: (id) => clearTimeout(id),
  getRootHostContext: () => null, getChildHostContext: (c) => c, getPublicInstance: (i) => i,
  prepareForCommit: () => null, resetAfterCommit: () => {}, preparePortalMount: () => {},
  createInstance: (type) => { const h = next++; ops.push(['create', type, h]); return h; },
  createTextInstance: (text) => { const h = next++; ops.push(['text', text, h]); return h; },
  appendInitialChild: (p, c) => ops.push(['append', p, c]),
  appendChild: (p, c) => ops.push(['append', p, c]),
  appendChildToContainer: (p, c) => ops.push(['append', p, c]),
  insertBefore: (p, c, b) => ops.push(['insert', p, c, b]),
  insertInContainerBefore: (p, c, b) => ops.push(['insert', p, c, b]),
  removeChild: (p, c) => ops.push(['remove', p, c]),
  removeChildFromContainer: (p, c) => ops.push(['remove', p, c]),
  finalizeInitialChildren: () => false, commitMount: () => {},
  shouldSetTextContent: () => false,
  commitUpdate: (i, type, prev, nextProps) => ops.push(['update', i, nextProps.label]),
  commitTextUpdate: (i, prev, text) => ops.push(['settext', i, text]),
  resetTextContent: () => {}, clearContainer: () => {},
  hideInstance: () => {}, unhideInstance: () => {}, hideTextInstance: () => {}, unhideTextInstance: () => {},
  detachDeletedInstance: (i) => ops.push(['destroy', i]),
  getInstanceFromNode: () => null, beforeActiveInstanceBlur: () => {}, afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {}, getInstanceFromScope: () => null,
  setCurrentUpdatePriority: (p) => { priority = p; },
  getCurrentUpdatePriority: () => priority,
  resolveUpdatePriority: () => (priority !== NoEventPriority ? priority : DefaultEventPriority),
  trackSchedulerEvent: () => {}, resolveEventType: () => null, resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false, requestPostPaintCallback: () => {},
  maySuspendCommit: () => false, maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false, preloadInstance: () => true,
  startSuspendingCommit: () => {}, suspendInstance: () => {},
  waitForCommitToBeReady: () => null, getSuspendedCommitReason: () => null,
  NotPendingTransition: null, HostTransitionContext: createContext(null),
  resetFormInstance: () => {},
  bindToConsole: (method, args) => Function.prototype.bind.call(console[method], console, ...args),
};

const R = Reconciler(host);
let setN;
function App() {
  const [n, set] = useState(0);
  setN = set;
  return React.createElement('button', { label: 'n' + n }, n < 2 ? 'a' : null);
}
const root = R.createContainer('ROOT', ConcurrentRoot, null, false, null, '',
  (e) => console.error(e), (e) => console.error(e), (e) => console.error(e), () => {});

test('React 19 mounts synchronously', () => {
  R.updateContainerSync(React.createElement(App), root, null, null);
  R.flushSyncWork();
  assertEqual(ops.splice(0), [['text', 'a', 1], ['create', 'button', 2], ['append', 2, 1], ['append', 'ROOT', 2]]);
});

test('a discrete update renders inside flushSyncWork', () => {
  priority = DiscreteEventPriority;
  setN(1);
  priority = NoEventPriority;
  R.flushSyncWork();
  assertEqual(ops.splice(0), [['update', 2, 'n1']]);
});

test('a default update renders after a timer', async () => {
  setN(2);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assertEqual(ops.splice(0), [['remove', 2, 1], ['update', 2, 'n2']]);
});

test('unmount removes and detaches', async () => {
  R.updateContainer(null, root, null, null);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const kinds = ops.splice(0).map((op) => op[0]);
  assertEqual(kinds.includes('remove') && kinds.includes('destroy'), true);
});

run();
