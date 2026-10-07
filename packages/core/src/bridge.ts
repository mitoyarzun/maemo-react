/** A GObject handle from maemo:gobject. */
export type Handle = number;

/** The parts of maemo:gobject that the renderer uses. */
export interface Bridge {
  create(type: string): Handle;
  set(h: Handle, prop: string, value: unknown): void;
  get(h: Handle, prop: string): unknown;
  reset(h: Handle, prop: string): void;
  connect(h: Handle, signal: string, fn: (...args: unknown[]) => unknown): number;
  childSet(parent: Handle, child: Handle, prop: string, value: unknown): void;
  call(h: Handle, helper: string, ...args: unknown[]): unknown;
  destroy(h: Handle): void;
}

export type Platform = 'hildon' | 'desktop';

/** The last argument of every event handler, and the value of a ref. */
export interface WidgetTarget {
  readonly handle: Handle;
  /** Read a property of the widget, by its camelCase or GObject name. */
  get(prop: string): unknown;
}
