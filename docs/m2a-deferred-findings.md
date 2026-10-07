# M2a deferred findings and pending steps

The reviews of M2a found these items and deferred them. They are small or
theoretical. Fix an item when you work on the file that it names.

## Open: needs the tablet

- A whole-window unmount on Hildon destroys the menu before the window.
  `hildon_window_destroy` may keep a reference to the destroyed `GtkMenu`. A
  `--test` run on the tablet with a leak check, or a read of `hildon-window.c`
  2.0.6, settles it. HA Remote does not unmount its window before it quits.

## From the reviews

| Task | Deferred minor | Verdict | Reason |
| --- | --- | --- | --- |
| T1 | no test of the 1 MB `--compile` stack with a large bundle | stay deferred | the examples compile on the tablet; a test needs a synthetic large bundle |
| T2 | a second `setColumnTypes` gives a GTK critical | stay deferred | `LIST_EXT` calls it once per create; a change of columns is an error before the call |
| T2 | `selectedIndex` asserts in `GTK_SELECTION_MULTIPLE` | stay deferred | the List uses single selection; no API sets the mode |
| T2 | `arg_int` truncates 1.5 and NaN; `arg_array_length` ignores a failure | stay deferred | the renderer passes integers and arrays; `JS_ToUint32` of `length` cannot fail for an array |
| T2 | no tests for a second `setColumnTypes`, a bad `addAttribute`, an empty-column renderer | stay deferred | error paths of misuse that the renderer prevents |
| T3 | `comboBox.setItems` half-fills on a bad item | stay deferred | the types allow only strings |
| T3 | banner test does not assert the desktop stderr line; replace test reuses the menu; no right-click test | stay deferred | the desktop popup is a dev-host convenience; the banner is checked in the emulator screenshot |
| T4 | a second `<gtk-menu>` under one window replaces the first silently | stay deferred | document it in the `Window` JSDoc when next touched; one menu per window is the Hildon model |
| T4 | `windowHandle()` counts hidden windows | stay deferred | `Window` tells the developer not to pass `visible`; a banner on a hidden window is a no-op |
| T4 | the "newest window" test uses a separate host; no two-window test; no test that `destroyInstance` mutes | stay deferred | the probe in this review and the real-bridge unmount cover the mute path |
| T4 | `extensionKeys` parses `EXTENSION_TYPES` by regex; `muted` blocks `onDestroy` on React destroy | stay deferred | the regex has a test; no component uses `onDestroy` (the toplevel hook is a raw connect) |
| T5 | the selection microtask runs on every update | stay deferred | one bridge read for each commit; measure in M3 if the tablet shows it |
| T5 | fake `listStore.move` does not check its indexes; `ListColumn`/`ListRow` in two places; a column `expand` change is ignored | stay deferred | the first is a fake; the second is by design (types vs core); the third is documented ("columns are read at mount") |
| T6 | an uncontrolled `ComboBox` loses its selection when items change | stay deferred | document: give `active` (HA Remote does) |
| T7 | "renders in a microtask" waits with `setTimeout(0)` | stay deferred | the test still proves the render happens outside a handler |
| T8 | the regex does not tie "selected e0" to `selectedIndex`; stale "select e0" in events; no GTK readback after a React set | stay deferred | the Diablo auto-select is accepted by ruling; the probe in this review read GTK back for the combo |
| T9 | `CheckButton` label cut at 240 px; `store.add` key from `Date.now()`; `useEffect` deps | stay deferred | example code; the screenshot shows the cut and a fix needs an emulator run |
| T10 | `treeData` ref written during render; the heard formula gives no change for one `tree1` sample; long line | stay deferred | plan-mandated bench code; one of 100 samples does not move the median |
