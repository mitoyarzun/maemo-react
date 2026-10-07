# maemo-react M2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give maemo-react the components that HA Remote needs: `List` on `GtkTreeView` with minimal store updates, `Scale`, `ComboBox`, `ToggleButton`, `CheckButton`, the Hildon window `Menu` and `banner()`, a `useSyncExternalStore` check, the updated types, a benchmark of `List`, and a demo application.

**Architecture:** The bridge stays generic. Small C helpers in `helpers.c` cover the GTK calls that take varargs or `GtkTreeIter` structs (`listStore.*`, `treeView.*`, `column.*`, `range.*`, `comboBox.*`, `menu.*`, `window.*`). The renderer gets one small mechanism, an element extension: a table of props that are not GObject properties and a function that applies them with the helpers. `List`, `Scale` and `ComboBox` are extensions. The widgets package adds friendly components over the new elements. The rest of M2 (`TextView`, `Image`, `ProgressBar`, `Toolbar`, `Note`, `FileChooser`, the `style` prop, the error screen, `dev`, the test socket) is M2b and is not in this plan.

**Tech Stack:** C99, QuickJS 2025-09-13, GLib 2.12, GTK 2.10, Hildon 2.0.6, React 19.3.0, react-reconciler 0.34.0, TypeScript 5.9.3, esbuild 0.28.2, Vitest 5.0.3, Docker (the `maemo-react-dev` image), qemu-user, the Diablo emulator, a Nokia N810.

**Spec:** `maemo-react/docs/specs/2026-10-06-maemo-react-design.md` (sections 4, 5, 6, 8, 11, 13, 14 and appendix A) and `maemo-react/docs/specs/2026-10-06-ha-remote-design.md` (sections 2, 4 and 6). Read both before you start. This plan implements the first half of milestone M2 (spec section 13).

Run the commands in `maemo-react/` unless the command says otherwise. The `git` paths start at the repository root (`n810-modern/`). `docs/plans/2026-10-06-maemo-react-m0-m1.md` is the plan of M0 and M1; its tasks show the same conventions.

## Global Constraints

- The runtime is C99 only (spec section 2).
- Diablo binaries must need no glibc symbol newer than `GLIBC_2.5`, and must have the ABI tag `2.6.8`. `runtime/check-glibc.sh` checks both.
- Use only APIs that exist in GLib 2.12, GTK 2.10 and Hildon 2.0. Do not use `g_timeout_add_seconds` (2.14), `g_strcmp0` (2.16), `gtk_widget_get_window` (2.14), `gtk_list_store_set_valuesv` (2.12), `GtkComboBoxText` (2.24), `gtk_menu_item_set_label` (2.16) or `gtk_scale_add_mark` (2.16). Every GTK and Hildon function in this plan was checked in the headers of `/work/sysroot-diablo` on 2026-10-06, except where a step says to check it.
- The install prefix is `/opt/n810-modern`. The runtime binary is `/opt/n810-modern/bin/maemo-react-host`.
- Packages use gzip compression. Diablo's dpkg 1.14 cannot read xz or zstd.
- React 19.3.0 with `react-reconciler` 0.34.0, in mutation mode. `@maemo-react/core` keeps its single definition table of elements (spec section 5), and `typegen/emit.mjs` keeps an equal table; the test `typegen and core list the same elements` checks that.
- `<List data columns>` drives a `GtkTreeView` with a `GtkListStore` and takes no React children (spec section 5). A change of one row in 200 must make one store update for each changed cell, not 200.
- A `Scale` sends its value when the user releases the slider, not during the drag (HA spec section 4).
- The runtime version becomes `0.2.0`. An application made by the CLI depends on `maemo-react-runtime (>= 0.2.0)`, because the new core needs the new helpers.
- Take time measurements on the tablet only. The emulator is about 10 times faster than the N810 (spec appendix A). Record the governor and the clock with each result (spec section 11).
- Run one QEMU system emulator at a time. Boot the emulator with `VNC_PASSWORD=n810` when you use `tools/emulator-gui-build.sh`; `devhost/emulator-run.sh` boots without VNC and needs no password.
- Write all English prose, code comments and commit messages in ASD-STE100 Simplified Technical English. Commit messages follow the repository style: an imperative summary line, for example `Add the List helpers to maemo:gobject`. No `feat:` prefixes, no attribution lines.

## Review Focus

These five conditions are implied by the specs but no task's main tests exercise them. Each one has a test in the task that owns the code:

1. **Two rows with the same key in `List` data.** Expected: a clear error that names the key, not a store with a wrong row count. Test: Task 5, `list.test.tsx` "errors: no columns, a duplicate key".
2. **The selected row goes away from `data`** (HA: an entity is removed on the server). Expected: `onSelect(null)` once, after the commit, with no React state change inside the commit. Tests: Task 5, `list.test.tsx` "the selected row goes away"; Task 8, `react-widgets.jsx` "a handler that removes the selected row".
3. **A toggle whose handler removes that row.** Expected: no error, the store shrinks by one. Test: Task 5, `list.test.tsx` "a toggle handler that removes the row".
4. **A `Scale` value outside `min`..`max`** (HA: a brightness of 150 % from a bad state). Expected: GTK clamps it, no error. Tests: Task 3, `widgets.test.js` "range helpers"; Task 6, `extensions.test.tsx` "a value out of the range".
5. **`ComboBox` items change while a row is active** (HA: `hvac_modes` arrive after the first render). Expected: the `active` prop stays applied, and `onChanged` does not fire with `-1`. Test: Task 6, `extensions.test.tsx` "new items keep active".

## File Structure

```
maemo-react/
  runtime/src/convert.c            MODIFY: interface-typed properties hold objects
  runtime/src/bridge.c             MODIFY: mr_handle_for; destroy a GtkMenu with gtk_widget_destroy
  runtime/src/mr.h                 MODIFY: MR_VERSION 0.2.0, mr_handle_for
  runtime/src/main.c               MODIFY: the --compile stack size
  runtime/src/helpers.c            MODIFY: list, tree view, column, range, combo, menu, window helpers
  runtime/test/bridge-props.test.js MODIFY: an interface property
  runtime/test/list.test.js        CREATE: the list store and tree view helpers
  runtime/test/widgets.test.js     CREATE: the range, combo, menu and banner helpers
  runtime/test/bundles/react-widgets.jsx CREATE: React with every M2a component on the real bridge
  typegen/typegen.c                MODIFY: an interface with a GObject prerequisite is an object
  typegen/run.sh                   MODIFY: the menu classes; remove the temporary file on failure
  typegen/emit.mjs                 MODIFY: the nine new elements; the extension props
  typegen/test/emit.test.mjs       MODIFY
  packages/types/generated/gtk.json, intrinsics.d.ts  REGENERATE
  packages/types/test/check.tsx    MODIFY: the new components
  packages/core/src/elements.ts    MODIFY: ElementExt, the 'menu' model, nine elements
  packages/core/src/hostConfig.ts  MODIFY: extensions, muted, extra handles, the window menu, the newest window
  packages/core/src/list.ts        CREATE: the List extension
  packages/core/src/extensions.ts  CREATE: the Scale and ComboBox extensions
  packages/core/src/renderer.ts    MODIFY: banner
  packages/core/src/index.ts       MODIFY: banner
  packages/core/test/fakeBridge.ts MODIFY: the new helpers
  packages/core/test/renderer.test.tsx MODIFY: the window menu, banner, useSyncExternalStore
  packages/core/test/list.test.tsx CREATE
  packages/core/test/extensions.test.tsx CREATE
  packages/widgets/src/index.tsx   MODIFY: List, Scale, ComboBox, ToggleButton, CheckButton, Menu, MenuItem, MenuSeparator
  packages/widgets/test/widgets.test.tsx MODIFY
  packages/cli/src/app.ts          MODIFY: the runtime dependency
  packages/cli/test/cli.test.ts    MODIFY: the runtime dependency
  examples/bench/src/App.tsx       MODIFY: the tree modes
  examples/widgets/                CREATE: the demo of every M2a component
  package.json                     MODIFY: typecheck the widgets example
  docs/benchmarks.md               MODIFY: the M2a results, the 165 MHz run, two corrections
  README.md                        MODIFY: the runtime version, the widgets example
```

---

### Task 1: Interface-typed properties, handles for GTK-made objects, and the runtime version

**Files:**
- Modify: `maemo-react/runtime/src/convert.c`
- Modify: `maemo-react/typegen/typegen.c:32-47` (`kind_of`)
- Modify: `maemo-react/runtime/src/bridge.c:45-51` (after `add_handle`) and `:188-205` (`js_destroy`)
- Modify: `maemo-react/runtime/src/mr.h:8` and `:58-65`
- Modify: `maemo-react/runtime/src/main.c:41-53` (`compile_files`)
- Modify: `maemo-react/packages/cli/src/app.ts:8`, `maemo-react/packages/cli/test/cli.test.ts:118`
- Test: `maemo-react/runtime/test/bridge-props.test.js`

**Interfaces:**
- Consumes: `mr_js_to_gvalue`, `mr_gvalue_to_js` (convert.c), `add_handle` and `release` (bridge.c).
- Produces:
  - `set(h, 'model', storeHandle)` and `get(h, 'model')` work for a property whose type is an interface with `GObject` as a prerequisite, for example `GtkTreeModel`. typegen reports such a property with `kind: "object"`.
  - `int32_t mr_handle_for(GObject *obj)` (mr.h): the handle of `obj`; a new handle with a new reference when it has none. Task 2 uses it for the `GtkTreeSelection`.
  - `destroy(h)` of a `GtkMenu` calls `gtk_widget_destroy`, so the menu and its popup window are freed. Task 4 relies on it.
  - `MR_VERSION` is `"0.2.0"`. `runtime/build.sh diablo deb` makes `runtime/dist/maemo-react-runtime_0.2.0_armel.deb`.

The deferred findings T6 "interface-typed properties cannot be converted" and T5 "--compile keeps the 256 KB default stack" (`docs/m1-deferred-findings.md`) close here.

- [ ] **Step 1: Write the failing test**

Add to `maemo-react/runtime/test/bridge-props.test.js`, before `await run();`:

```js
test('an interface property takes a handle of an object that implements it', () => {
  const view = create('GtkTreeView');
  const store = create('GtkListStore');
  const label = create('GtkLabel');
  set(view, 'model', store);
  assertEqual(get(view, 'model'), store);
  assertThrows(() => set(view, 'model', label), /GtkTreeView.model: expected a GtkTreeModel, got a GtkLabel/);
  set(view, 'model', null);
  assertEqual(get(view, 'model'), null);
  destroy(view);
  destroy(store);
  destroy(label);
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/test/run.sh desktop test/bridge-props.test.js'
```

Expected: `FAIL test/bridge-props.test.js` with `TypeError: GtkTreeView.model: maemo:gobject cannot convert values of type GtkTreeModel`.

- [ ] **Step 3: Convert interface-typed values as objects**

In `maemo-react/runtime/src/convert.c`, add after `number_range` (before `to_number`):

```c
/* The fundamental type that decides the conversion. An interface with GObject
   as a prerequisite, for example GtkTreeModel, holds an object. */
static GType convert_kind(GType t)
{
    if (G_TYPE_IS_INTERFACE(t) && g_type_is_a(t, G_TYPE_OBJECT))
        return G_TYPE_OBJECT;
    return G_TYPE_FUNDAMENTAL(t);
}
```

In `mr_js_to_gvalue`, change `switch (G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(out))) {` to `switch (convert_kind(G_VALUE_TYPE(out))) {`. In `mr_gvalue_to_js`, change `switch (G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(v))) {` to `switch (convert_kind(G_VALUE_TYPE(v))) {`. The `G_TYPE_OBJECT` cases already check `g_type_is_a(G_OBJECT_TYPE(obj), G_VALUE_TYPE(out))`, and that check is true for an object that implements the interface.

In `maemo-react/typegen/typegen.c`, add at the start of `kind_of`, before `if (t == GDK_TYPE_COLOR)`:

```c
    if (G_TYPE_IS_INTERFACE(t) && g_type_is_a(t, G_TYPE_OBJECT))
        return "object"; /* an interface with GObject as a prerequisite, for example GtkTreeModel */
```

- [ ] **Step 4: Add mr_handle_for, destroy menus, and raise the --compile stack**

In `maemo-react/runtime/src/bridge.c`, add after `add_handle`:

```c
/* The handle of obj; a new one, with a new reference, when it has none. For
   objects that GTK made itself, for example a GtkTreeSelection. */
int32_t mr_handle_for(GObject *obj)
{
    int32_t h = mr_handle_of(obj);
    if (h)
        return h;
    g_object_ref(obj);
    return add_handle(obj);
}
```

In `js_destroy`, change:

```c
    if (GTK_IS_WIDGET(o) && GTK_WIDGET_TOPLEVEL(GTK_WIDGET(o)))
        gtk_widget_destroy(GTK_WIDGET(o));
```

to:

```c
    /* A GtkMenu lives in its own popup window, which holds a reference to it.
       Only gtk_widget_destroy frees both. */
    if (GTK_IS_WIDGET(o) && (GTK_WIDGET_TOPLEVEL(GTK_WIDGET(o)) || GTK_IS_MENU(o)))
        gtk_widget_destroy(GTK_WIDGET(o));
```

In `maemo-react/runtime/src/mr.h`, change `#define MR_VERSION "0.1.0"` to `#define MR_VERSION "0.2.0"`, and add after `int mr_bridge_handle_count(void);`:

```c
int32_t mr_handle_for(GObject *obj);
```

In `maemo-react/runtime/src/main.c`, in `compile_files`, add after `JS_SetStripInfo(mr_rt, JS_STRIP_SOURCE);`:

```c
    JS_SetMaxStackSize(mr_rt, 1024 * 1024); /* the same as a normal run; a large bundle needs it */
```

In `maemo-react/packages/cli/src/app.ts`, change line 8 to:

```ts
export const RUNTIME_DEPENDS = 'maemo-react-runtime (>= 0.2.0)';
```

In `maemo-react/packages/cli/test/cli.test.ts:118`, change `(>= 0.1.0)` to `(>= 0.2.0)`.

- [ ] **Step 5: Run the tests on both targets**

```bash
npm test
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: every Vitest file passes; every runtime line is `PASS` on both targets, including `test/bridge-props.test.js`. `check-glibc.sh` prints no error for the Diablo binary.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/runtime/src/convert.c maemo-react/runtime/src/bridge.c maemo-react/runtime/src/mr.h maemo-react/runtime/src/main.c maemo-react/typegen/typegen.c maemo-react/runtime/test/bridge-props.test.js maemo-react/packages/cli/src/app.ts maemo-react/packages/cli/test/cli.test.ts
git commit -m "Convert interface-typed properties, add mr_handle_for, and make the runtime 0.2.0"
```

---

### Task 2: The list store and tree view helpers

**Files:**
- Modify: `maemo-react/runtime/src/helpers.c` (new helper functions, and the `helpers[]` table at the end)
- Create: `maemo-react/runtime/test/list.test.js`

**Interfaces:**
- Consumes: `mr_js_to_gvalue`, `mr_gvalue_to_js`, `mr_arg_object`, `mr_handle_for` (Task 1).
- Produces these `call(h, name, ...)` helpers. A row index is 0-based. Each helper throws a `TypeError` for a wrong argument type and a `RangeError` for a row or column that does not exist.
  - On a `GtkListStore`: `listStore.setColumnTypes(kinds: Array<'string' | 'boolean' | 'number'>)` (once, before the first row); `listStore.insert(index, values: unknown[])` (`index` past the end or `-1` appends); `listStore.set(index, column, value)`; `listStore.get(index, column)`; `listStore.remove(index)`; `listStore.move(from, to)` (the row at `from` ends at index `to`); `listStore.clear()`; `listStore.length(): number`.
  - On a `GtkTreeView`: `treeView.appendColumn(column): number`; `treeView.selection(): Handle` (the same handle each time); `treeView.selectedIndex(): number` (`-1` for none); `treeView.selectIndex(index)` (`-1` unselects); `treeView.renderer(column): Handle` (the first cell renderer of column `column`).
  - On a `GtkTreeViewColumn`: `column.pack(renderer)`; `column.addAttribute(renderer, property, storeColumn)`.

- [ ] **Step 1: Write the failing test**

Create `maemo-react/runtime/test/list.test.js`:

```js
import { test, assertEqual, assertThrows, run } from './harness.js';
import { create, set, get, call, connect, destroy } from 'maemo:gobject';
import { stats } from 'maemo:debug';

function newStore() {
  const s = create('GtkListStore');
  call(s, 'listStore.setColumnTypes', ['string', 'boolean', 'number']);
  return s;
}

const names = (s) => {
  const out = [];
  for (let i = 0; i < call(s, 'listStore.length'); i++) out.push(call(s, 'listStore.get', i, 0));
  return out;
};

test('insert, get, set and length', () => {
  const s = newStore();
  call(s, 'listStore.insert', 0, ['a', true, 1.5]);
  call(s, 'listStore.insert', 1, ['b', false, 2]);
  call(s, 'listStore.insert', 0, ['first', false, 0]);
  assertEqual(call(s, 'listStore.length'), 3);
  assertEqual(names(s), ['first', 'a', 'b']);
  assertEqual([call(s, 'listStore.get', 1, 1), call(s, 'listStore.get', 1, 2)], [true, 1.5]);
  call(s, 'listStore.set', 1, 0, 'A');
  call(s, 'listStore.set', 1, 1, false);
  assertEqual([call(s, 'listStore.get', 1, 0), call(s, 'listStore.get', 1, 1)], ['A', false]);
  destroy(s);
});

test('UTF-8 text in a cell', () => {
  const s = newStore();
  call(s, 'listStore.insert', -1, ['Lámpara del salón €', false, 0]);
  assertEqual(call(s, 'listStore.get', 0, 0), 'Lámpara del salón €');
  destroy(s);
});

test('an index past the end and -1 append', () => {
  const s = newStore();
  call(s, 'listStore.insert', 99, ['x', false, 0]);
  call(s, 'listStore.insert', -1, ['y', false, 0]);
  assertEqual(names(s), ['x', 'y']);
  destroy(s);
});

test('remove, move and clear', () => {
  const s = newStore();
  for (const k of ['a', 'b', 'c', 'd']) call(s, 'listStore.insert', -1, [k, false, 0]);
  call(s, 'listStore.move', 3, 0);
  assertEqual(names(s), ['d', 'a', 'b', 'c']);
  call(s, 'listStore.move', 0, 3);
  assertEqual(names(s), ['a', 'b', 'c', 'd']);
  call(s, 'listStore.move', 1, 2);
  assertEqual(names(s), ['a', 'c', 'b', 'd']);
  call(s, 'listStore.move', 2, 2);
  assertEqual(names(s), ['a', 'c', 'b', 'd']);
  call(s, 'listStore.remove', 1);
  assertEqual(names(s), ['a', 'b', 'd']);
  call(s, 'listStore.clear');
  assertEqual(call(s, 'listStore.length'), 0);
  destroy(s);
});

test('errors: column types, row counts, rows and columns', () => {
  const s = newStore();
  assertThrows(() => call(s, 'listStore.insert', 0, ['a', true]), /has 2 values, the store has 3 columns/);
  assertThrows(() => call(s, 'listStore.insert', 0, ['a', 'yes', 0]), /listStore.insert: expected a boolean/);
  call(s, 'listStore.insert', 0, ['a', true, 0]);
  assertThrows(() => call(s, 'listStore.set', 5, 0, 'x'), /RangeError: listStore.set: no row 5/);
  assertThrows(() => call(s, 'listStore.set', 0, 7, 'x'), /RangeError: listStore.set: no column 7/);
  assertThrows(() => call(s, 'listStore.remove', 1), /no row 1/);
  assertThrows(() => call(s, 'listStore.move', 0, 4), /no row 4/);
  assertEqual(call(s, 'listStore.length'), 1);
  const bad = create('GtkListStore');
  assertThrows(() => call(bad, 'listStore.setColumnTypes', ['date']), /column 0 is not 'string', 'boolean' or 'number'/);
  assertThrows(() => call(bad, 'listStore.setColumnTypes', []), /at least one column/);
  destroy(s);
  destroy(bad);
});

test('a tree view shows a store through columns and reports the selection', () => {
  const before = stats().handles;
  const s = newStore();
  const view = create('GtkTreeView');
  set(view, 'model', s);
  const col = create('GtkTreeViewColumn');
  const text = create('GtkCellRendererText');
  const toggle = create('GtkCellRendererToggle');
  call(col, 'column.pack', text);
  call(col, 'column.addAttribute', text, 'text', 0);
  call(col, 'column.pack', toggle);
  call(col, 'column.addAttribute', toggle, 'active', 1);
  assertEqual(call(view, 'treeView.appendColumn', col), 1);
  assertEqual(call(view, 'treeView.renderer', 0), text);
  for (const k of ['a', 'b', 'c']) call(s, 'listStore.insert', -1, [k, k === 'b', 0]);
  const sel = call(view, 'treeView.selection');
  assertEqual(call(view, 'treeView.selection'), sel);
  let changes = 0;
  connect(sel, 'changed', () => { changes++; });
  assertEqual(call(view, 'treeView.selectedIndex'), -1);
  call(view, 'treeView.selectIndex', 2);
  assertEqual(call(view, 'treeView.selectedIndex'), 2);
  assertEqual(changes, 1);
  call(s, 'listStore.remove', 2); // the selected row goes away
  assertEqual(call(view, 'treeView.selectedIndex'), -1);
  call(view, 'treeView.selectIndex', 0);
  call(view, 'treeView.selectIndex', -1);
  assertEqual(call(view, 'treeView.selectedIndex'), -1);
  assertThrows(() => call(view, 'treeView.selectIndex', 9), /no row 9/);
  assertThrows(() => call(view, 'treeView.renderer', 3), /no column 3/);
  destroy(view);
  for (const h of [col, text, toggle, sel, s]) destroy(h);
  assertEqual(stats().handles, before);
});

test('a toggle renderer emits toggled with the row path', () => {
  const r = create('GtkCellRendererToggle');
  set(r, 'activatable', true);
  let got;
  connect(r, 'toggled', (path) => { got = path; });
  call(r, 'object.emit', 'toggled', '12');
  assertEqual(got, '12');
  destroy(r);
});

test('the helpers check the type of the object and of the arguments', () => {
  const l = create('GtkLabel');
  const view = create('GtkTreeView');
  const col = create('GtkTreeViewColumn');
  assertThrows(() => call(l, 'listStore.length'), /helper 'listStore.length' needs a GtkListStore, got a GtkLabel/);
  assertThrows(() => call(view, 'treeView.appendColumn', l), /expected a GtkTreeViewColumn, got a GtkLabel/);
  assertThrows(() => call(col, 'column.pack', l), /expected a cell renderer, got a GtkLabel/);
  assertThrows(() => call(col, 'column.addAttribute', l), /expected a cell renderer/);
  assertThrows(() => call(view, 'treeView.selectIndex', 'x'), /argument 1 must be a number/);
  destroy(l);
  destroy(view);
  destroy(col);
});

await run();
```

- [ ] **Step 2: Run the test to see it fail**

```bash
devhost/run.sh 'runtime/test/run.sh desktop test/list.test.js'
```

Expected: `FAIL test/list.test.js` with `maemo:gobject has no helper 'listStore.setColumnTypes'`.

- [ ] **Step 3: Write the helpers**

In `maemo-react/runtime/src/helpers.c`, add `#include <stdio.h>` after `#include <string.h>`. Add these functions after `h_register_program` and before `h_object_emit`:

```c
/* Read argument i as an integer. */
static int arg_int(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper, int32_t *out)
{
    if (i >= argc || !JS_IsNumber(argv[i]) || JS_ToInt32(ctx, out, argv[i])) {
        JS_ThrowTypeError(ctx, "%s: argument %d must be a number", helper, i + 1);
        return -1;
    }
    return 0;
}

/* Read argument i as a double. */
static int arg_double(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper, double *out)
{
    if (i >= argc || !JS_IsNumber(argv[i]) || JS_ToFloat64(ctx, out, argv[i])) {
        JS_ThrowTypeError(ctx, "%s: argument %d must be a number", helper, i + 1);
        return -1;
    }
    return 0;
}

/* The length of the array in argument i; -1 and a TypeError if it is not an array. */
static int arg_array_length(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper, uint32_t *len)
{
    JSValue lenv;
    if (i >= argc || !JS_IsArray(ctx, argv[i])) {
        JS_ThrowTypeError(ctx, "%s: argument %d must be an array", helper, i + 1);
        return -1;
    }
    lenv = JS_GetPropertyStr(ctx, argv[i], "length");
    JS_ToUint32(ctx, len, lenv);
    JS_FreeValue(ctx, lenv);
    return 0;
}

static GtkCellRenderer *arg_renderer(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper)
{
    GObject *r;
    if (i >= argc) {
        JS_ThrowTypeError(ctx, "%s: missing argument %d", helper, i + 1);
        return NULL;
    }
    if (!(r = mr_arg_object(ctx, argv[i])))
        return NULL;
    if (!GTK_IS_CELL_RENDERER(r)) {
        JS_ThrowTypeError(ctx, "%s: expected a cell renderer, got a %s", helper, G_OBJECT_TYPE_NAME(r));
        return NULL;
    }
    return GTK_CELL_RENDERER(r);
}

/* The iter of row index; a RangeError when there is no such row. */
static int row_iter(JSContext *ctx, GtkTreeModel *model, int32_t index, GtkTreeIter *iter, const char *helper)
{
    if (index < 0 || !gtk_tree_model_iter_nth_child(model, iter, NULL, index)) {
        JS_ThrowRangeError(ctx, "%s: no row %d", helper, (int)index);
        return -1;
    }
    return 0;
}

/* Initialise out with the type of store column col and convert v into it. */
static int cell_value(JSContext *ctx, GtkTreeModel *model, int32_t col, JSValueConst v, GValue *out, const char *helper)
{
    if (col < 0 || col >= gtk_tree_model_get_n_columns(model)) {
        JS_ThrowRangeError(ctx, "%s: no column %d", helper, (int)col);
        return -1;
    }
    g_value_init(out, gtk_tree_model_get_column_type(model, col));
    return mr_js_to_gvalue(ctx, v, out, NULL, helper);
}

static JSValue h_list_store_set_column_types(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    uint32_t n, i;
    GType *types;
    int bad = 0;
    if (arg_array_length(ctx, argc, argv, 0, "listStore.setColumnTypes", &n))
        return JS_EXCEPTION;
    if (n == 0)
        return JS_ThrowTypeError(ctx, "listStore.setColumnTypes: give at least one column");
    types = g_new0(GType, n);
    for (i = 0; i < n && !bad; i++) {
        JSValue item = JS_GetPropertyUint32(ctx, argv[0], i);
        const char *s = JS_IsString(item) ? JS_ToCString(ctx, item) : NULL;
        if (s && !strcmp(s, "string"))
            types[i] = G_TYPE_STRING;
        else if (s && !strcmp(s, "boolean"))
            types[i] = G_TYPE_BOOLEAN;
        else if (s && !strcmp(s, "number"))
            types[i] = G_TYPE_DOUBLE;
        else {
            JS_ThrowTypeError(ctx, "listStore.setColumnTypes: column %u is not 'string', 'boolean' or 'number'", i);
            bad = 1;
        }
        if (s)
            JS_FreeCString(ctx, s);
        JS_FreeValue(ctx, item);
    }
    if (!bad)
        gtk_list_store_set_column_types(GTK_LIST_STORE(o), n, types);
    g_free(types);
    return bad ? JS_EXCEPTION : JS_UNDEFINED;
}

static JSValue h_list_store_insert(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model = GTK_TREE_MODEL(o);
    gint n = gtk_tree_model_get_n_columns(model), i;
    int32_t index;
    uint32_t len;
    gint *columns;
    GValue *values;
    GtkTreeIter iter;
    int bad = 0;
    if (arg_int(ctx, argc, argv, 0, "listStore.insert", &index))
        return JS_EXCEPTION;
    if (arg_array_length(ctx, argc, argv, 1, "listStore.insert", &len))
        return JS_EXCEPTION;
    if ((gint)len != n)
        return JS_ThrowTypeError(ctx, "listStore.insert: the row has %u values, the store has %d columns", len, n);
    columns = g_new(gint, n);
    values = g_new0(GValue, n);
    for (i = 0; i < n && !bad; i++) {
        JSValue item = JS_GetPropertyUint32(ctx, argv[1], i);
        columns[i] = i;
        bad = cell_value(ctx, model, i, item, &values[i], "listStore.insert") < 0;
        JS_FreeValue(ctx, item);
    }
    if (!bad) /* one row-inserted signal for the whole row */
        gtk_list_store_insert_with_valuesv(GTK_LIST_STORE(o), &iter, index < 0 ? G_MAXINT : index, columns, values, n);
    for (i = 0; i < n; i++)
        if (G_IS_VALUE(&values[i]))
            g_value_unset(&values[i]);
    g_free(values);
    g_free(columns);
    return bad ? JS_EXCEPTION : JS_UNDEFINED;
}

static JSValue h_list_store_set(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model = GTK_TREE_MODEL(o);
    int32_t index, col;
    GtkTreeIter iter;
    GValue v = { 0 };
    if (arg_int(ctx, argc, argv, 0, "listStore.set", &index) || arg_int(ctx, argc, argv, 1, "listStore.set", &col))
        return JS_EXCEPTION;
    if (argc < 3)
        return JS_ThrowTypeError(ctx, "listStore.set: give the value");
    if (row_iter(ctx, model, index, &iter, "listStore.set"))
        return JS_EXCEPTION;
    if (cell_value(ctx, model, col, argv[2], &v, "listStore.set") < 0) {
        if (G_IS_VALUE(&v))
            g_value_unset(&v);
        return JS_EXCEPTION;
    }
    gtk_list_store_set_value(GTK_LIST_STORE(o), &iter, col, &v);
    g_value_unset(&v);
    return JS_UNDEFINED;
}

static JSValue h_list_store_get(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model = GTK_TREE_MODEL(o);
    int32_t index, col;
    GtkTreeIter iter;
    GValue v = { 0 };
    JSValue r;
    if (arg_int(ctx, argc, argv, 0, "listStore.get", &index) || arg_int(ctx, argc, argv, 1, "listStore.get", &col))
        return JS_EXCEPTION;
    if (row_iter(ctx, model, index, &iter, "listStore.get"))
        return JS_EXCEPTION;
    if (col < 0 || col >= gtk_tree_model_get_n_columns(model))
        return JS_ThrowRangeError(ctx, "listStore.get: no column %d", (int)col);
    gtk_tree_model_get_value(model, &iter, col, &v);
    r = mr_gvalue_to_js(ctx, &v, 1);
    g_value_unset(&v);
    return r;
}

static JSValue h_list_store_remove(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    int32_t index;
    GtkTreeIter iter;
    if (arg_int(ctx, argc, argv, 0, "listStore.remove", &index))
        return JS_EXCEPTION;
    if (row_iter(ctx, GTK_TREE_MODEL(o), index, &iter, "listStore.remove"))
        return JS_EXCEPTION;
    gtk_list_store_remove(GTK_LIST_STORE(o), &iter);
    return JS_UNDEFINED;
}

static JSValue h_list_store_move(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model = GTK_TREE_MODEL(o);
    int32_t from, to;
    GtkTreeIter a, b;
    if (arg_int(ctx, argc, argv, 0, "listStore.move", &from) || arg_int(ctx, argc, argv, 1, "listStore.move", &to))
        return JS_EXCEPTION;
    if (row_iter(ctx, model, from, &a, "listStore.move") || row_iter(ctx, model, to, &b, "listStore.move"))
        return JS_EXCEPTION;
    /* After the move, the row from 'from' is at index 'to'. */
    if (from > to)
        gtk_list_store_move_before(GTK_LIST_STORE(o), &a, &b);
    else if (from < to)
        gtk_list_store_move_after(GTK_LIST_STORE(o), &a, &b);
    return JS_UNDEFINED;
}

static JSValue h_list_store_clear(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gtk_list_store_clear(GTK_LIST_STORE(o));
    return JS_UNDEFINED;
}

static JSValue h_list_store_length(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    return JS_NewInt32(ctx, gtk_tree_model_iter_n_children(GTK_TREE_MODEL(o), NULL));
}

static JSValue h_tree_view_append_column(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GObject *col;
    if (argc < 1 || !(col = mr_arg_object(ctx, argv[0])))
        return JS_EXCEPTION;
    if (!GTK_IS_TREE_VIEW_COLUMN(col))
        return JS_ThrowTypeError(ctx, "treeView.appendColumn: expected a GtkTreeViewColumn, got a %s", G_OBJECT_TYPE_NAME(col));
    return JS_NewInt32(ctx, gtk_tree_view_append_column(GTK_TREE_VIEW(o), GTK_TREE_VIEW_COLUMN(col)));
}

static JSValue h_tree_view_selection(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    return JS_NewInt32(ctx, mr_handle_for(G_OBJECT(gtk_tree_view_get_selection(GTK_TREE_VIEW(o)))));
}

static JSValue h_tree_view_selected_index(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model;
    GtkTreeIter iter;
    GtkTreePath *path;
    gint i;
    if (!gtk_tree_selection_get_selected(gtk_tree_view_get_selection(GTK_TREE_VIEW(o)), &model, &iter))
        return JS_NewInt32(ctx, -1);
    path = gtk_tree_model_get_path(model, &iter);
    i = gtk_tree_path_get_indices(path)[0];
    gtk_tree_path_free(path);
    return JS_NewInt32(ctx, i);
}

static JSValue h_tree_view_select_index(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeSelection *sel = gtk_tree_view_get_selection(GTK_TREE_VIEW(o));
    GtkTreeModel *model = gtk_tree_view_get_model(GTK_TREE_VIEW(o));
    GtkTreeIter iter;
    int32_t index;
    if (arg_int(ctx, argc, argv, 0, "treeView.selectIndex", &index))
        return JS_EXCEPTION;
    if (index < 0 || !model) {
        gtk_tree_selection_unselect_all(sel);
        return JS_UNDEFINED;
    }
    if (row_iter(ctx, model, index, &iter, "treeView.selectIndex"))
        return JS_EXCEPTION;
    gtk_tree_selection_select_iter(sel, &iter);
    return JS_UNDEFINED;
}

static JSValue h_tree_view_renderer(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    int32_t index;
    GtkTreeViewColumn *col;
    GList *cells;
    int32_t h;
    if (arg_int(ctx, argc, argv, 0, "treeView.renderer", &index))
        return JS_EXCEPTION;
    col = index < 0 ? NULL : gtk_tree_view_get_column(GTK_TREE_VIEW(o), index);
    if (!col)
        return JS_ThrowRangeError(ctx, "treeView.renderer: no column %d", (int)index);
    cells = gtk_tree_view_column_get_cell_renderers(col);
    if (!cells)
        return JS_ThrowRangeError(ctx, "treeView.renderer: column %d has no renderer", (int)index);
    h = mr_handle_for(G_OBJECT(cells->data));
    g_list_free(cells);
    return JS_NewInt32(ctx, h);
}

static JSValue h_column_pack(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkCellRenderer *r = arg_renderer(ctx, argc, argv, 0, "column.pack");
    if (!r)
        return JS_EXCEPTION;
    gtk_tree_view_column_pack_start(GTK_TREE_VIEW_COLUMN(o), r, TRUE);
    return JS_UNDEFINED;
}

static JSValue h_column_add_attribute(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkCellRenderer *r = arg_renderer(ctx, argc, argv, 0, "column.addAttribute");
    const char *attr;
    int32_t col;
    if (!r)
        return JS_EXCEPTION;
    if (argc < 2 || !JS_IsString(argv[1]))
        return JS_ThrowTypeError(ctx, "column.addAttribute: argument 2 must be the property name");
    if (arg_int(ctx, argc, argv, 2, "column.addAttribute", &col))
        return JS_EXCEPTION;
    attr = JS_ToCString(ctx, argv[1]);
    gtk_tree_view_column_add_attribute(GTK_TREE_VIEW_COLUMN(o), r, attr, col);
    JS_FreeCString(ctx, attr);
    return JS_UNDEFINED;
}
```

Add these rows to the `helpers[]` table, after the `"window.registerProgram"` row. `listStore.remove`, `listStore.clear` and `treeView.selectIndex` can emit the selection `changed` signal, so they are marked `emits` and are not counted as GTK time:

```c
    { "listStore.setColumnTypes", gtk_list_store_get_type, h_list_store_set_column_types, FALSE },
    { "listStore.insert", gtk_list_store_get_type, h_list_store_insert, FALSE },
    { "listStore.set", gtk_list_store_get_type, h_list_store_set, FALSE },
    { "listStore.get", gtk_list_store_get_type, h_list_store_get, FALSE },
    { "listStore.remove", gtk_list_store_get_type, h_list_store_remove, TRUE },
    { "listStore.move", gtk_list_store_get_type, h_list_store_move, FALSE },
    { "listStore.clear", gtk_list_store_get_type, h_list_store_clear, TRUE },
    { "listStore.length", gtk_list_store_get_type, h_list_store_length, FALSE },
    { "treeView.appendColumn", gtk_tree_view_get_type, h_tree_view_append_column, FALSE },
    { "treeView.selection", gtk_tree_view_get_type, h_tree_view_selection, FALSE },
    { "treeView.selectedIndex", gtk_tree_view_get_type, h_tree_view_selected_index, FALSE },
    { "treeView.selectIndex", gtk_tree_view_get_type, h_tree_view_select_index, TRUE },
    { "treeView.renderer", gtk_tree_view_get_type, h_tree_view_renderer, FALSE },
    { "column.pack", gtk_tree_view_column_get_type, h_column_pack, FALSE },
    { "column.addAttribute", gtk_tree_view_column_get_type, h_column_add_attribute, FALSE },
```

- [ ] **Step 4: Check two GTK functions in the Diablo headers**

`gtk_tree_view_get_column` and `gtk_tree_view_column_get_cell_renderers` were not checked on 2026-10-06. Run:

```bash
devhost/run.sh 'grep -n "gtk_tree_view_get_column \|gtk_tree_view_get_column(\|gtk_tree_view_column_get_cell_renderers" /work/sysroot-diablo/usr/include/gtk-2.0/gtk/gtktreeview.h /work/sysroot-diablo/usr/include/gtk-2.0/gtk/gtktreeviewcolumn.h'
```

Expected: one line for each function. If `gtk_tree_view_column_get_cell_renderers` is missing, replace its use in `h_tree_view_renderer` with `gtk_cell_layout_get_cells(GTK_CELL_LAYOUT(col))` and check that function in `gtkcelllayout.h` instead.

- [ ] **Step 5: Run the tests on both targets**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: every line is `PASS` on both targets, including `test/list.test.js`. A GTK critical warning is fatal in tests, so a `PASS` also means that no helper called GTK with a bad argument.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/runtime/src/helpers.c maemo-react/runtime/test/list.test.js
git commit -m "Add the list store and tree view helpers to maemo:gobject"
```

---

### Task 3: The range, combo box, menu and window helpers

**Files:**
- Modify: `maemo-react/runtime/src/helpers.c`
- Create: `maemo-react/runtime/test/widgets.test.js`

**Interfaces:**
- Consumes: `arg_int`, `arg_double`, `arg_array_length`, `arg_widget` (Task 2).
- Produces these helpers:
  - On a `GtkRange` (`GtkHScale`, `GtkVScale`): `range.setRange(min, max)` (`RangeError` unless `min < max`); `range.setIncrements(step, page)`; `range.setValue(value)` (GTK clamps it); `range.getValue(): number`.
  - On a `GtkComboBox`: `comboBox.setItems(items: string[])` replaces the text rows, as `gtk_combo_box_new_text` plus `gtk_combo_box_append_text` do; it resets `active` to `-1`. `comboBox.activeText(): string | null`.
  - On a `GtkMenu`: `menu.reorder(child, position)` (`-1` moves the child to the end).
  - On a `GtkWindow`: `window.setMenu(menu | null)`: on a `HildonWindow` it is `hildon_window_set_menu`; on any other window the menu pops up on a right click in the window (the desktop dev host has no Hildon menu key). `window.banner(text)`: `hildon_banner_show_information` on Hildon; on the desktop it prints `banner: <text>` to stderr (spec section 9).

- [ ] **Step 1: Write the failing test**

Create `maemo-react/runtime/test/widgets.test.js`:

```js
import { test, assertEqual, assertThrows, run } from './harness.js';
import { create, set, get, call, connect, destroy } from 'maemo:gobject';
import { stats } from 'maemo:debug';
import { platform } from 'maemo:app';

const WINDOW = platform === 'hildon' ? 'HildonWindow' : 'GtkWindow';

test('range helpers: setRange, setIncrements, setValue and getValue', () => {
  const s = create('GtkHScale');
  call(s, 'range.setRange', 0, 100);
  call(s, 'range.setIncrements', 5, 50);
  let n = 0;
  connect(s, 'value-changed', () => { n++; });
  call(s, 'range.setValue', 40);
  assertEqual(call(s, 'range.getValue'), 40);
  assertEqual(n, 1);
  call(s, 'range.setValue', 150); // out of the range: GTK clamps it
  assertEqual(call(s, 'range.getValue'), 100);
  call(s, 'range.setValue', -3);
  assertEqual(call(s, 'range.getValue'), 0);
  assertThrows(() => call(s, 'range.setRange', 10, 10), /RangeError: range.setRange: min must be less than max/);
  assertThrows(() => call(s, 'range.setValue', 'x'), /argument 1 must be a number/);
  destroy(s);
});

test('a discontinuous range reports the value once, when the slider is released', () => {
  // The Scale element uses this policy: the value changes on the release, not
  // during the drag (the HA Remote spec, section 4). The property must exist.
  const s = create('GtkVScale');
  set(s, 'update-policy', 'discontinuous');
  assertEqual(get(s, 'update-policy'), 'discontinuous');
  destroy(s);
});

test('comboBox.setItems fills a text combo box', () => {
  const c = create('GtkComboBox');
  call(c, 'comboBox.setItems', ['heat', 'cool', 'off']);
  assertEqual(get(c, 'active'), -1);
  assertEqual(call(c, 'comboBox.activeText'), null);
  set(c, 'active', 1);
  assertEqual(call(c, 'comboBox.activeText'), 'cool');
  let changes = 0;
  connect(c, 'changed', () => { changes++; });
  call(c, 'comboBox.setItems', ['auto']);
  assertEqual(get(c, 'active'), -1);
  assertEqual(changes >= 1, true);
  set(c, 'active', 0);
  assertEqual(call(c, 'comboBox.activeText'), 'auto');
  assertThrows(() => call(c, 'comboBox.setItems', [1]), /item 0 is not a string/);
  assertThrows(() => call(c, 'comboBox.setItems', 'x'), /argument 1 must be an array/);
  destroy(c);
});

test('a window menu: items, order, set, replace and remove', () => {
  const before = stats().handles;
  const w = create(WINDOW);
  const m = create('GtkMenu');
  const a = create('GtkMenuItem');
  const b = create('GtkMenuItem');
  const label = create('GtkLabel');
  set(label, 'label', 'Reconnect');
  call(a, 'container.add', label);
  call(m, 'container.add', a);
  call(m, 'container.add', b);
  assertEqual([call(m, 'container.indexOf', a), call(m, 'container.indexOf', b)], [0, 1]);
  call(m, 'menu.reorder', b, 0);
  assertEqual(call(m, 'container.indexOf', b), 0);
  call(m, 'menu.reorder', b, -1);
  assertEqual(call(m, 'container.indexOf', b), 1);
  let fired = 0;
  connect(a, 'activate', () => { fired++; });
  call(a, 'object.emit', 'activate');
  assertEqual(fired, 1);
  call(w, 'window.setMenu', m);
  call(w, 'window.setMenu', null);
  call(w, 'window.setMenu', m);
  assertThrows(() => call(w, 'window.setMenu', a), /expected a GtkMenu, got a GtkMenuItem/);
  assertThrows(() => call(a, 'menu.reorder', b, 0), /needs a GtkMenu, got a GtkMenuItem/);
  call(b, 'widget.removeFromParent');
  destroy(b);
  call(w, 'window.setMenu', null);
  destroy(m); // frees the menu, its items and its popup window
  destroy(w);
  assertEqual(stats().handles, before);
});

test('window.banner shows a banner on Hildon and prints on the desktop', () => {
  const w = create(WINDOW);
  call(w, 'window.registerProgram');
  call(w, 'widget.show');
  call(w, 'window.banner', 'Saved');
  assertThrows(() => call(w, 'window.banner', 5), /window.banner: give the text/);
  destroy(w);
});

await run();
```

- [ ] **Step 2: Run the test to see it fail**

```bash
devhost/run.sh 'runtime/test/run.sh desktop test/widgets.test.js'
```

Expected: `FAIL test/widgets.test.js` with `maemo:gobject has no helper 'range.setRange'`.

- [ ] **Step 3: Write the helpers**

In `maemo-react/runtime/src/helpers.c`, change the Hildon includes at the top to:

```c
#ifdef MR_HILDON
#include <hildon/hildon-banner.h>
#include <hildon/hildon-program.h>
#include <hildon/hildon-window.h>
#endif
```

Add these functions after `h_column_add_attribute` (Task 2) and before `h_object_emit`:

```c
static JSValue h_range_set_range(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    double lo, hi;
    if (arg_double(ctx, argc, argv, 0, "range.setRange", &lo) || arg_double(ctx, argc, argv, 1, "range.setRange", &hi))
        return JS_EXCEPTION;
    if (!(lo < hi)) /* gtk_range_set_range prints a critical warning otherwise */
        return JS_ThrowRangeError(ctx, "range.setRange: min must be less than max");
    gtk_range_set_range(GTK_RANGE(o), lo, hi);
    return JS_UNDEFINED;
}

static JSValue h_range_set_increments(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    double step, page;
    if (arg_double(ctx, argc, argv, 0, "range.setIncrements", &step) || arg_double(ctx, argc, argv, 1, "range.setIncrements", &page))
        return JS_EXCEPTION;
    gtk_range_set_increments(GTK_RANGE(o), step, page);
    return JS_UNDEFINED;
}

static JSValue h_range_set_value(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    double v;
    if (arg_double(ctx, argc, argv, 0, "range.setValue", &v))
        return JS_EXCEPTION;
    gtk_range_set_value(GTK_RANGE(o), v); /* clamps to the range */
    return JS_UNDEFINED;
}

static JSValue h_range_get_value(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    return JS_NewFloat64(ctx, gtk_range_get_value(GTK_RANGE(o)));
}

static JSValue h_combo_set_items(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkComboBox *combo = GTK_COMBO_BOX(o);
    GtkTreeModel *model = gtk_combo_box_get_model(combo);
    uint32_t n, i;
    int bad = 0;
    if (arg_array_length(ctx, argc, argv, 0, "comboBox.setItems", &n))
        return JS_EXCEPTION;
    if (!model || !GTK_IS_LIST_STORE(model) || gtk_tree_model_get_n_columns(model) != 1
        || gtk_tree_model_get_column_type(model, 0) != G_TYPE_STRING) {
        /* What gtk_combo_box_new_text does. g_object_new made this combo box
           without a model, and GTK 2.10 has no GtkComboBoxText. */
        GtkListStore *store = gtk_list_store_new(1, G_TYPE_STRING);
        GtkCellRenderer *cell = gtk_cell_renderer_text_new();
        gtk_combo_box_set_model(combo, GTK_TREE_MODEL(store));
        g_object_unref(store);
        gtk_cell_layout_clear(GTK_CELL_LAYOUT(combo));
        gtk_cell_layout_pack_start(GTK_CELL_LAYOUT(combo), cell, TRUE);
        gtk_cell_layout_add_attribute(GTK_CELL_LAYOUT(combo), cell, "text", 0);
    } else {
        gtk_list_store_clear(GTK_LIST_STORE(model));
    }
    for (i = 0; i < n && !bad; i++) {
        JSValue item = JS_GetPropertyUint32(ctx, argv[0], i);
        const char *s = JS_IsString(item) ? JS_ToCString(ctx, item) : NULL;
        if (s)
            gtk_combo_box_append_text(combo, s);
        else {
            JS_ThrowTypeError(ctx, "comboBox.setItems: item %u is not a string", i);
            bad = 1;
        }
        if (s)
            JS_FreeCString(ctx, s);
        JS_FreeValue(ctx, item);
    }
    return bad ? JS_EXCEPTION : JS_UNDEFINED;
}

static JSValue h_combo_active_text(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gchar *s = gtk_combo_box_get_active_text(GTK_COMBO_BOX(o));
    JSValue r = s ? JS_NewString(ctx, s) : JS_NULL;
    g_free(s);
    return r;
}

static JSValue h_menu_reorder(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "menu.reorder");
    int32_t pos;
    if (!child)
        return JS_EXCEPTION;
    if (arg_int(ctx, argc, argv, 1, "menu.reorder", &pos))
        return JS_EXCEPTION;
    gtk_menu_reorder_child(GTK_MENU(o), child, pos); /* a negative position appends */
    return JS_UNDEFINED;
}

/* The desktop dev host has no Hildon menu key: the window menu pops up on a
   right click in the window. */
static gboolean popup_window_menu(GtkWidget *w, GdkEventButton *ev, gpointer data)
{
    GtkWidget *menu = g_object_get_data(G_OBJECT(w), "mr-menu");
    if (!menu || ev->button != 3)
        return FALSE;
    gtk_menu_popup(GTK_MENU(menu), NULL, NULL, NULL, NULL, ev->button, ev->time);
    return TRUE;
}

static JSValue h_window_set_menu(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *menu = NULL;
    if (argc >= 1 && !JS_IsNull(argv[0]) && !JS_IsUndefined(argv[0])) {
        if (!(menu = arg_widget(ctx, argc, argv, 0, "window.setMenu")))
            return JS_EXCEPTION;
        if (!GTK_IS_MENU(menu))
            return JS_ThrowTypeError(ctx, "window.setMenu: expected a GtkMenu, got a %s", G_OBJECT_TYPE_NAME(menu));
    }
#ifdef MR_HILDON
    if (HILDON_IS_WINDOW(o)) {
        hildon_window_set_menu(HILDON_WINDOW(o), menu ? GTK_MENU(menu) : NULL);
        return JS_UNDEFINED;
    }
#endif
    if (!g_object_get_data(o, "mr-menu-press")) {
        gtk_widget_add_events(GTK_WIDGET(o), GDK_BUTTON_PRESS_MASK);
        g_signal_connect(o, "button-press-event", G_CALLBACK(popup_window_menu), NULL);
        g_object_set_data(o, "mr-menu-press", GINT_TO_POINTER(1));
    }
    g_object_set_data(o, "mr-menu", menu);
    return JS_UNDEFINED;
}

static JSValue h_window_banner(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    const char *text;
    if (argc < 1 || !JS_IsString(argv[0]))
        return JS_ThrowTypeError(ctx, "window.banner: give the text");
    text = JS_ToCString(ctx, argv[0]);
#ifdef MR_HILDON
    hildon_banner_show_information(GTK_WIDGET(o), NULL, text);
#else
    fprintf(stderr, "banner: %s\n", text);
#endif
    JS_FreeCString(ctx, text);
    return JS_UNDEFINED;
}
```

Add these rows to the `helpers[]` table, after the `"column.addAttribute"` row:

```c
    { "range.setRange", gtk_range_get_type, h_range_set_range, TRUE },
    { "range.setIncrements", gtk_range_get_type, h_range_set_increments, FALSE },
    { "range.setValue", gtk_range_get_type, h_range_set_value, TRUE },
    { "range.getValue", gtk_range_get_type, h_range_get_value, FALSE },
    { "comboBox.setItems", gtk_combo_box_get_type, h_combo_set_items, TRUE },
    { "comboBox.activeText", gtk_combo_box_get_type, h_combo_active_text, FALSE },
    { "menu.reorder", gtk_menu_get_type, h_menu_reorder, FALSE },
    { "window.setMenu", gtk_window_get_type, h_window_set_menu, FALSE },
    { "window.banner", gtk_window_get_type, h_window_banner, FALSE },
```

- [ ] **Step 4: Run the tests on both targets**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo 2>&1 | tee /tmp/diablo-tests.log; grep -n "attach_to_widget\|not attached" /tmp/diablo-tests.log || echo NO-MENU-WARNING'
```

Expected: every line is `PASS` on both targets, including `test/widgets.test.js`, and the last line is `NO-MENU-WARNING`. Two checks that this plan could not make from the headers:

- If the Diablo run prints `gtk_menu_attach_to_widget(): menu already attached`, then `hildon_window_set_menu(window, NULL)` does not detach the old menu. Fix: in `h_window_set_menu`, in the `HILDON_IS_WINDOW` branch, add before the Hildon call: `GtkWidget *old = hildon_window_get_menu(HILDON_WINDOW(o)); if (old && old != menu) gtk_menu_detach(GTK_MENU(old));`.
- If the Diablo run fails in `window.banner` with a crash or a critical warning from `hildon_banner_show_information` (a banner needs an X display, which Xvfb gives, but not hildon-desktop), change the test to skip the banner on `platform === 'hildon'` under qemu-user, and keep the check for the emulator (Task 9) and the tablet (Task 10).

- [ ] **Step 5: Commit**

```bash
git add maemo-react/runtime/src/helpers.c maemo-react/runtime/test/widgets.test.js
git commit -m "Add the range, combo box, menu and window helpers to maemo:gobject"
```

---

### Task 4: Element extensions, the window menu, and the nine new elements with their types

**Files:**
- Modify: `maemo-react/packages/core/src/elements.ts`
- Modify: `maemo-react/packages/core/src/hostConfig.ts`
- Modify: `maemo-react/packages/core/test/fakeBridge.ts`
- Modify: `maemo-react/packages/core/test/renderer.test.tsx`
- Modify: `maemo-react/typegen/run.sh`, `maemo-react/typegen/emit.mjs`, `maemo-react/typegen/test/emit.test.mjs`
- Regenerate: `maemo-react/packages/types/generated/gtk.json`, `maemo-react/packages/types/generated/intrinsics.d.ts`
- Modify: `maemo-react/packages/types/test/check.tsx`

**Interfaces:**
- Consumes: `window.setMenu`, `menu.reorder`, `window.banner` (Task 3); typegen with the interface fix (Task 1).
- Produces:
  - `ElementDef.ext?: ElementExt` (elements.ts). An extension has `props: ReadonlySet<string>` and `update(ctx: ExtContext, inst: ExtInstance, prev: Props | null, next: Props)`. The renderer calls `update` once after create (`prev` is `null`) and before the GObject properties of each update. The renderer skips the extension's props in the generic loop. `ExtInstance` has `handle`, `props`, `target`, `extra: Handle[]` (handles destroyed with the widget), `muted: boolean` (while true, event props do not run) and `ext?: unknown` (the state). `ExtContext` has `bridge` and `run<T>(fn): T` (discrete priority plus a synchronous render). Tasks 5 and 6 write extensions.
  - `ElementDef.windowMenu?: true` and the child model `'menu'`. A `gtk-menu` under a window is attached with `window.setMenu`; its items are ordered with `menu.reorder`.
  - `createHostConfig` returns `{ config, runDiscrete, windowHandle }`; `windowHandle()` is the handle of the newest shown window, or `null`. Task 6 uses it for `banner`.
  - The elements `gtk-toggle-button`, `gtk-check-button`, `gtk-hscale`, `gtk-vscale`, `gtk-combo-box`, `gtk-tree-view`, `gtk-menu`, `gtk-menu-item`, `gtk-separator-menu-item`, in `ELEMENTS` of both core and typegen, with their JSX types. `intrinsics.d.ts` also exports `ListRow`, `ListColumn`, `ListElementProps`, `RangeElementProps` and `ComboElementProps`.

The deferred finding T12 "run.sh leaves gtk.json.tmp" closes here. T12 "no automated ELEMENTS check" was closed by commit `6ad8381` (the test `typegen and core list the same elements`). T6 "mr_type_from_name breaks for acronym types" does not bite: `GtkHScale` becomes `gtk_hscale_get_type`, because the rule puts an underscore only after a lower-case letter; `GtkVScale`, `GtkComboBox`, `GtkListStore`, `GtkCellRendererToggle`, `GtkTreeViewColumn` and `GtkSeparatorMenuItem` follow the same rule.

- [ ] **Step 1: Write the failing renderer tests**

Add to `maemo-react/packages/core/test/renderer.test.tsx`, at the end of the file:

```tsx
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
});
```

The fake gets `menuOf(h)`, `muteOf(h, muted)` and the renderer test setup gets `windowHandle()` in Step 3.

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run packages/core/test/renderer.test.tsx
```

Expected: the new tests fail with `unknown element <gtk-menu>` and `t.menuOf is not a function`.

- [ ] **Step 3: Write the element table, the host config, and the fake**

Replace `maemo-react/packages/core/src/elements.ts` with:

```ts
import type { Bridge, Handle, Platform, WidgetTarget } from './bridge.js';

/** How an element takes children. */
export type ChildModel = 'none' | 'text' | 'single' | 'box' | 'scrolled' | 'menu';

type Props = Record<string, unknown>;

/** The parts of an instance that an element extension may use. */
export interface ExtInstance {
  handle: Handle;
  props: Props;
  target: WidgetTarget;
  /** Handles that the extension made. The renderer destroys them with the widget. */
  extra: Handle[];
  /** While true, the event props do not run: a helper changes the widget, or it is destroyed. */
  muted: boolean;
  /** The state of the extension. */
  ext?: unknown;
}

export interface ExtContext {
  bridge: Bridge;
  /** Run an event handler at discrete priority, and render its updates before it returns. */
  run<T>(fn: () => T): T;
}

/** Props that are not GObject properties: the extension applies them with helpers. */
export interface ElementExt {
  props: ReadonlySet<string>;
  /** Runs once after create (prev is null), and before the GObject properties of each update. */
  update(ctx: ExtContext, inst: ExtInstance, prev: Props | null, next: Props): void;
}

export interface ElementDef {
  /** The GType to create, or a function of the platform. */
  gtype: string | ((platform: Platform) => string);
  children: ChildModel;
  /** For the 'text' model: the property that gets the text. */
  textProp?: string;
  /** A top-level window. */
  toplevel?: boolean;
  /** The menu of a window: attached with window.setMenu, not added as a child. */
  windowMenu?: boolean;
  /** Runs once, after create. */
  init?: (b: Bridge, h: Handle) => void;
  ext?: ElementExt;
}

/** The intrinsic elements of maemo-react, by JSX name. Keep it equal to typegen/emit.mjs. */
export const ELEMENTS: Record<string, ElementDef> = {
  'hildon-window': {
    gtype: (p) => (p === 'hildon' ? 'HildonWindow' : 'GtkWindow'),
    children: 'single',
    toplevel: true,
  },
  'gtk-vbox': { gtype: 'GtkVBox', children: 'box' },
  'gtk-hbox': { gtype: 'GtkHBox', children: 'box' },
  'gtk-label': { gtype: 'GtkLabel', children: 'text', textProp: 'label' },
  'gtk-button': { gtype: 'GtkButton', children: 'text', textProp: 'label' },
  'gtk-toggle-button': { gtype: 'GtkToggleButton', children: 'text', textProp: 'label' },
  'gtk-check-button': { gtype: 'GtkCheckButton', children: 'text', textProp: 'label' },
  'gtk-entry': { gtype: 'GtkEntry', children: 'none' },
  'gtk-hscale': { gtype: 'GtkHScale', children: 'none' },
  'gtk-vscale': { gtype: 'GtkVScale', children: 'none' },
  'gtk-combo-box': { gtype: 'GtkComboBox', children: 'none' },
  'gtk-tree-view': { gtype: 'GtkTreeView', children: 'none' },
  'gtk-scrolled-window': {
    gtype: 'GtkScrolledWindow',
    children: 'scrolled',
    init: (b, h) => {
      b.set(h, 'hscrollbar-policy', 'automatic');
      b.set(h, 'vscrollbar-policy', 'automatic');
    },
  },
  'gtk-menu': { gtype: 'GtkMenu', children: 'menu', windowMenu: true },
  'gtk-menu-item': { gtype: 'GtkMenuItem', children: 'single' },
  'gtk-separator-menu-item': { gtype: 'GtkSeparatorMenuItem', children: 'none' },
};

/** "hscrollbarPolicy" -> "hscrollbar-policy"; "DeleteEvent" -> "delete-event". */
export function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (m: string, i: number) => (i ? '-' : '') + m.toLowerCase());
}

/** Properties that GTK also changes (the user types). Set them only when the value differs. */
export const SYNC_PROPS = new Set(['text', 'value', 'active']);

/** Props that become child properties when the parent is a box, with their first values. */
export const CHILD_PROPS: Record<string, { name: string; initial: unknown }> = {
  expand: { name: 'expand', initial: false },
  fill: { name: 'fill', initial: true },
  padding: { name: 'padding', initial: 0 },
  packType: { name: 'pack-type', initial: 'start' },
};

/** Props that the renderer uses itself; they are not GObject properties. */
export const RESERVED = new Set(['children', 'key', 'ref']);
```

In `maemo-react/packages/core/src/hostConfig.ts`, make these changes. The import line of elements becomes:

```ts
import { CHILD_PROPS, ELEMENTS, RESERVED, SYNC_PROPS, kebab, type ElementDef, type ExtContext } from './elements.js';
```

Add to `interface Instance`, after `target: WidgetTarget;`:

```ts
  /** Handles that an element extension made; destroyed with the widget. */
  extra: Handle[];
  /** While true, the event props do not run: a helper changes the widget, or it is destroyed. */
  muted: boolean;
  /** The state of the element extension. */
  ext?: unknown;
```

In `createHostConfig`, add after the `runDiscrete` function:

```ts
  const ext: ExtContext = { bridge: b, run: runDiscrete };

  /** The shown windows, oldest first. The newest one gets the banners. */
  const shown: Instance[] = [];
  const forget = (inst: Instance) => {
    const i = shown.indexOf(inst);
    if (i >= 0) shown.splice(i, 1);
  };
  const windowHandle = (): Handle | null => (shown.length ? shown[shown.length - 1].handle : null);
```

Change `dispatch` to:

```ts
  function dispatch(inst: Instance, prop: string, args: unknown[]): unknown {
    const fn = inst.props[prop];
    if (inst.muted || typeof fn !== 'function') return undefined;
    return runDiscrete(() => fn(...args, inst.target));
  }
```

In `applyProps`, add as the first line `inst.def.ext?.update(ext, inst, prev, next);`, and change the skip line to:

```ts
      if (RESERVED.has(key) || key in CHILD_PROPS || inst.def.ext?.props.has(key)) continue;
```

Replace `attach` and `detach` with:

```ts
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
```

Replace `destroyInstance` with:

```ts
  function destroyInstance(inst: Instance) {
    inst.muted = true; // a late signal must not run a handler
    if (inst.def.toplevel) forget(inst);
    destroying.add(inst.handle);
    try {
      b.destroy(inst.handle);
    } finally {
      destroying.delete(inst.handle);
    }
    for (const h of inst.extra) b.destroy(h);
    inst.extra = [];
  }
```

In `addWindow`, add `shown.push(win);` after `win.container = c;`. Add `extra: [], muted: false,` after `isText: false,` in the `inst` literal of `createInstance`, and after `isText: true,` in the object that `createTextInstance` returns. In the `'destroy'` handler of a toplevel in `createInstance`, add `forget(inst);` as the first line after `if (destroying.has(handle)) return;`. The last line of `createHostConfig` becomes `return { config, runDiscrete, windowHandle, muteInstance };`, with `muteInstance` from the end of this step.

In `maemo-react/packages/core/test/fakeBridge.ts`, add to `interface FakeObject`:

```ts
  /** For a window: the menu from window.setMenu. */
  menu: Handle | null;
```

In `create`, add `menu: null` to the new object. In the `call` switch, change `case 'box.reorder': {` to two labels:

```ts
        case 'box.reorder':
        case 'menu.reorder': {
```

and add before `default:`:

```ts
        case 'window.setMenu':
          o.menu = (args[0] as Handle | null) ?? null;
          return undefined;
        case 'window.banner':
          return undefined;
```

Add to the returned object, after `isDestroyed`:

```ts
    menuOf: (h: Handle) => obj(h).menu,
  };
```

In `maemo-react/packages/core/test/renderer.test.tsx`, change `setup` so the host config is reachable: replace its body with:

```ts
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
```

For that, `createRenderer` exposes two test hooks. In `maemo-react/packages/core/src/renderer.ts`, add to `interface Renderer`:

```ts
  /** The handle of the newest shown window, or null. */
  windowHandle(): Handle | null;
  /** Mute or unmute the instance of a widget (for tests). */
  muteInstance(h: Handle, muted: boolean): void;
```

Add `Handle` to the type import from `./bridge.js`. In the returned object of `createRenderer`, add:

```ts
    windowHandle: () => host.windowHandle(),
    muteInstance: (h, muted) => host.muteInstance(h, muted),
```

And in `hostConfig.ts`, keep a map of instances by handle: add after `const destroying = new Set<Handle>();` the line `const instances = new Map<Handle, Instance>();`, add `instances.set(handle, inst);` in `createInstance` after the `inst` literal, add `instances.delete(inst.handle);` in `destroyInstance` after `b.destroy(inst.handle)`, add the function

```ts
  function muteInstance(h: Handle, muted: boolean) {
    const inst = instances.get(h);
    if (inst) inst.muted = muted;
  }
```

The last renderer test in Step 1 uses `createHostConfig` directly; the file imports it already.

- [ ] **Step 4: Run the renderer tests**

```bash
npx vitest run packages/core/test/renderer.test.tsx
```

Expected: every test passes, including the four of `the window menu` and the two of `element extensions`. The test `typegen and core list the same elements` in `typegen/test/emit.test.mjs` now fails; Step 5 fixes it.

- [ ] **Step 5: Write the typegen side: the elements, the extension props, and the emit test**

In `maemo-react/typegen/emit.mjs`, replace the `ELEMENTS` table with:

```js
/** JSX element name -> [GTK class, children model]. Keep it equal to packages/core/src/elements.ts. */
export const ELEMENTS = {
  'hildon-window': ['HildonWindow', 'node'],
  'gtk-vbox': ['GtkVBox', 'node'],
  'gtk-hbox': ['GtkHBox', 'node'],
  'gtk-label': ['GtkLabel', 'text'],
  'gtk-button': ['GtkButton', 'text'],
  'gtk-toggle-button': ['GtkToggleButton', 'text'],
  'gtk-check-button': ['GtkCheckButton', 'text'],
  'gtk-entry': ['GtkEntry', 'none'],
  'gtk-hscale': ['GtkHScale', 'none'],
  'gtk-vscale': ['GtkVScale', 'none'],
  'gtk-combo-box': ['GtkComboBox', 'none'],
  'gtk-tree-view': ['GtkTreeView', 'none'],
  'gtk-scrolled-window': ['GtkScrolledWindow', 'node'],
  'gtk-menu': ['GtkMenu', 'node'],
  'gtk-menu-item': ['GtkMenuItem', 'node'],
  'gtk-separator-menu-item': ['GtkSeparatorMenuItem', 'none'],
};

/** Element -> the interface of its extension props (packages/core/src/list.ts and extensions.ts). */
export const EXTRA_PROPS = {
  'gtk-tree-view': 'ListElementProps',
  'gtk-hscale': 'RangeElementProps',
  'gtk-vscale': 'RangeElementProps',
  'gtk-combo-box': 'ComboElementProps',
};

/** The hand-written interfaces of the extension props. They go into intrinsics.d.ts as they are. */
export const EXTENSION_TYPES = `
/** A row of a List. The key must be unique in the list. */
export interface ListRow {
  key: string;
  [field: string]: unknown;
}

/** A column of a List. */
export interface ListColumn {
  /** The field of the row that the column shows. */
  field: string;
  /** 'text' (default) shows the value as text. 'toggle' shows a check box for a boolean, and nothing for null. */
  kind?: 'text' | 'toggle';
  /** The header text. */
  title?: string;
  /** Take the extra width. */
  expand?: boolean;
}

/** The props of <gtk-tree-view> that the renderer applies itself. */
export interface ListElementProps {
  data?: ReadonlyArray<ListRow>;
  /** Read when the list mounts. To change the fields or kinds, give the list a new key. */
  columns?: ReadonlyArray<ListColumn>;
  /** The key of the selected row, or null. Give it to control the selection. */
  selected?: string | null;
  onSelect?: (key: string | null, target: WidgetTarget) => void;
  /** The user tapped a toggle. value is the new value; the row keeps its old value until data changes. */
  onToggle?: (key: string, field: string, value: boolean, target: WidgetTarget) => void;
}

/** The props of <gtk-hscale> and <gtk-vscale> that the renderer applies itself. */
export interface RangeElementProps {
  /** Default 0. */
  min?: number;
  /** Default 100. */
  max?: number;
  /** Default 1. The page increment is ten steps. */
  step?: number;
  value?: number;
  /** The user released the slider, or changed the value with a key. */
  onChangeValue?: (value: number, target: WidgetTarget) => void;
}

/** The props of <gtk-combo-box> that the renderer applies itself. */
export interface ComboElementProps {
  /** The text rows. A change of the rows keeps the active prop. */
  items?: ReadonlyArray<string>;
}
`;
```

Change the signature of `emit` to `export function emit(data, elements = ELEMENTS, extra = EXTRA_PROPS) {`. In the `out` array, after the `CommonProps` block (the line `'',` that follows `'}'`), add `EXTENSION_TYPES.trimEnd(),` and `'',`. Change the element line in the last loop to:

```js
    const mix = extra[el] ? ` & ${extra[el]}` : '';
    out.push(`  '${el}': ${cls}Props${mix} & { ${CHILDREN[model]} };`);
```

In `maemo-react/typegen/test/emit.test.mjs`, add after the test `emit refuses an element whose class is missing`:

```js
test('emit mixes the extension props into an element and writes their interfaces', () => {
  const out = emit(DATA, { 'gtk-label': ['GtkLabel', 'text'] }, { 'gtk-label': 'RangeElementProps' });
  expect(out).toContain('export interface ListRow {');
  expect(out).toContain('export interface RangeElementProps {');
  expect(out).toContain("  'gtk-label': GtkLabelProps & RangeElementProps & { children?: string | number | Array<string | number> };");
});
```

In `maemo-react/typegen/run.sh`, change the `CLASSES` list to:

```bash
CLASSES="HildonWindow GtkWindow GtkVBox GtkHBox GtkLabel GtkButton GtkEntry GtkScrolledWindow
         GtkTreeView GtkTextView GtkImage GtkCheckButton GtkToggleButton GtkHScale GtkVScale
         GtkComboBox GtkProgressBar GtkMenu GtkMenuItem GtkSeparatorMenuItem"
```

and add after `OUT=packages/types/generated/gtk.json`:

```bash
trap 'rm -f "$OUT.tmp"' EXIT
```

- [ ] **Step 6: Regenerate the types**

```bash
devhost/run.sh typegen/run.sh
npm run typegen:emit
grep -n '"model"' packages/types/generated/gtk.json | head -2
grep -n "model?: Handle | null\|'gtk-menu-item'\|export interface GtkMenuItemProps" packages/types/generated/intrinsics.d.ts
```

Expected: `wrote packages/types/generated/gtk.json (... bytes, GTK 2.10.12)`; the first grep shows `"kind":"object"` for `model`; the second shows `model?: Handle | null;` (twice: GtkTreeView and GtkComboBox), `export interface GtkMenuItemProps extends GtkItemProps {` and the `'gtk-menu-item'` element line.

- [ ] **Step 7: Extend the type check and run everything**

In `maemo-react/packages/types/test/check.tsx`, add inside the `<Box vertical spacing={4} homogeneous>` of `App`, before the first `@ts-expect-error` comment:

```tsx
        <gtk-tree-view data={[{ key: 'a', name: 'A', on: true }]} columns={[{ field: 'name', title: 'Name', expand: true }, { field: 'on', kind: 'toggle' }]} selected="a" onSelect={(k) => console.log(k)} onToggle={(k, f, v) => console.log(k, f, v)} headersVisible={false} />
        <gtk-hscale min={0} max={255} step={5} value={n} digits={0} onChangeValue={(v) => setN(v)} />
        <gtk-combo-box items={['heat', 'cool']} active={0} onChanged={(t) => console.log(t.get('active'))} />
        <gtk-toggle-button active onToggled={() => {}}>Favorite</gtk-toggle-button>
        <gtk-check-button active={false}>Check</gtk-check-button>
        {/* @ts-expect-error: a row key is a string */}
        <gtk-tree-view data={[{ key: 1 }]} />
        {/* @ts-expect-error: min is a number */}
        <gtk-hscale min="0" />
        {/* @ts-expect-error: items are strings */}
        <gtk-combo-box items={[1]} />
```

and after `</Box>` inside the `<Window>`, before `</Window>`:

```tsx
      <gtk-menu>
        <gtk-menu-item onActivate={() => quit(0)}>
          <gtk-label>Quit</gtk-label>
        </gtk-menu-item>
        <gtk-separator-menu-item />
      </gtk-menu>
```

Run:

```bash
npm test
npm run typecheck
```

Expected: every Vitest file passes, including `typegen and core list the same elements`; `tsc` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add maemo-react/packages/core/src/elements.ts maemo-react/packages/core/src/hostConfig.ts maemo-react/packages/core/src/renderer.ts maemo-react/packages/core/test/fakeBridge.ts maemo-react/packages/core/test/renderer.test.tsx maemo-react/typegen/run.sh maemo-react/typegen/emit.mjs maemo-react/typegen/test/emit.test.mjs maemo-react/packages/types/generated/gtk.json maemo-react/packages/types/generated/intrinsics.d.ts maemo-react/packages/types/test/check.tsx
git commit -m "Add element extensions, the window menu and the M2a elements with their types"
```

---

### Task 5: The List extension and the List widget

**Files:**
- Create: `maemo-react/packages/core/src/list.ts`
- Modify: `maemo-react/packages/core/src/elements.ts` (the `gtk-tree-view` row)
- Modify: `maemo-react/packages/core/test/fakeBridge.ts`
- Create: `maemo-react/packages/core/test/list.test.tsx`
- Modify: `maemo-react/packages/widgets/src/index.tsx`, `maemo-react/packages/widgets/test/widgets.test.tsx`

**Interfaces:**
- Consumes: `ElementExt`, `ExtContext`, `ExtInstance` (Task 4); the helpers `listStore.*`, `treeView.*`, `column.*` (Task 2); the `model` property (Task 1).
- Produces:
  - `LIST_EXT: ElementExt` (list.ts) for `<gtk-tree-view data columns selected onSelect onToggle>`. The store has one `string` column for each text column and two `boolean` columns (active, visible) for each toggle column. An update removes the rows whose keys are gone, then walks the new data: a new key is inserted at its index, a moved key is moved with `listStore.move`, and a row object that changed gets one `listStore.set` for each changed cell. A row object with the same identity makes no call. `columns` is read at mount; a change of a field or a kind throws.
  - `List<Row extends ListRow>(props: ListProps<Row>)` (widgets): a `ScrolledWindow` around the tree view. `onSelect(key, row)` and `onToggle(key, field, value, row)` get the row object. `headersVisible` defaults to true when a column has a title.
  - The fake bridge keeps `rows` for a store, `selected` and a lazy `selection` for a tree view, and gives `rowsOf(h)`, `selectedOf(h)` and `tap(view, index)`.

- [ ] **Step 1: Write the failing tests**

Create `maemo-react/packages/core/test/list.test.tsx`:

```tsx
import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import type { ListColumn, ListRow } from '../src/list.js';
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

const COLUMNS: ListColumn[] = [
  { field: 'name', title: 'Name', expand: true },
  { field: 'state' },
  { field: 'on', kind: 'toggle' },
];

interface Row extends ListRow {
  name: string;
  state: string | number;
  on?: boolean | null;
}

const rows = (n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({ key: 'e' + (from + i), name: 'Entity ' + (from + i), state: 'off', on: false }));

function view(data: Row[], extra: Record<string, unknown> = {}, columns: ListColumn[] = COLUMNS) {
  return (
    <hildon-window>
      <gtk-tree-view data={data} columns={columns} {...extra} />
    </hildon-window>
  );
}

const storeOps = (t: ReturnType<typeof setup>, from: number) =>
  t.ops.slice(from).filter((o) => o[0] === 'call' && String(o[2]).startsWith('listStore.'));

describe('List: mount', () => {
  test('makes a store with the column types, the columns and their renderers', () => {
    const t = setup();
    t.renderer.render(view(rows(2)));
    const [store] = t.ofType('GtkListStore');
    const [tv] = t.ofType('GtkTreeView');
    expect(t.props(tv).model).toBe(store);
    expect(t.ops).toContainEqual(['call', store, 'listStore.setColumnTypes', ['string', 'string', 'boolean', 'boolean']]);
    const cols = t.ofType('GtkTreeViewColumn');
    expect(cols).toHaveLength(3);
    expect(t.childrenOf(tv)).toEqual(cols);
    expect(t.props(cols[0])).toMatchObject({ title: 'Name', expand: true });
    expect(t.ofType('GtkCellRendererText')).toHaveLength(2);
    const [toggle] = t.ofType('GtkCellRendererToggle');
    expect(t.props(toggle).activatable).toBe(true);
    expect(t.ops).toContainEqual(['call', cols[2], 'column.addAttribute', toggle, 'active', 2]);
    expect(t.ops).toContainEqual(['call', cols[2], 'column.addAttribute', toggle, 'visible', 3]);
    expect(t.rowsOf(store)).toEqual([
      ['Entity 0', 'off', false, true],
      ['Entity 1', 'off', false, true],
    ]);
    expect(t.errors).toEqual([]);
  });

  test('a toggle of null hides the check box; a number shows as text; null text is empty', () => {
    const t = setup();
    t.renderer.render(view([{ key: 'a', name: 'Thermostat', state: 21.5, on: null }, { key: 'b', name: null as unknown as string, state: '' }]));
    const [store] = t.ofType('GtkListStore');
    expect(t.rowsOf(store)).toEqual([
      ['Thermostat', '21.5', false, false],
      ['', '', false, false],
    ]);
  });

  test('errors: no columns, a duplicate key', () => {
    const t = setup();
    t.renderer.render(view([], {}, []));
    expect(t.errors.join()).toMatch(/<List> needs at least one column/);
    const u = setup();
    u.renderer.render(view([...rows(1), ...rows(1)]));
    expect(u.errors.join()).toMatch(/the key 'e0' is in the data twice/);
  });
});

describe('List: updates', () => {
  test('one changed row in 200 makes one listStore.set for each changed cell', () => {
    const t = setup();
    const data = rows(200);
    const root = t.renderer.render(view(data));
    const [store] = t.ofType('GtkListStore');
    const from = t.ops.length;
    const next = data.slice();
    next[57] = { ...next[57], state: 'on', on: true };
    root.render(view(next));
    expect(storeOps(t, from)).toEqual([
      ['call', store, 'listStore.set', 57, 1, 'on'],
      ['call', store, 'listStore.set', 57, 2, true],
      ['call', store, 'listStore.set', 57, 3, true],
    ]);
    expect(t.rowsOf(store)[57]).toEqual(['Entity 57', 'on', true, true]);
  });

  test('the same data array makes no store call', () => {
    const t = setup();
    const data = rows(5);
    const root = t.renderer.render(view(data));
    const from = t.ops.length;
    root.render(view(data));
    expect(storeOps(t, from)).toEqual([]);
  });

  test('insert, remove and move by key', () => {
    const t = setup();
    const a = rows(4);
    const root = t.renderer.render(view(a));
    const [store] = t.ofType('GtkListStore');
    const names = () => t.rowsOf(store).map((r) => r[0]);
    let from = t.ops.length;
    root.render(view([a[3], a[0], a[2]])); // e1 removed, e3 moved to the front
    expect(storeOps(t, from)).toEqual([
      ['call', store, 'listStore.remove', 1],
      ['call', store, 'listStore.move', 2, 0],
    ]);
    expect(names()).toEqual(['Entity 3', 'Entity 0', 'Entity 2']);
    from = t.ops.length;
    const n = rows(1, 9)[0];
    root.render(view([a[3], n, a[0], a[2]]));
    expect(storeOps(t, from)).toEqual([['call', store, 'listStore.insert', 1, ['Entity 9', 'off', false, true]]]);
    expect(names()).toEqual(['Entity 3', 'Entity 9', 'Entity 0', 'Entity 2']);
    root.render(view([]));
    expect(names()).toEqual([]);
  });

  test('a tap on a toggle calls onToggle with the key, the field and the new value', () => {
    const t = setup();
    const got: unknown[] = [];
    t.renderer.render(view(rows(3), { onToggle: (key: string, field: string, value: boolean) => got.push([key, field, value]) }));
    const [toggle] = t.ofType('GtkCellRendererToggle');
    t.emit(toggle, 'toggled', '2');
    expect(got).toEqual([['e2', 'on', true]]);
    t.emit(toggle, 'toggled', '7'); // no such row
    expect(got).toHaveLength(1);
  });

  test('a toggle handler that removes the row: no error, the store shrinks', () => {
    const t = setup();
    function App() {
      const [data, setData] = useState(rows(3));
      return (
        <hildon-window>
          <gtk-tree-view data={data} columns={COLUMNS} onToggle={(key: string) => setData(data.filter((r) => r.key !== key))} />
        </hildon-window>
      );
    }
    t.renderer.render(<App />);
    const [store] = t.ofType('GtkListStore');
    const [toggle] = t.ofType('GtkCellRendererToggle');
    t.emit(toggle, 'toggled', '1');
    expect(t.errors).toEqual([]);
    expect(t.rowsOf(store).map((r) => r[0])).toEqual(['Entity 0', 'Entity 2']);
  });

  test('new titles are applied; a changed field or kind is an error', () => {
    const t = setup();
    const root = t.renderer.render(view(rows(1)));
    const cols = t.ofType('GtkTreeViewColumn');
    root.render(view(rows(1), {}, [{ field: 'name', title: 'Entity' }, { field: 'state', title: 'State' }, { field: 'on', kind: 'toggle' }]));
    expect(t.props(cols[0]).title).toBe('Entity');
    expect(t.props(cols[1]).title).toBe('State');
    root.render(view(rows(1), {}, [{ field: 'name' }, { field: 'on', kind: 'toggle' }]));
    expect(t.errors.join()).toMatch(/fields and kinds of the columns cannot change/);
  });
});

describe('List: selection', () => {
  test('a tap on a row calls onSelect with the key; the same row again does not', () => {
    const t = setup();
    const got: unknown[] = [];
    t.renderer.render(view(rows(3), { onSelect: (k: string | null) => got.push(k) }));
    const [tv] = t.ofType('GtkTreeView');
    t.tap(tv, 1);
    t.tap(tv, 1);
    t.tap(tv, -1);
    expect(got).toEqual(['e1', null]);
  });

  test('selected is controlled: the view follows the prop, and the prop does not echo', async () => {
    const t = setup();
    const got: unknown[] = [];
    const onSelect = (k: string | null) => got.push(k);
    const root = t.renderer.render(view(rows(3), { selected: 'e2', onSelect }));
    const [tv] = t.ofType('GtkTreeView');
    expect(t.selectedOf(tv)).toBe(2);
    root.render(view(rows(3), { selected: 'e0', onSelect }));
    expect(t.selectedOf(tv)).toBe(0);
    root.render(view(rows(3), { selected: null, onSelect }));
    expect(t.selectedOf(tv)).toBe(-1);
    await Promise.resolve();
    expect(got).toEqual([]);
  });

  test('the selected row goes away: onSelect(null) once, after the commit', async () => {
    const t = setup();
    const got: unknown[] = [];
    const onSelect = (k: string | null) => got.push(k);
    const data = rows(3);
    const root = t.renderer.render(view(data, { onSelect }));
    const [tv] = t.ofType('GtkTreeView');
    t.tap(tv, 1);
    expect(got).toEqual(['e1']);
    root.render(view([data[0], data[2]], { onSelect }));
    expect(got).toEqual(['e1']); // the report waits for the end of the commit
    await Promise.resolve();
    expect(got).toEqual(['e1', null]);
    await Promise.resolve();
    expect(got).toEqual(['e1', null]);
    expect(t.errors).toEqual([]);
  });

  test('a selected key that is not in the data reports null', async () => {
    const t = setup();
    const got: unknown[] = [];
    t.renderer.render(view(rows(2), { selected: 'zz', onSelect: (k: string | null) => got.push(k) }));
    const [tv] = t.ofType('GtkTreeView');
    expect(t.selectedOf(tv)).toBe(-1);
    await Promise.resolve();
    expect(got).toEqual([null]);
  });

  test('unmount destroys the store, the columns, the renderers and the selection', () => {
    const t = setup();
    const root = t.renderer.render(view(rows(2), { onSelect: () => {} }));
    expect(t.ofType('GtkTreeSelection')).toHaveLength(1);
    root.unmount();
    for (const type of ['GtkTreeView', 'GtkListStore', 'GtkTreeViewColumn', 'GtkCellRendererText', 'GtkCellRendererToggle', 'GtkTreeSelection']) {
      expect(t.ofType(type)).toEqual([]);
    }
  });
});
```

Add to `maemo-react/packages/widgets/test/widgets.test.tsx`, before the last `});`:

```tsx
  test('List: a scrolled tree view, the row in onSelect and onToggle, headers from the titles', () => {
    const t = setup();
    const got: unknown[] = [];
    const data = [
      { key: 'a', name: 'Lamp', on: false },
      { key: 'b', name: 'Fan', on: true },
    ];
    t.renderer.render(
      <Window>
        <Box vertical>
          <List
            data={data}
            columns={[{ field: 'name', title: 'Name' }, { field: 'on', kind: 'toggle' }]}
            expand
            onSelect={(key, row) => got.push(['select', key, row])}
            onToggle={(key, field, value, row) => got.push(['toggle', key, field, value, row])}
          />
        </Box>
      </Window>,
    );
    const [scrolled] = t.ofType('GtkScrolledWindow');
    const [tv] = t.ofType('GtkTreeView');
    expect(t.childrenOf(scrolled)).toEqual([tv]);
    expect(t.ops).toContainEqual(['childSet', t.ofType('GtkVBox')[0], scrolled, 'expand', true]);
    expect(t.props(tv)['headers-visible']).toBe(true);
    t.tap(tv, 1);
    t.emit(t.ofType('GtkCellRendererToggle')[0], 'toggled', '0');
    expect(got).toEqual([
      ['select', 'b', data[1]],
      ['toggle', 'a', 'on', true, data[0]],
    ]);
  });

  test('List without titles hides the headers', () => {
    const t = setup();
    t.renderer.render(
      <Window>
        <List data={[]} columns={[{ field: 'name' }]} />
      </Window>,
    );
    expect(t.props(t.ofType('GtkTreeView')[0])['headers-visible']).toBe(false);
  });
```

and add `List` to the import from `'../src/index.js'`.

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run packages/core/test/list.test.tsx packages/widgets/test/widgets.test.tsx
```

Expected: the list tests fail with `Cannot find module '../src/list.js'`; the widgets tests fail with `List is not defined` or a missing export.

- [ ] **Step 3: Extend the fake bridge**

In `maemo-react/packages/core/test/fakeBridge.ts`, add to `interface FakeObject`:

```ts
  /** For a list store: the rows, each an array of cell values. */
  rows: unknown[][];
  /** For a list store: the column kinds. */
  columns: string[];
  /** For a tree view: the selected row, -1 for none. */
  selected: number;
  /** For a tree view: the GtkTreeSelection, made on the first treeView.selection. */
  selection: Handle | null;
```

In `create`, add `rows: [], columns: [], selected: -1, selection: null` to the new object. Move the signal emission into a function that `call` can use: add before `const bridge: Bridge = {`:

```ts
  /** Emit a signal as GTK would. Returns the last handler's result. */
  function emit(h: Handle, signal: string, ...args: unknown[]) {
    let r: unknown;
    for (const fn of obj(h).handlers.get(signal) ?? []) r = fn(...args);
    return r;
  }

  /** The tree views that show the store h. */
  const viewsOf = (h: Handle) => [...objects.values()].filter((o) => !o.destroyed && o.props.model === h);
```

and replace the `emit` method of the returned object with `emit,`. In the `call` switch, add before `default:`:

```ts
        case 'listStore.setColumnTypes':
          o.columns = (args[0] as string[]).slice();
          return undefined;
        case 'listStore.insert': {
          let i = args[0] as number;
          const row = (args[1] as unknown[]).slice();
          if (row.length !== o.columns.length) {
            throw new Error(`fake bridge: the row has ${row.length} values, the store has ${o.columns.length} columns`);
          }
          if (i < 0 || i > o.rows.length) i = o.rows.length;
          o.rows.splice(i, 0, row);
          return undefined;
        }
        case 'listStore.set': {
          const row = o.rows[args[0] as number];
          if (!row) throw new Error(`fake bridge: no row ${args[0]}`);
          row[args[1] as number] = args[2];
          return undefined;
        }
        case 'listStore.get':
          return o.rows[args[0] as number][args[1] as number];
        case 'listStore.remove': {
          const i = args[0] as number;
          if (!o.rows[i]) throw new Error(`fake bridge: no row ${i}`);
          o.rows.splice(i, 1);
          // GTK unselects a selected row that goes away, and the selection emits changed.
          for (const v of viewsOf(h)) {
            if (v.selected === i) {
              v.selected = -1;
              if (v.selection !== null) emit(v.selection, 'changed');
            } else if (v.selected > i) {
              v.selected--;
            }
          }
          return undefined;
        }
        case 'listStore.move': {
          const [from, to] = args as number[];
          const [row] = o.rows.splice(from, 1);
          o.rows.splice(to, 0, row);
          return undefined;
        }
        case 'listStore.clear':
          o.rows = [];
          return undefined;
        case 'listStore.length':
          return o.rows.length;
        case 'treeView.appendColumn':
          o.children.push(args[0] as Handle);
          return o.children.length;
        case 'treeView.selection':
          if (o.selection === null) o.selection = bridge.create('GtkTreeSelection');
          return o.selection;
        case 'treeView.selectedIndex':
          return o.selected;
        case 'treeView.selectIndex': {
          const i = args[0] as number;
          const store = o.props.model as Handle | undefined;
          const n = store === undefined ? 0 : obj(store).rows.length;
          if (i >= n) throw new Error(`fake bridge: no row ${i}`);
          const next = i < 0 ? -1 : i;
          if (next !== o.selected) {
            o.selected = next;
            if (o.selection !== null) emit(o.selection, 'changed');
          }
          return undefined;
        }
        case 'treeView.renderer':
        case 'column.pack':
        case 'column.addAttribute':
          return undefined;
```

Add to the returned object, after `menuOf`:

```ts
    rowsOf: (h: Handle) => obj(h).rows,
    selectedOf: (h: Handle) => obj(h).selected,
    /** Select a row as a tap does: the selection emits changed. */
    tap(view: Handle, index: number) {
      const o = obj(view);
      if (o.selected === index) return;
      o.selected = index;
      if (o.selection !== null) emit(o.selection, 'changed');
    },
```

- [ ] **Step 4: Write the List extension**

Create `maemo-react/packages/core/src/list.ts`:

```ts
// <gtk-tree-view data columns>: a GtkTreeView over a GtkListStore (spec
// section 5). The rows are plain objects with a unique key. An update changes
// only the store rows that changed, so a change of one row in 200 costs one
// listStore.set for each changed cell.
import type { Bridge, Handle } from './bridge.js';
import type { ElementExt, ExtContext, ExtInstance } from './elements.js';

/** A row of the list. The key must be unique in the list. */
export interface ListRow {
  key: string;
  [field: string]: unknown;
}

/** A column of the list. */
export interface ListColumn {
  /** The field of the row that the column shows. */
  field: string;
  /** 'text' (default) shows the value as text. 'toggle' shows a check box for a boolean, and nothing for null. */
  kind?: 'text' | 'toggle';
  /** The header text. */
  title?: string;
  /** Take the extra width. */
  expand?: boolean;
}

interface StoreColumn {
  field: string;
  kind: 'text' | 'toggle';
  /** The first store column of this column. A toggle takes two: active and visible. */
  at: number;
}

interface ListState {
  store: Handle;
  columns: StoreColumn[];
  /** The GtkTreeViewColumn handles, in column order. */
  columnHandles: Handle[];
  /** The keys of the rows, in store order. */
  keys: string[];
  /** The row objects, by key. */
  rows: Map<string, ListRow>;
  /** The key that the application last saw or asked for. */
  selectedKey: string | null;
}

type Props = Record<string, unknown>;

/** The store cells of one column of a row. */
function cellValues(col: StoreColumn, row: ListRow): unknown[] {
  const v = row[col.field];
  if (col.kind === 'toggle') return [v === true, v !== null && v !== undefined];
  return [v === null || v === undefined ? '' : String(v)];
}

function rowValues(columns: StoreColumn[], row: ListRow): unknown[] {
  const out: unknown[] = [];
  for (const c of columns) out.push(...cellValues(c, row));
  return out;
}

function storeColumns(columns: readonly ListColumn[]): { columns: StoreColumn[]; kinds: string[] } {
  const out: StoreColumn[] = [];
  const kinds: string[] = [];
  for (const c of columns) {
    const kind = c.kind ?? 'text';
    out.push({ field: c.field, kind, at: kinds.length });
    if (kind === 'toggle') kinds.push('boolean', 'boolean');
    else kinds.push('string');
  }
  return { columns: out, kinds };
}

/** Call onSelect when the selection of the view differs from the last known key. */
function reportSelection(ctx: ExtContext, inst: ExtInstance, st: ListState) {
  const index = ctx.bridge.call(inst.handle, 'treeView.selectedIndex') as number;
  const key = index >= 0 ? (st.keys[index] ?? null) : null;
  if (key === st.selectedKey) return;
  st.selectedKey = key;
  const fn = inst.props.onSelect;
  if (typeof fn === 'function') ctx.run(() => fn(key, inst.target));
}

function create(ctx: ExtContext, inst: ExtInstance, columns: readonly ListColumn[]): ListState {
  const b = ctx.bridge;
  const h = inst.handle;
  if (columns.length === 0) throw new Error('<List> needs at least one column');
  const { columns: cols, kinds } = storeColumns(columns);
  const store = b.create('GtkListStore');
  inst.extra.push(store);
  b.call(store, 'listStore.setColumnTypes', kinds);
  b.set(h, 'model', store);
  const st: ListState = { store, columns: cols, columnHandles: [], keys: [], rows: new Map(), selectedKey: null };
  columns.forEach((c, i) => {
    const col = b.create('GtkTreeViewColumn');
    inst.extra.push(col);
    st.columnHandles.push(col);
    if (c.title !== undefined) b.set(col, 'title', c.title);
    if (c.expand) b.set(col, 'expand', true);
    const sc = cols[i];
    const renderer = b.create(sc.kind === 'toggle' ? 'GtkCellRendererToggle' : 'GtkCellRendererText');
    inst.extra.push(renderer);
    b.call(col, 'column.pack', renderer);
    if (sc.kind === 'toggle') {
      b.set(renderer, 'activatable', true);
      b.call(col, 'column.addAttribute', renderer, 'active', sc.at);
      b.call(col, 'column.addAttribute', renderer, 'visible', sc.at + 1);
      b.connect(renderer, 'toggled', (path) => {
        const key = st.keys[Number(path)];
        const fn = inst.props.onToggle;
        if (key === undefined || inst.muted || typeof fn !== 'function') return;
        const row = st.rows.get(key)!;
        ctx.run(() => fn(key, sc.field, row[sc.field] !== true, inst.target));
      });
    } else {
      b.call(col, 'column.addAttribute', renderer, 'text', sc.at);
    }
    b.call(h, 'treeView.appendColumn', col);
  });
  const selection = b.call(h, 'treeView.selection') as Handle;
  inst.extra.push(selection);
  b.connect(selection, 'changed', () => {
    if (!inst.muted) reportSelection(ctx, inst, st);
  });
  return st;
}

function checkColumns(b: Bridge, st: ListState, columns: readonly ListColumn[]) {
  const same =
    columns.length === st.columns.length &&
    columns.every((c, i) => c.field === st.columns[i].field && (c.kind ?? 'text') === st.columns[i].kind);
  if (!same) throw new Error('<List>: the fields and kinds of the columns cannot change; give the List a new key');
  columns.forEach((c, i) => b.set(st.columnHandles[i], 'title', c.title ?? ''));
}

function applyData(b: Bridge, st: ListState, data: readonly ListRow[]) {
  const nextKeys = new Set<string>();
  for (const row of data) {
    if (typeof row.key !== 'string') throw new Error('<List>: each row needs a string key');
    if (nextKeys.has(row.key)) throw new Error(`<List>: the key '${row.key}' is in the data twice`);
    nextKeys.add(row.key);
  }
  // Remove the rows that are gone, from the end, so the indexes stay valid.
  for (let i = st.keys.length - 1; i >= 0; i--) {
    if (nextKeys.has(st.keys[i])) continue;
    b.call(st.store, 'listStore.remove', i);
    st.rows.delete(st.keys[i]);
    st.keys.splice(i, 1);
  }
  // Walk the new data. The rows before i are final, so a known key is at i or after it.
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const old = st.rows.get(row.key);
    if (!old) {
      b.call(st.store, 'listStore.insert', i, rowValues(st.columns, row));
      st.keys.splice(i, 0, row.key);
    } else {
      const from = st.keys.indexOf(row.key, i);
      if (from !== i) {
        b.call(st.store, 'listStore.move', from, i);
        st.keys.splice(from, 1);
        st.keys.splice(i, 0, row.key);
      }
      if (old !== row) {
        for (const c of st.columns) {
          if (old[c.field] === row[c.field]) continue;
          const values = cellValues(c, row);
          for (let k = 0; k < values.length; k++) b.call(st.store, 'listStore.set', i, c.at + k, values[k]);
        }
      }
    }
    st.rows.set(row.key, row);
  }
}

function applySelected(b: Bridge, inst: ExtInstance, st: ListState, selected: string | null) {
  const index = selected === null ? -1 : st.keys.indexOf(selected);
  st.selectedKey = selected; // what the application asked for; a missing key reports null later
  const current = b.call(inst.handle, 'treeView.selectedIndex') as number;
  if (current !== index) b.call(inst.handle, 'treeView.selectIndex', index);
}

export const LIST_EXT: ElementExt = {
  props: new Set(['data', 'columns', 'selected', 'onSelect', 'onToggle']),
  update(ctx: ExtContext, inst: ExtInstance, prev: Props | null, next: Props) {
    const b = ctx.bridge;
    const columns = (next.columns ?? []) as readonly ListColumn[];
    const data = (next.data ?? []) as readonly ListRow[];
    let st = inst.ext as ListState | undefined;
    if (!st) st = inst.ext = create(ctx, inst, columns);
    else if (prev && prev.columns !== next.columns) checkColumns(b, st, columns);
    // A removed row can change the selection. Do not report it inside the
    // commit: React must not get a state change here. Report it after.
    inst.muted = true;
    try {
      if (!prev || prev.data !== next.data) applyData(b, st, data);
      if (next.selected !== undefined) applySelected(b, inst, st, next.selected as string | null);
    } finally {
      inst.muted = false;
    }
    const state = st;
    queueMicrotask(() => {
      if (!inst.muted) reportSelection(ctx, inst, state);
    });
  },
};
```

In `maemo-react/packages/core/src/elements.ts`, add `import { LIST_EXT } from './list.js';` after the first import, and change the `gtk-tree-view` row to:

```ts
  'gtk-tree-view': { gtype: 'GtkTreeView', children: 'none', ext: LIST_EXT },
```

- [ ] **Step 5: Write the List widget**

In `maemo-react/packages/widgets/src/index.tsx`, change the type import to:

```tsx
import type { CommonProps, ListColumn, ListRow, MaemoIntrinsicElements, WidgetTarget } from '@maemo-react/types';
```

and add at the end of the file:

```tsx
export type { ListColumn, ListRow } from '@maemo-react/types';

export type ListProps<Row extends ListRow> = Pick<CommonProps, 'key' | 'ref' | 'expand' | 'fill' | 'padding' | 'packType'> & {
  data: readonly Row[];
  /** Read when the list mounts. To change the fields or kinds, give the List a new key. */
  columns: readonly ListColumn[];
  /** The key of the selected row, or null. Give it to control the selection. */
  selected?: string | null;
  onSelect?: (key: string | null, row: Row | null) => void;
  /** The user tapped a toggle. The row keeps its old value until data changes. */
  onToggle?: (key: string, field: string, value: boolean, row: Row) => void;
  /** Default: true when a column has a title. */
  headersVisible?: boolean;
  widthRequest?: number;
  heightRequest?: number;
};

/**
 * A list of rows in a GtkTreeView, inside a ScrolledWindow. It takes no
 * children: the rows come from data, and only the changed rows go to GTK.
 */
export function List<Row extends ListRow>({ data, columns, onSelect, onToggle, headersVisible, expand, fill, padding, packType, ...rest }: ListProps<Row>) {
  const rowOf = (key: string | null) => (key === null ? null : (data.find((r) => r.key === key) ?? null));
  return (
    <ScrolledWindow expand={expand} fill={fill} padding={padding} packType={packType}>
      <gtk-tree-view
        {...rest}
        data={data}
        columns={columns}
        headersVisible={headersVisible ?? columns.some((c) => c.title !== undefined)}
        onSelect={onSelect ? (key) => onSelect(key, rowOf(key)) : undefined}
        onToggle={onToggle ? (key, field, value) => onToggle(key, field, value, rowOf(key)!) : undefined}
      />
    </ScrolledWindow>
  );
}
```

- [ ] **Step 6: Run the tests**

```bash
npm test
npm run typecheck
```

Expected: every test passes, including the 14 of `list.test.tsx` and the two List tests of `widgets.test.tsx`; `tsc` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add maemo-react/packages/core/src/list.ts maemo-react/packages/core/src/elements.ts maemo-react/packages/core/test/fakeBridge.ts maemo-react/packages/core/test/list.test.tsx maemo-react/packages/widgets/src/index.tsx maemo-react/packages/widgets/test/widgets.test.tsx
git commit -m "Add List: a GtkTreeView over a GtkListStore with minimal store updates"
```

---

### Task 6: The Scale and ComboBox extensions, the other widgets, and banner

**Files:**
- Create: `maemo-react/packages/core/src/extensions.ts`
- Modify: `maemo-react/packages/core/src/elements.ts` (the scale and combo box rows)
- Modify: `maemo-react/packages/core/src/renderer.ts`, `maemo-react/packages/core/src/index.ts`
- Modify: `maemo-react/packages/core/test/fakeBridge.ts`
- Create: `maemo-react/packages/core/test/extensions.test.tsx`
- Modify: `maemo-react/packages/core/test/renderer.test.tsx` (banner)
- Modify: `maemo-react/packages/widgets/src/index.tsx`, `maemo-react/packages/widgets/test/widgets.test.tsx`
- Modify: `maemo-react/packages/types/test/check.tsx`

**Interfaces:**
- Consumes: `ElementExt` (Task 4); `range.*`, `comboBox.*`, `window.banner` (Task 3); `windowHandle()` (Task 4).
- Produces:
  - `RANGE_EXT` for `<gtk-hscale>` and `<gtk-vscale>`: `min` (0), `max` (100), `step` (1), `value`, `onChangeValue(value, target)`. The element sets `update-policy` to `discontinuous`, so GTK changes the value when the user releases the slider; `onChangeValue` runs on `value-changed`. A value set by React does not echo.
  - `COMBO_EXT` for `<gtk-combo-box>`: `items`. A change of items re-applies `active` and does not run `onChanged`.
  - `banner(text)` in `@maemo-react/core`: `window.banner` on the newest shown window; `console.log('banner: ' + text)` when there is no window.
  - Widgets: `ToggleButton` and `CheckButton` (`active`, `onToggle(active)`), `Scale` (`vertical`, the range props, `digits` defaults to 0), `ComboBox` (`items`, `active`, `onChangeActive(index, item)`), `Menu`, `MenuItem` (`onActivate`, text children), `MenuSeparator`.

The deferred findings T13 "Box remounts when `vertical` changes" and T11 "explicit `visible={true}` shows a window early" close here with one JSDoc line each.

- [ ] **Step 1: Write the failing tests**

Create `maemo-react/packages/core/test/extensions.test.tsx`:

```tsx
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
```

Add to `maemo-react/packages/core/test/renderer.test.tsx`, at the end:

```tsx
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
```

Add to `maemo-react/packages/widgets/test/widgets.test.tsx`, before the last `});`:

```tsx
  test('ToggleButton and CheckButton give the new state to onToggle', () => {
    const t = setup();
    const got: boolean[] = [];
    t.renderer.render(
      <Window>
        <Box>
          <ToggleButton active={false} onToggle={(a) => got.push(a)}>
            Favorite
          </ToggleButton>
          <CheckButton active onToggle={(a) => got.push(a)}>
            Check
          </CheckButton>
        </Box>
      </Window>,
    );
    const [tb] = t.ofType('GtkToggleButton');
    const [cb] = t.ofType('GtkCheckButton');
    expect([t.props(tb).label, t.props(tb).active, t.props(cb).active]).toEqual(['Favorite', false, true]);
    t.poke(tb, 'active', true);
    t.emit(tb, 'toggled');
    t.poke(cb, 'active', false);
    t.emit(cb, 'toggled');
    expect(got).toEqual([true, false]);
  });

  test('Scale is horizontal by default, vertical on request, with 0 digits', () => {
    const t = setup();
    const got: number[] = [];
    t.renderer.render(
      <Window>
        <Box>
          <Scale min={0} max={10} value={3} onChangeValue={(v) => got.push(v)} />
          <Scale vertical digits={1} />
        </Box>
      </Window>,
    );
    const [h] = t.ofType('GtkHScale');
    const [v] = t.ofType('GtkVScale');
    expect([t.props(h).digits, t.props(v).digits]).toEqual([0, 1]);
    t.drag(h, 7);
    expect(got).toEqual([7]);
  });

  test('ComboBox gives the index and the item to onChangeActive', () => {
    const t = setup();
    const got: unknown[] = [];
    t.renderer.render(
      <Window>
        <ComboBox items={['heat', 'cool']} active={0} onChangeActive={(i, item) => got.push([i, item])} />
      </Window>,
    );
    const [c] = t.ofType('GtkComboBox');
    t.poke(c, 'active', 1);
    t.emit(c, 'changed');
    expect(got).toEqual([[1, 'cool']]);
  });

  test('Menu, MenuItem and MenuSeparator make the window menu', () => {
    const t = setup();
    let n = 0;
    t.renderer.render(
      <Window>
        <Box />
        <Menu>
          <MenuItem onActivate={() => n++}>Reconnect</MenuItem>
          <MenuSeparator />
          <MenuItem>About</MenuItem>
        </Menu>
      </Window>,
    );
    const [win] = t.ofType('HildonWindow');
    const [menu] = t.ofType('GtkMenu');
    expect(t.menuOf(win)).toBe(menu);
    const items = t.childrenOf(menu);
    expect(items.map((h) => t.typeOf(h))).toEqual(['GtkMenuItem', 'GtkSeparatorMenuItem', 'GtkMenuItem']);
    expect(t.props(t.childrenOf(items[0])[0])).toMatchObject({ label: 'Reconnect', xalign: 0 });
    t.emit(items[0], 'activate');
    expect(n).toBe(1);
  });
```

and change the import from `'../src/index.js'` to:

```tsx
import { Box, Button, CheckButton, ComboBox, Entry, Label, List, Menu, MenuItem, MenuSeparator, Scale, ScrolledWindow, ToggleButton, Window } from '../src/index.js';
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run packages/core/test/extensions.test.tsx packages/core/test/renderer.test.tsx packages/widgets/test/widgets.test.tsx
```

Expected: the extension tests fail with `t.valueOf is not a function`; the banner test with `t.renderer.banner is not a function`; the widgets tests with missing exports.

- [ ] **Step 3: Extend the fake bridge**

In `maemo-react/packages/core/test/fakeBridge.ts`, add to `interface FakeObject`:

```ts
  /** For a range: the value, clamped to the range. */
  value: number;
  min: number;
  max: number;
  /** For a combo box: the text rows. */
  items: string[];
```

In `create`, add `value: 0, min: 0, max: 0, items: []` to the new object. In the `call` switch, add before `default:`:

```ts
        case 'range.setRange':
          o.min = args[0] as number;
          o.max = args[1] as number;
          return undefined;
        case 'range.setIncrements':
          return undefined;
        case 'range.setValue': {
          const v = Math.min(o.max, Math.max(o.min, args[0] as number));
          if (v !== o.value) {
            o.value = v;
            emit(h, 'value-changed');
          }
          return undefined;
        }
        case 'range.getValue':
          return o.value;
        case 'comboBox.setItems':
          o.items = (args[0] as string[]).slice();
          // GTK: the rows go away, so an active row becomes -1 and changed is emitted.
          if (o.props.active !== undefined && o.props.active !== -1) {
            o.props.active = -1;
            emit(h, 'changed');
          }
          return undefined;
        case 'comboBox.activeText': {
          const i = o.props.active as number | undefined;
          return i === undefined || i < 0 ? null : (o.items[i] ?? null);
        }
```

Add to the returned object, after `tap`:

```ts
    valueOf: (h: Handle) => obj(h).value,
    itemsOf: (h: Handle) => obj(h).items,
    /** Move the slider as the user does; GTK then emits value-changed on the release. */
    drag(h: Handle, value: number) {
      bridge.call(h, 'range.setValue', value);
    },
```

- [ ] **Step 4: Write the extensions and banner**

Create `maemo-react/packages/core/src/extensions.ts`:

```ts
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
    if (!prev || num(prev.min, 0) !== min || num(prev.max, 100) !== max) b.call(h, 'range.setRange', min, max);
    if (!prev || num(prev.step, 1) !== step) b.call(h, 'range.setIncrements', step, step * 10);
    if (typeof next.value === 'number' && b.call(h, 'range.getValue') !== next.value) {
      inst.muted = true; // a value from React is not a user change
      try {
        b.call(h, 'range.setValue', next.value);
      } finally {
        inst.muted = false;
      }
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
    if (prev && sameItems(prev.items, items)) return;
    inst.muted = true; // new rows reset the active row; that is not a user change
    try {
      b.call(inst.handle, 'comboBox.setItems', items);
      // Apply active again now: the generic loop sees no change in the prop.
      if (typeof next.active === 'number') b.set(inst.handle, 'active', next.active);
    } finally {
      inst.muted = false;
    }
  },
};
```

In `maemo-react/packages/core/src/elements.ts`, add `import { COMBO_EXT, RANGE_EXT } from './extensions.js';` after the list import, and change the three rows to:

```ts
  'gtk-hscale': { gtype: 'GtkHScale', children: 'none', ext: RANGE_EXT },
  'gtk-vscale': { gtype: 'GtkVScale', children: 'none', ext: RANGE_EXT },
  'gtk-combo-box': { gtype: 'GtkComboBox', children: 'none', ext: COMBO_EXT },
```

In `maemo-react/packages/core/src/renderer.ts`, add to `interface Renderer`:

```ts
  /** Show a Hildon banner on the newest window. Without a window, log it. */
  banner(text: string): void;
```

and to the returned object of `createRenderer`:

```ts
    banner(text) {
      const w = host.windowHandle();
      if (w === null) {
        console.log('banner: ' + text);
        return;
      }
      bridge.call(w, 'window.banner', text);
    },
```

In `maemo-react/packages/core/src/index.ts`, add after the `flushSync` export:

```ts
/** Show a Hildon banner with the text (hildon_banner_show_information). */
export const banner = renderer.banner;
```

- [ ] **Step 5: Write the widgets**

In `maemo-react/packages/widgets/src/index.tsx`, change the JSDoc of `Window` to:

```tsx
/**
 * A top-level window: a HildonWindow on the tablet. It takes one child and,
 * as a second child, a Menu. Do not pass visible: the renderer shows the
 * window when its content exists.
 */
```

and the JSDoc of `Box` to:

```tsx
/** A row or a column of children. A change of vertical makes a new widget. */
```

Add at the end of the file (after `List`):

```tsx
export type ToggleButtonProps = Omit<El<'gtk-toggle-button'>, 'onToggled'> & {
  /** Called with the new state after each change. */
  onToggle?: (active: boolean) => void;
};

/** A button that stays pressed. The children are its label. */
export function ToggleButton({ onToggle, ...rest }: ToggleButtonProps) {
  return <gtk-toggle-button {...rest} onToggled={onToggle ? (target: WidgetTarget) => onToggle(target.get('active') === true) : undefined} />;
}

export type CheckButtonProps = Omit<El<'gtk-check-button'>, 'onToggled'> & {
  onToggle?: (active: boolean) => void;
};

/** A check box with a label. */
export function CheckButton({ onToggle, ...rest }: CheckButtonProps) {
  return <gtk-check-button {...rest} onToggled={onToggle ? (target: WidgetTarget) => onToggle(target.get('active') === true) : undefined} />;
}

export type ScaleProps = Omit<El<'gtk-hscale'>, 'children'> & {
  /** A vertical slider. Default: horizontal. */
  vertical?: boolean;
};

/**
 * A slider. onChangeValue runs when the user releases it (or changes it with
 * a key), not during the drag. digits defaults to 0: whole numbers.
 */
export function Scale({ vertical = false, digits = 0, ...rest }: ScaleProps) {
  return vertical ? <gtk-vscale digits={digits} {...rest} /> : <gtk-hscale digits={digits} {...rest} />;
}

export type ComboBoxProps = Omit<El<'gtk-combo-box'>, 'onChanged' | 'children'> & {
  /** Called with the index and the item after the user picks a row. */
  onChangeActive?: (index: number, item: string | undefined) => void;
};

/** A drop-down list of text items. active is the index of the chosen item, -1 for none. */
export function ComboBox({ items, onChangeActive, ...rest }: ComboBoxProps) {
  return (
    <gtk-combo-box
      {...rest}
      items={items}
      onChanged={
        onChangeActive
          ? (target: WidgetTarget) => {
              const i = Number(target.get('active'));
              onChangeActive(i, items?.[i]);
            }
          : undefined
      }
    />
  );
}

export type MenuProps = { children?: ReactNode };

/** The menu of a Window. Put it inside the Window, next to the content. */
export function Menu(props: MenuProps) {
  return <gtk-menu {...props} />;
}

export type MenuItemProps = Omit<El<'gtk-menu-item'>, 'children' | 'onActivate'> & {
  children?: string | number | Array<string | number>;
  onActivate?: () => void;
};

/** An item of a Menu. The children are its text. */
export function MenuItem({ children, onActivate, ...rest }: MenuItemProps) {
  return (
    <gtk-menu-item {...rest} onActivate={onActivate ? () => onActivate() : undefined}>
      <gtk-label xalign={0}>{children}</gtk-label>
    </gtk-menu-item>
  );
}

/** A line between menu items. */
export function MenuSeparator() {
  return <gtk-separator-menu-item />;
}
```

In `maemo-react/packages/types/test/check.tsx`, change the widgets import to include `CheckButton, ComboBox, List, Menu, MenuItem, MenuSeparator, Scale, ToggleButton`, add `import { banner } from '@maemo-react/core';` next to the `render` import (one import line: `import { banner, render } from '@maemo-react/core';`), and add inside the `<Box vertical spacing={4} homogeneous>`, after the `<gtk-check-button>` line of Task 4:

```tsx
        <List data={[{ key: 'a', name: 'A', on: true }]} columns={[{ field: 'name', title: 'Name' }, { field: 'on', kind: 'toggle' }]} selected="a" expand onSelect={(k, row) => console.log(k, row?.name)} onToggle={(k, f, v, row) => console.log(k, f, v, row.key)} />
        <Scale min={0} max={100} value={n} onChangeValue={setN} />
        <Scale vertical />
        <ComboBox items={['heat', 'cool']} active={0} onChangeActive={(i, item) => console.log(i, item)} />
        <ToggleButton active onToggle={(a) => console.log(a)}>Favorite</ToggleButton>
        <CheckButton active={false}>Check</CheckButton>
        {/* @ts-expect-error: onToggle gets a boolean */}
        <ToggleButton onToggle={(a: string) => console.log(a)}>x</ToggleButton>
```

and replace the `<gtk-menu>` block of Task 4 (inside the `<Window>`, after `</Box>`) with:

```tsx
      <Menu>
        <MenuItem onActivate={() => banner('Reconnecting')}>Reconnect</MenuItem>
        <MenuSeparator />
        <MenuItem onActivate={() => quit(0)}>Quit</MenuItem>
      </Menu>
```

- [ ] **Step 6: Run the tests**

```bash
npm test
npm run typecheck
```

Expected: every test passes, including the 8 of `extensions.test.tsx`, the banner test and the four new widgets tests; `tsc` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add maemo-react/packages/core/src/extensions.ts maemo-react/packages/core/src/elements.ts maemo-react/packages/core/src/renderer.ts maemo-react/packages/core/src/index.ts maemo-react/packages/core/test/fakeBridge.ts maemo-react/packages/core/test/extensions.test.tsx maemo-react/packages/core/test/renderer.test.tsx maemo-react/packages/widgets/src/index.tsx maemo-react/packages/widgets/test/widgets.test.tsx maemo-react/packages/types/test/check.tsx
git commit -m "Add Scale, ComboBox, ToggleButton, CheckButton, Menu and banner"
```

---

### Task 7: useSyncExternalStore with the renderer

**Files:**
- Modify: `maemo-react/packages/core/test/renderer.test.tsx`
- Modify, only if a test fails: `maemo-react/packages/core/src/hostConfig.ts`

**Interfaces:**
- Consumes: the renderer (Task 4), `useSyncExternalStore` from React 19.
- Produces: proof for HA spec section 6 ("`useSyncExternalStore` works with the renderer: a test in `@maemo-react/core`"). HA Remote's `store.ts` relies on it.

- [ ] **Step 1: Write the tests**

In `maemo-react/packages/core/test/renderer.test.tsx`, add `useSyncExternalStore` to the import from `'react'`, and add at the end of the file:

```tsx
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
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run packages/core/test/renderer.test.tsx
```

Expected: the three tests pass with no change to the host config. If the first test fails with the label still `n=0`, React did not flush the sync lane that the store change schedules: check that `scheduleMicrotask` in `hostConfig.ts` calls `queueMicrotask`, that `supportsMicrotasks` is `true`, and that `resolveUpdatePriority` returns `DefaultEventPriority` outside an event. If the third test fails with one listener left, the passive effects of the unmount did not run: add `reconciler.flushPassiveEffects()` after `flushSyncWork()` in `unmount` of `renderer.ts`.

- [ ] **Step 3: Commit**

```bash
git add maemo-react/packages/core/test/renderer.test.tsx
git commit -m "Test useSyncExternalStore with the renderer"
```

---

### Task 8: React with every M2a component on the real bridge

**Files:**
- Create: `maemo-react/runtime/test/bundles/react-widgets.jsx`
- Test: `maemo-react/runtime/test/generated/react-widgets.test.js` (generated)

**Interfaces:**
- Consumes: everything before. This is the first test of the new components on React 19, the renderer, the bridge and GTK, on both targets.
- Produces: no new interfaces.

- [ ] **Step 1: Write the test bundle**

Create `maemo-react/runtime/test/bundles/react-widgets.jsx`:

```jsx
import { useState } from 'react';
import { banner, render } from '@maemo-react/core';
import { Box, Button, CheckButton, ComboBox, Label, List, Menu, MenuItem, MenuSeparator, Scale, ToggleButton, Window } from '@maemo-react/widgets';
import { call, get, set } from 'maemo:gobject';
import { stats } from 'maemo:debug';
import { test, assertEqual, run } from '../harness.js';

const refs = {};
const events = [];
const before = stats().handles;
const COLUMNS = [{ field: 'name', title: 'Name', expand: true }, { field: 'state' }, { field: 'on', kind: 'toggle' }];

function rows(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ key: 'e' + i, name: 'Entity ' + i, state: 'off', on: i % 3 === 2 ? null : false });
  return out;
}

function App() {
  const [data, setData] = useState(rows(200));
  const [selected, setSelected] = useState(null);
  const [value, setValue] = useState(30);
  const [mode, setMode] = useState(1);
  const [flag, setFlag] = useState(false);
  return (
    <Window title="react-widgets test">
      <Menu>
        <MenuItem ref={(r) => (refs.item = r)} onActivate={() => events.push('menu')}>Reconnect</MenuItem>
        <MenuSeparator />
        <MenuItem onActivate={() => banner('About')}>About</MenuItem>
      </Menu>
      <Box vertical spacing={4}>
        <List
          ref={(r) => (refs.list = r)}
          data={data}
          columns={COLUMNS}
          selected={selected}
          expand
          onSelect={(key) => {
            events.push('select ' + key);
            setSelected(key);
          }}
          onToggle={(key, field, on) => {
            events.push('toggle ' + key + ' ' + on);
            setData(data.map((r) => (r.key === key ? { ...r, on, state: on ? 'on' : 'off' } : r)));
          }}
        />
        <Scale ref={(r) => (refs.scale = r)} min={0} max={100} value={value} onChangeValue={(v) => { events.push('scale ' + v); setValue(v); }} />
        <ComboBox ref={(r) => (refs.combo = r)} items={['heat', 'cool', 'off']} active={mode} onChangeActive={(i, item) => { events.push('combo ' + i + ' ' + item); setMode(i); }} />
        <ToggleButton ref={(r) => (refs.toggle = r)} active={flag} onToggle={(a) => { events.push('toggle-button ' + a); setFlag(a); }}>Favorite</ToggleButton>
        <CheckButton ref={(r) => (refs.check = r)} active={flag} onToggle={setFlag}>Same flag</CheckButton>
        <Label ref={(r) => (refs.status = r)}>{`selected ${selected} value ${value} mode ${mode} flag ${flag} rows ${data.length}`}</Label>
        <Button ref={(r) => (refs.drop = r)} onClick={() => setData(data.filter((r) => r.key !== selected))}>Remove selected</Button>
      </Box>
    </Window>
  );
}

const root = render(<App />);
const status = () => get(refs.status.handle, 'label');
const store = () => get(refs.list.handle, 'model');

test('the list has 200 rows in a GtkListStore, with hidden toggles on every third row', () => {
  assertEqual(call(store(), 'listStore.length'), 200);
  assertEqual(call(store(), 'listStore.get', 2, 0), 'Entity 2');
  assertEqual(call(store(), 'listStore.get', 2, 3), false);
  assertEqual(call(store(), 'listStore.get', 1, 3), true);
  assertEqual(status(), 'selected null value 30 mode 1 flag false rows 200');
});

test('a toggled row changes one store row through React state', () => {
  const toggle = call(refs.list.handle, 'treeView.renderer', 2);
  call(toggle, 'object.emit', 'toggled', '4');
  assertEqual(events.pop(), 'toggle e4 true');
  assertEqual([call(store(), 'listStore.get', 4, 1), call(store(), 'listStore.get', 4, 2)], ['on', true]);
  assertEqual(call(store(), 'listStore.get', 3, 1), 'off');
});

test('a selection goes through React state and back to the view', () => {
  call(refs.list.handle, 'treeView.selectIndex', 7); // as a tap does
  assertEqual(events.pop(), 'select e7');
  assertEqual(call(refs.list.handle, 'treeView.selectedIndex'), 7);
  assertEqual(status(), 'selected e7 value 30 mode 1 flag false rows 200');
});

test('a handler that removes the selected row', async () => {
  call(refs.drop.handle, 'button.clicked');
  assertEqual(call(store(), 'listStore.length'), 199);
  assertEqual(call(refs.list.handle, 'treeView.selectedIndex'), -1);
  await new Promise((r) => setTimeout(r, 0));
  assertEqual(events.pop(), 'select null');
  assertEqual(status(), 'selected null value 30 mode 1 flag false rows 199');
});

test('the scale reports a value change, and follows its prop', () => {
  assertEqual(call(refs.scale.handle, 'range.getValue'), 30);
  call(refs.scale.handle, 'range.setValue', 55); // GTK does this on the release
  assertEqual(events.pop(), 'scale 55');
  assertEqual(status(), 'selected null value 55 mode 1 flag false rows 199');
});

test('the combo box reports the chosen row', () => {
  assertEqual(call(refs.combo.handle, 'comboBox.activeText'), 'cool');
  set(refs.combo.handle, 'active', 2);
  assertEqual(events.pop(), 'combo 2 off');
  assertEqual(status(), 'selected null value 55 mode 2 flag false rows 199');
});

test('the toggle button and the check button share one state', () => {
  set(refs.toggle.handle, 'active', true);
  assertEqual(events.pop(), 'toggle-button true');
  assertEqual(get(refs.check.handle, 'active'), true);
  assertEqual(status(), 'selected null value 55 mode 2 flag true rows 199');
});

test('a menu item activates, and a banner shows', () => {
  call(refs.item.handle, 'object.emit', 'activate');
  assertEqual(events.pop(), 'menu');
  banner('Saved');
});

test('unmount releases every handle', () => {
  root.unmount();
  assertEqual(stats().handles, before);
});

await run();
```

- [ ] **Step 2: Bundle it and run it on both targets**

```bash
npm run build:test-bundles
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: every line is `PASS` on both targets, including `test/generated/react-widgets.test.js`. If `unmount releases every handle` fails with one handle too many, the `GtkTreeSelection` or a renderer handle stayed: check that `destroyInstance` destroys `inst.extra` (Task 4) and that `treeView.renderer` gave the handle that `inst.extra` already holds (`mr_handle_for` returns the existing handle). If a GTK critical appears in `a handler that removes the selected row`, the selection `changed` handler ran during the removal: check that `applyData` runs with `inst.muted` set (Task 5).

- [ ] **Step 3: Commit**

```bash
git add maemo-react/runtime/test/bundles/react-widgets.jsx
git commit -m "Test the M2a components with React on the real bridge on both targets"
```

---

### Task 9: The widgets example, and the check in the emulator

**Files:**
- Create: `maemo-react/examples/widgets/{app.json,package.json,tsconfig.json,src/main.tsx,src/store.ts,src/App.tsx}`
- Modify: `maemo-react/package.json` (the `typecheck` script)
- Modify: `maemo-react/README.md`

**Interfaces:**
- Consumes: every component of Tasks 5 and 6, `banner`, `useSyncExternalStore` (Task 7); `devhost/emulator-run.sh`; the runtime package 0.2.0 (Task 1).
- Produces: `examples/widgets`: a window with a menu, a list of 30 entities with a toggle, a detail panel with a brightness `Scale`, a mode `ComboBox`, a `ToggleButton` and a `CheckButton`, in the shape of the HA Remote main screen (HA spec section 2). The rows live in a small external store that the UI reads with `useSyncExternalStore`. With `--smoke` it prints `WIDGETS-SMOKE ok <rows> rows` after the first render and quits after 2 s (with `--stay`, it stays). `docs/widgets-emulator.png` shows it in the emulator.

- [ ] **Step 1: Write the example**

Create `maemo-react/examples/widgets/app.json`:

```json
{
  "id": "maemo-react-widgets",
  "name": "React Widgets",
  "version": "0.1.0",
  "description": "Every M2a component of maemo-react in one window"
}
```

Create `maemo-react/examples/widgets/package.json`:

```json
{
  "name": "maemo-react-widgets",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "maemo-react build",
    "package": "maemo-react package",
    "deploy": "maemo-react deploy",
    "typecheck": "tsc"
  },
  "dependencies": {
    "@maemo-react/core": "0.1.0",
    "@maemo-react/widgets": "0.1.0",
    "react": "19.3.0"
  },
  "devDependencies": {
    "@maemo-react/cli": "0.1.0",
    "@maemo-react/types": "0.1.0"
  }
}
```

Create `maemo-react/examples/widgets/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "es2020",
    "types": ["@maemo-react/types"]
  },
  "include": ["src"]
}
```

Create `maemo-react/examples/widgets/src/main.tsx`:

```tsx
import { render } from '@maemo-react/core';
import { App } from './App.js';

render(<App />);
```

Create `maemo-react/examples/widgets/src/store.ts`. It has the shape of HA Remote's `store.ts` (HA spec section 3): one object, listeners, no React:

```ts
// The rows of the example, outside React. The UI reads them with
// useSyncExternalStore, as HA Remote reads its store.
import type { ListRow } from '@maemo-react/widgets';

export interface Entity extends ListRow {
  name: string;
  state: string;
  /** true or false for a light or a switch; null for a device with no toggle. */
  on: boolean | null;
  brightness: number;
  mode: number;
}

const MODES = ['heat', 'cool', 'off'];

function makeEntities(): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < 30; i++) {
    const light = i % 3 !== 2;
    out.push({
      key: 'entity.' + i,
      name: (light ? 'Light ' : 'Thermostat ') + i,
      state: light ? 'off' : '21.0 °C ' + MODES[i % 3],
      on: light ? false : null,
      brightness: 50,
      mode: i % 3,
    });
  }
  return out;
}

let entities = makeEntities();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export const store = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get: () => entities,
  modes: MODES,
  update(key: string, patch: Partial<Entity>) {
    entities = entities.map((e) => (e.key === key ? { ...e, ...patch } : e));
    notify();
  },
  toggle(key: string, on: boolean) {
    store.update(key, { on, state: on ? 'on' : 'off' });
  },
  remove(key: string) {
    entities = entities.filter((e) => e.key !== key);
    notify();
  },
  add() {
    const i = entities.length;
    entities = [...entities, { key: 'entity.new.' + Date.now(), name: 'Light ' + i, state: 'off', on: false, brightness: 50, mode: 0 }];
    notify();
  },
};
```

Create `maemo-react/examples/widgets/src/App.tsx`:

```tsx
import { useEffect, useState, useSyncExternalStore } from 'react';
import { args, quit } from 'maemo:app';
import { banner } from '@maemo-react/core';
import {
  Box, Button, CheckButton, ComboBox, Label, List, Menu, MenuItem, MenuSeparator, Scale, ToggleButton, Window, type ListColumn,
} from '@maemo-react/widgets';
import { store, type Entity } from './store.js';

const SMOKE = args.includes('--smoke');
const STAY = args.includes('--stay');

const COLUMNS: ListColumn[] = [
  { field: 'name', expand: true },
  { field: 'state' },
  { field: 'on', kind: 'toggle' },
];

function Detail({ entity, favorite, onFavorite }: { entity: Entity; favorite: boolean; onFavorite: (on: boolean) => void }) {
  return (
    <Box vertical spacing={6}>
      <Label>{entity.name}</Label>
      {entity.on === null ? (
        <Box vertical spacing={4}>
          <Label>Mode</Label>
          <ComboBox items={store.modes} active={entity.mode} onChangeActive={(i) => store.update(entity.key, { mode: i, state: '21.0 °C ' + store.modes[i] })} />
        </Box>
      ) : (
        <Box vertical spacing={4}>
          <Label>{'Brightness ' + entity.brightness + ' %'}</Label>
          <Scale min={0} max={100} value={entity.brightness} onChangeValue={(v) => store.update(entity.key, { brightness: v })} />
        </Box>
      )}
      <ToggleButton active={favorite} onToggle={onFavorite}>
        Favorite
      </ToggleButton>
      <CheckButton active={favorite} onToggle={onFavorite}>
        Show on the first page
      </CheckButton>
      <Button onClick={() => store.remove(entity.key)}>Remove</Button>
    </Box>
  );
}

export function App() {
  const entities = useSyncExternalStore(store.subscribe, store.get);
  const [selected, setSelected] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const entity = selected === null ? null : (entities.find((e) => e.key === selected) ?? null);

  useEffect(() => {
    if (!SMOKE) return;
    console.log('WIDGETS-SMOKE ok ' + entities.length + ' rows');
    if (!STAY) setTimeout(() => quit(0), 2000);
  }, []);

  const setFavorite = (on: boolean) => {
    if (entity === null) return;
    const next = new Set(favorites);
    if (on) next.add(entity.key);
    else next.delete(entity.key);
    setFavorites(next);
  };

  return (
    <Window title="React Widgets">
      <Menu>
        <MenuItem onActivate={() => store.add()}>Add a light</MenuItem>
        <MenuItem onActivate={() => banner('Reconnecting...')}>Reconnect</MenuItem>
        <MenuSeparator />
        <MenuItem onActivate={() => quit(0)}>Quit</MenuItem>
      </Menu>
      <Box spacing={8}>
        <List
          data={entities}
          columns={COLUMNS}
          selected={selected}
          expand
          onSelect={(key) => setSelected(key)}
          onToggle={(key, _field, on) => store.toggle(key, on)}
        />
        <Box vertical spacing={6} widthRequest={240}>
          {entity ? <Detail entity={entity} favorite={favorites.has(entity.key)} onFavorite={setFavorite} /> : <Label>Select an entity</Label>}
          <Label>{entities.length + ' entities, ' + favorites.size + ' favorites'}</Label>
        </Box>
      </Box>
    </Window>
  );
}
```

In `maemo-react/package.json`, change the `typecheck` script to:

```
"typecheck": "tsc -p packages/types/test && tsc -p packages/cli && tsc -p examples/hello && tsc -p examples/bench && tsc -p examples/widgets"
```

- [ ] **Step 2: Build, package and type-check**

```bash
npm install
npm run build:cli
npm run typecheck
(cd examples/widgets && npm run package)
```

Expected: `tsc` prints nothing; `examples/widgets/dist/maemo-react-widgets_0.1.0_all.deb` exists. `dpkg-deb -I examples/widgets/dist/maemo-react-widgets_0.1.0_all.deb | grep Depends` prints `Depends: maemo-react-runtime (>= 0.2.0)`.

- [ ] **Step 3: Run it under qemu-user with the Diablo libraries**

```bash
devhost/run.sh 'export DISPLAY=:99; (Xvfb :99 >/dev/null 2>&1 &); sleep 1; qemu-arm -L /work/sysroot-diablo -E LD_LIBRARY_PATH=/work/out/opt/n810-modern/lib runtime/build/diablo/bin/maemo-react-host examples/widgets/dist/app.js --smoke'
```

Expected: `WIDGETS-SMOKE ok 30 rows`, exit code 0, no GTK critical warning.

- [ ] **Step 4: Build the runtime package and run the example in the emulator**

```bash
devhost/run.sh 'runtime/build.sh diablo deb && cp examples/widgets/dist/maemo-react-widgets_0.1.0_all.deb runtime/dist/ && SHOT=docs/widgets-emulator.png MR_DEBS="/work/rel-1.2/n810-modern-tls_1.1_armel.deb runtime/dist/maemo-react-runtime_0.2.0_armel.deb runtime/dist/maemo-react-widgets_0.1.0_all.deb" devhost/emulator-run.sh runtime/test/emulator "/opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/maemo-react-widgets/app.js --smoke --stay"'
```

Expected, after about 5 minutes: the three `dpkg -i` runs end with `Setting up ...`; `WIDGETS-SMOKE ok 30 rows`; `MR-END rc=0`. Open `docs/widgets-emulator.png`: it shows the "React Widgets" window with the list of entities on the left (check boxes on the light rows, none on the thermostat rows) and "Select an entity" on the right. Send the screenshot to your human partner. The menu and the banner are not in the screenshot: the suite does not press the menu key. Task 10 checks them on the tablet.

- [ ] **Step 5: Update the README**

In `maemo-react/README.md`, change the runtime line to:

```
The tablet needs `maemo-react-runtime` once:
`npx maemo-react deploy <path>/maemo-react-runtime_0.2.0_armel.deb --host <tablet address>`.
```

and the last paragraph to:

```
See `examples/hello` (fetch over HTTPS; `docs/hello-emulator.png` shows it in
the emulator), `examples/widgets` (every M2a component: `List`, `Scale`,
`ComboBox`, `ToggleButton`, `CheckButton`, `Menu` and `banner()`;
`docs/widgets-emulator.png` shows it) and `examples/bench` (the frame
benchmark). `docs/benchmarks.md` has the results from a real N810.
```

- [ ] **Step 6: Commit**

```bash
git add maemo-react/examples/widgets/app.json maemo-react/examples/widgets/package.json maemo-react/examples/widgets/tsconfig.json maemo-react/examples/widgets/src maemo-react/package.json maemo-react/package-lock.json maemo-react/README.md maemo-react/docs/widgets-emulator.png
git commit -m "Add the widgets example and check it in the emulator"
```

---

### Task 10: The List benchmark, the tablet checks, and the 165 MHz run

**Files:**
- Modify: `maemo-react/examples/bench/src/App.tsx`
- Modify: `maemo-react/docs/benchmarks.md`

**Interfaces:**
- Consumes: `List` (Task 5); the runtime package 0.2.0 and the examples (Task 9); the tablet (SSH on port 2222, R&D mode for `sudo gainroot`).
- Produces: `examples/bench` gains the modes `tree` (200 rows in a `List`, every row changes at each step, like `list`) and `tree1` (one row of 200 changes at each step, the HA Remote case). `--auto` runs `counter` x100, `list` x10, `tree` x10 and `tree1` x100, prints one `BENCH {json}` line for each, and quits. `docs/benchmarks.md` gets the M2a table, the 165 MHz row that spec section 14 asks for, and two corrections.

The deferred findings N3 (the 165 MHz estimate is 75 ms, not 72) and N4 (the probe's list column has no recorded clock) close here. The open item 1 of `docs/benchmarks.md` (the 165 MHz run) closes here.

- [ ] **Step 1: Add the tree modes to the benchmark**

In `maemo-react/examples/bench/src/App.tsx`, change the widgets import to:

```tsx
import { Box, Button, Label, List, ScrolledWindow, Window, type ListColumn, type ListRow } from '@maemo-react/widgets';
```

Change `type Mode = 'counter' | 'list';` to `type Mode = 'counter' | 'list' | 'tree' | 'tree1';`. The box-based list has the name of the new widget: change `function List({ n }: { n: number }) {` to `function BoxList({ n }: { n: number }) {`. Add after it:

```tsx
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
```

In `App`, add after `const step = useRef<WidgetTarget | null>(null);`:

```tsx
  const treeData = useRef<ListRow[] | null>(null);
  const isTree = mode === 'tree' || mode === 'tree1';
  treeData.current = isTree ? treeRows(n, mode === 'tree1', treeData.current) : null;
```

Change the `--auto` effect to:

```tsx
  useEffect(() => {
    if (args.includes('--auto')) {
      run('counter', 100, () => run('list', 10, () => run('tree', 10, () => run('tree1', 100, () => quit(0)))));
    }
  }, []);
```

Change the button row and the mode lines of the returned tree to:

```tsx
        <Box spacing={6}>
          <Button onClick={() => run('counter', 100)}>Counter x100</Button>
          <Button onClick={() => run('list', 10)}>List of 200 x10</Button>
          <Button onClick={() => run('tree', 10)}>Tree of 200 x10</Button>
          <Button onClick={() => run('tree1', 100)}>Tree 1 row x100</Button>
        </Box>
```

and

```tsx
        {mode === 'counter' ? <Counter n={n} /> : null}
        {mode === 'list' ? <BoxList n={n} /> : null}
        {isTree ? <TreeList data={treeData.current!} /> : null}
```

Build and check it on the desktop host:

```bash
npm run typecheck
(cd examples/bench && npm run package)
devhost/run.sh 'runtime/build.sh desktop && export DISPLAY=:99; (Xvfb :99 >/dev/null 2>&1 &); sleep 1; runtime/build/desktop/bin/maemo-react-host examples/bench/dist/app.js --auto | grep "^BENCH"'
```

Expected: four `BENCH` lines, with `"mode":"counter"`, `"list"`, `"tree"` and `"tree1"`. The desktop numbers are not recorded.

- [ ] **Step 2: Deploy the runtime and the examples to the tablet**

This step and the next ones need the tablet on the network, with the n810-modern SSH server and R&D mode. Ask your human partner to turn it on, and to give its address if it is not `<tablet-ip>`. The runtime must be the 0.2.0 package: the examples depend on it.

```bash
cd examples/widgets
npx maemo-react deploy ../../runtime/dist/maemo-react-runtime_0.2.0_armel.deb --host <tablet-ip>
npm run deploy -- --host <tablet-ip>
(cd ../bench && npm run deploy -- --host <tablet-ip>)
ssh -p 2222 user@<tablet-ip> '. /etc/osso-af-init/af-defines.sh; DISPLAY=:0 /opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/maemo-react-widgets/app.js --smoke'
```

Expected: the three installs end with `Setting up ...`; then `WIDGETS-SMOKE ok 30 rows`, and the window shows on the tablet for 2 s.

- [ ] **Step 3: Check the components by hand on the tablet**

Ask your human partner to open "React Widgets" from the Extras menu and to check these points. Each one is a behaviour that qemu-user and the emulator cannot show:

1. A tap on a row selects it, and the detail panel shows its name (Maemo's GtkTreeView selects on a tap).
2. A tap on a check box in the list changes the row to "on" at once.
3. A drag of the brightness slider: the "Brightness" label changes only when the finger lifts, not during the drag (`update-policy` discontinuous on Maemo's GTK).
4. The mode combo box opens a Hildon list and the state text follows the choice.
5. The "Favorite" toggle button and the check box stay equal.
6. The hardware Menu key opens the window menu with "Add a light", "Reconnect", a line, and "Quit". "Reconnect" shows the banner "Reconnecting..." at the top of the screen.
7. "Remove" on the selected entity: the row goes away, the panel shows "Select an entity".

Write the result of each point in the final report. If point 3 fails (the label changes during the drag), Maemo's GtkRange ignores the policy: change `RANGE_EXT` in `packages/core/src/extensions.ts` to connect `button-release-event` in place of `value-changed`, keep the `value-changed` connection for key changes, and test both on the fake. If point 6 shows no banner, read `/var/log/syslog` on the tablet for a `hildon_banner` message and report it.

- [ ] **Step 4: Run the benchmark on the tablet at the default governor and at 165 MHz**

```bash
B='. /etc/osso-af-init/af-defines.sh; DISPLAY=:0 /opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/maemo-react-bench/app.js --auto'
G=/sys/devices/system/cpu/cpu0/cpufreq
ssh -p 2222 user@<tablet-ip> "cat $G/scaling_available_frequencies; cat $G/scaling_governor"
ssh -p 2222 user@<tablet-ip> "$B" | grep '^BENCH'
ssh -p 2222 user@<tablet-ip> "echo 'echo userspace > $G/scaling_governor; echo 165000 > $G/scaling_setspeed' | sudo gainroot; cat $G/scaling_cur_freq; $B | grep '^BENCH'; echo 'echo ondemand > $G/scaling_governor' | sudo gainroot"
```

Expected: the first command lists the available clocks, with `165000` among them, and `ondemand`. If `165000` is not listed, use the lowest listed clock in the third command and in the table. The second command prints four `BENCH` lines with `"cpu":{"governor":"ondemand","kHz":400000}`. The third prints `165000`, then four `BENCH` lines with `"kHz":165000`. The last `sudo gainroot` puts the governor back; check with `cat $G/scaling_governor`.

- [ ] **Step 5: Record the results**

In `maemo-react/docs/benchmarks.md`, make these changes:

1. In the "Comparison with the probe" table, change the header `| Measure | Probe, 400 MHz | M1, 400 MHz | Ratio |` to `| Measure | Probe | M1, 400 MHz | Ratio |`, and add after the table: `The probe's counter rows are at 400 MHz. The spec gives no clock for the probe's list rows; under load, ondemand probably held 400 MHz.`
2. Change `the counter takes about 72 ms at 165 MHz` to `the counter takes about 75 ms at 165 MHz`.
3. Add before "## Open items for M2" a section from this template, with the date of the run in the heading and the median and p95 values of the eight `BENCH` lines in the cells:

```markdown
## M2a, measured on <the date of the run, YYYY-MM-DD>

`examples/bench --auto` with the four modes. `tree` is the 200-row `List` on
`GtkTreeView` where every row changes at each step, like `list`. `tree1`
changes one row of 200 at each step: the HA Remote case. The `userspace` rows
hold the clock at 165 MHz (`scaling_setspeed`).

| Test | Governor | Clock | Total median | Total p95 | JS median | GTK median | Paint median |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Counter x100 | ondemand | 400 MHz | | | | | |
| List of 200 x10 (boxes) | ondemand | 400 MHz | | | | | |
| Tree of 200 x10 | ondemand | 400 MHz | | | | | |
| Tree 1 row x100 | ondemand | 400 MHz | | | | | |
| Counter x100 | userspace | 165 MHz | | | | | |
| List of 200 x10 (boxes) | userspace | 165 MHz | | | | | |
| Tree of 200 x10 | userspace | 165 MHz | | | | | |
| Tree 1 row x100 | userspace | 165 MHz | | | | | |

All times are in milliseconds. The rows with n=10 have a p95 equal to the
maximum. The `cpu` field of each `BENCH` line gave the clock.

The spec asks that a simple update paints in less than 50 ms at 165 MHz
(section 14). The counter row at 165 MHz <meets / does not meet> that target.
The `tree1` row is the update that HA Remote makes when one entity changes;
it <meets / does not meet> the target at 165 MHz.
```

Fill the two `<meets / does not meet>` phrases from the numbers.

4. Replace the "Open items for M2" list with:

```markdown
## Open items for M2b

1. Find the cause of the gap to the probe. The candidates are:
   - react-reconciler 0.34 in the interpreter (the probe used React 18).
   - the allocations of `applyProps` at each update.
   - the layout of the label after each text change.
2. Time `js_set` alone on the tablet.
3. If `tree` (200 `listStore.set` calls at each step) is still far from the
   probe's list, add a `listStore.setRow` helper that sets a whole row in one
   call, and measure again.
4. `bridgeTime()` counts a signal handler twice when the handler runs inside a
   helper that is not marked "emits". This affects only the GTK column, and
   only if a handler is connected to `show` or `hide`.
```

- [ ] **Step 6: Commit**

```bash
git add maemo-react/examples/bench/src/App.tsx maemo-react/docs/benchmarks.md
git commit -m "Benchmark List on the tablet, at 400 and at 165 MHz"
```

---

## Deferred findings from M1 in this plan

From `docs/m1-deferred-findings.md`. Included, because the task changes the file and the fix is small:

| Item | Task |
| --- | --- |
| T6 interface-typed properties cannot be converted | 1 |
| T5 `--compile` keeps the 256 KB default stack | 1 |
| T6 `mr_type_from_name` and acronym types: noted; no new class is affected | 4 |
| T12 `typegen/run.sh` leaves `gtk.json.tmp` | 4 |
| T12 no automated ELEMENTS check: closed before this plan by commit `6ad8381` | 4 |
| T13 Box remounts when `vertical` changes: one JSDoc line | 6 |
| T11 explicit `visible={true}` on a Window: one JSDoc line | 6 |
| N3 the 165 MHz estimate is 75 ms | 10 |
| N4 the probe's list column has no recorded clock | 10 |
| T16 "n=10" in the table: already in `benchmarks.md` | - |
| T7 `bridgeTime()` double count: already noted in `benchmarks.md` | - |

Not included, with the reason: N5 (`js_set` converts twice on failure) changes the signature of `mr_js_to_gvalue` for every caller; T11 (a warning for child props under a non-box parent) would warn on `<ScrolledWindow expand>` inside a window, which is common; T3 (`emulator-run.sh` nits) and T8 (`build.sh` and the prelude) touch files that this plan does not change; T7 (an ASan desktop build) is M2b.
