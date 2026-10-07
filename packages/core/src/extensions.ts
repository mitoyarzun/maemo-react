// The props of a scale and of a combo box that are not GObject properties.
import type { ElementExt, ExtContext, ExtInstance } from './elements.js';

type Props = Record<string, unknown>;

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);

/** min, max, step, value and onChangeValue of a GtkHScale or a GtkVScale. */
export const RANGE_EXT: ElementExt = {
  props: new Set(['min', 'max', 'step', 'value', 'onChangeValue']),
  update(ctx: ExtContext, inst: ExtInstance, prev: Props | null, next: Props) {
    const b = ctx.bridge;
    const h = inst.handle;
    const min = num(next.min, 0);
    const max = num(next.max, 100);
    const step = num(next.step, 1);
    if (!prev) {
      // GTK changes the value when the user releases the slider, not during
      // the drag (the HA Remote spec, section 4). A key press also changes it.
      b.set(h, 'update-policy', 'discontinuous');
      b.connect(h, 'value-changed', () => {
        const fn = inst.props.onChangeValue;
        if (inst.muted || typeof fn !== 'function') return;
        ctx.run(() => fn(b.call(h, 'range.getValue'), inst.target));
      });
    }
    const rangeChanged = !prev || num(prev.min, 0) !== min || num(prev.max, 100) !== max;
    const stepChanged = !prev || num(prev.step, 1) !== step;
    const value = typeof next.value === 'number' && Number.isFinite(next.value) ? Math.min(max, Math.max(min, next.value)) : null;
    const was = inst.muted;
    inst.muted = true; // GTK clamps the value in setRange, and emits value-changed; the user did not do that
    try {
      if (rangeChanged) b.call(h, 'range.setRange', min, max);
      if (stepChanged) b.call(h, 'range.setIncrements', step, step * 10);
      if (value !== null && b.call(h, 'range.getValue') !== value) b.call(h, 'range.setValue', value);
    } finally {
      inst.muted = was;
    }
  },
};

const sameItems = (a: unknown, b: readonly string[]) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

/** items of a GtkComboBox: the text rows of its model. */
export const COMBO_EXT: ElementExt = {
  props: new Set(['items']),
  update(ctx: ExtContext, inst: ExtInstance, prev: Props | null, next: Props) {
    const b = ctx.bridge;
    const items = (next.items ?? []) as readonly string[];
    if (prev && sameItems(prev.items ?? [], items)) return;
    const was = inst.muted;
    inst.muted = true; // new rows reset the active row; that is not a user change
    try {
      b.call(inst.handle, 'comboBox.setItems', items);
      // Apply active again now: the generic loop sees no change in the prop.
      if (typeof next.active === 'number') b.set(inst.handle, 'active', next.active);
    } finally {
      inst.muted = was;
    }
  },
};

/**
 * onTopmostChange of a window: true when the window is on top. Hildon has
 * the is-topmost property (notify::is-topmost); a GtkWindow on the desktop
 * host has is-active instead. The handler does not run at mount.
 */
export const WINDOW_EXT: ElementExt = {
  props: new Set(['onTopmostChange']),
  update(ctx: ExtContext, inst: ExtInstance, prev: Props | null, next: Props) {
    if (typeof next.onTopmostChange !== 'function' || inst.ext === 'topmost') return;
    inst.ext = 'topmost'; // connected once; the handler reads the newest prop at each change
    const b = ctx.bridge;
    const h = inst.handle;
    const prop = ctx.platform === 'hildon' ? 'is-topmost' : 'is-active';
    b.connect(h, 'notify::' + prop, () => {
      const fn = inst.props.onTopmostChange;
      if (inst.muted || typeof fn !== 'function') return;
      ctx.run(() => fn(b.get(h, prop) === true, inst.target));
    });
  },
};
