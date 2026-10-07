/// <reference path="./react-reconciler.d.ts" />
import type { ReactNode } from 'react';
import Reconciler from 'react-reconciler';
import { ConcurrentRoot } from 'react-reconciler/constants.js';
import type { Bridge, Handle, Platform } from './bridge.js';
import { createHostConfig, type Container } from './hostConfig.js';

export interface Root {
  render(element: ReactNode): void;
  unmount(): void;
}

export interface Renderer {
  createRoot(): Root;
  /** Make a root and render into it. Returns when the widgets exist. */
  render(element: ReactNode): Root;
  /** Run fn as an event handler: its updates render before flushSync returns. */
  flushSync<T>(fn: () => T): T;
  /** The handle of the newest shown window, or null. */
  windowHandle(): Handle | null;
  /** Show a Hildon banner on the newest window. Without a window, log it. */
  banner(text: string): void;
  /** Mute or unmute the instance of a widget (for tests). */
  muteInstance(h: Handle, muted: boolean): void;
}

export interface RendererOptions {
  /**
   * The user closed a window. Default: nothing.
   * The React tree of the closed window stays mounted, and its handles are
   * released. If this hook keeps the process alive, unmount the root of that
   * window, or the next update fails with "invalid handle". Quit the
   * application to keep the default behaviour safe.
   */
  onWindowClosed?: () => void;
  /** An error that no error boundary caught. Default: console.error. */
  onError?: (error: unknown, componentStack: string) => void;
  /** An uncaught error ended the render. React removes the root. Default: nothing. */
  onFatalError?: () => void;
}

function printError(prefix: string, error: unknown, componentStack: string) {
  console.error(prefix, error, componentStack ? '\n' + componentStack : '');
}

export function createRenderer(bridge: Bridge, platform: Platform, options: RendererOptions = {}): Renderer {
  const onError = options.onError ?? ((e, s) => printError('Uncaught error in a React component:', e, s));
  // eslint-disable-next-line prefer-const
  let reconciler: any;
  const host = createHostConfig(bridge, platform, {
    onWindowClosed: options.onWindowClosed ?? (() => {}),
    flushSync: () => reconciler.flushSyncWork(),
  });
  reconciler = Reconciler(host.config);

  const stackOf = (info?: { componentStack?: string | null }) => info?.componentStack ?? '';
  const onUncaught = (error: unknown, info?: { componentStack?: string | null }) => {
    onError(error, stackOf(info));
    options.onFatalError?.();
  };
  const onCaught = (error: unknown, info?: { componentStack?: string | null }) =>
    printError('Caught error in a React component:', error, stackOf(info));
  const onRecoverable = (error: unknown, info?: { componentStack?: string | null }) =>
    printError('Recoverable error in a React component:', error, stackOf(info));

  function createRoot(): Root {
    const container: Container = { windows: new Set() };
    const fiberRoot = reconciler.createContainer(
      container, ConcurrentRoot, null, false, null, '', onUncaught, onCaught, onRecoverable, () => {},
    );
    return {
      render(element) {
        reconciler.updateContainerSync(element, fiberRoot, null, null);
        reconciler.flushSyncWork();
      },
      unmount() {
        reconciler.updateContainerSync(null, fiberRoot, null, null);
        reconciler.flushSyncWork();
      },
    };
  }

  return {
    createRoot,
    render(element) {
      const root = createRoot();
      root.render(element);
      return root;
    },
    flushSync: (fn) => host.runDiscrete(fn),
    windowHandle: () => host.windowHandle(),
    banner(text) {
      const w = host.windowHandle();
      if (w === null) {
        console.log('banner: ' + text);
        return;
      }
      bridge.call(w, 'window.banner', text);
    },
    muteInstance: (h, muted) => host.muteInstance(h, muted),
  };
}
