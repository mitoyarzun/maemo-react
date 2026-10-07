# maemo-react benchmarks

Measured on a Nokia N810 (RX-44, Diablo-Turbo, n810-modern PREEMPT backport
kernel) with `examples/bench --auto`. One update every 50 ms from a timer,
timed from the click to the end of the paint (spec section 11).

## M1, measured on 2026-10-06

| Test | Governor | Total median | Total p95 | JS median | GTK median | Paint median |
| --- | --- | --- | --- | --- | --- | --- |
| Counter x100 | ondemand | 29.8 | 31.6 | 16 | 3.9 | 9.8 |
| Counter x100 | performance | 29.4 | 31.3 | 15.7 | 3.9 | 9.7 |
| List of 200 x10 | ondemand | 994.6 | 1154 | 824.1 | 84.6 | 84.9 |
| List of 200 x10 | performance | 990.5 | 1138.8 | 824.1 | 85.5 | 82.2 |

All times are in milliseconds. The CPU ran at 400 MHz in all four runs. The
"list" rows have n=10, so the p95 is the same as the maximum.

The benchmark load keeps the `ondemand` governor at the top clock. The
`ondemand` and `performance` rows are therefore one measurement, made twice.

The first paint is done before the loop starts: the benchmark waits 500 ms and
calls `flushPaint()`. Spec section 11 says to start after the first
`expose-event`. The result is the same on the tablet.

The recorded rows use the old sampling: `cpu()` ran once after the loop, not
during it. The table does not change, because the clock was at 400 MHz. Run
the tablet again to record the new sampling.

## Comparison with the probe

The probe (spec appendix A) is the React 18 prototype on the same N810. All
values are in milliseconds.

| Measure | Probe | M1, 400 MHz | Ratio |
| --- | --- | --- | --- |
| Counter, total | 12.6 | 29.8 | 2.4 |
| Counter, JavaScript | 5.8 | 16 | 2.8 |
| Counter, GTK setters | 0.4 | 3.9 | about 10 |
| Counter, layout and paint | 6.4 | 9.8 | 1.5 |
| List of 200, total | 635 | 994.6 | 1.6 |
| List of 200, JavaScript | 510 | 824.1 | 1.6 |
| List of 200, GTK setters | 59 | 84.6 | 1.4 |
| List of 200, layout and paint | 65 | 84.9 | 1.3 |

The probe's counter rows are at 400 MHz. The spec gives no clock for the probe's list rows; under load, ondemand probably held 400 MHz.

The probe measured the counter at 31.8 ms at 165 MHz. The probe ratio between
400 and 165 MHz is 2.5.

The spec asks that a simple update paints in less than 50 ms at 165 MHz. This
target is NOT measured. All four runs used 400 MHz. If the 2.5 ratio holds, the
counter takes about 75 ms at 165 MHz. That is over the target.

The M1 runtime is slower than the probe in every row. The gap is largest in
the GTK setters of the counter (about 10 times).

## M2a, measured on 2026-10-06

`examples/bench --auto` with the four modes, on the runtime 0.2.0. `tree` is
the 200-row `List` on `GtkTreeView` where every row changes at each step, like
`list`. `tree1` changes one row of 200 at each step: the HA Remote case.

The tablet kernel has no `userspace` governor. The `powersave` rows hold the
lowest clock, 165 MHz. Something on the tablet sometimes raises the clock to
400 MHz, also under `powersave`. Each mode samples the clock once during its
loop, so the run was repeated until all four modes reported 165 MHz.

| Test | Governor | Clock | Total median | Total p95 | JS median | GTK median | Paint median |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Counter x100 | ondemand | 400 MHz | 33.8 | 36.6 | 20.7 | 3.5 | 9.5 |
| List of 200 x10 (boxes) | ondemand | 400 MHz | 1034.8 | 1186.5 | 872.8 | 79.7 | 81.7 |
| Tree of 200 x10 | ondemand | 400 MHz | 297.5 | 304.3 | 111.5 | 99.6 | 89.6 |
| Tree 1 row x100 | ondemand | 400 MHz | 55.7 | 58.8 | 44.6 | 3.6 | 7.3 |
| Counter x100 | powersave | 165 MHz | 86.1 | 92.3 | 53.1 | 8.4 | 24 |
| List of 200 x10 (boxes) | powersave | 165 MHz | 2693.6 | 3006.8 | 2273.4 | 203.1 | 213.2 |
| Tree of 200 x10 | powersave | 165 MHz | 581.1 | 604.8 | 291.2 | 257.6 | 31.7 |
| Tree 1 row x100 | powersave | 165 MHz | 143.5 | 152.4 | 115.6 | 9 | 18.5 |

All times are in milliseconds. The rows with n=10 have a p95 equal to the
maximum. The `cpu` field of each `BENCH` line gave the clock.

A `List` update of 200 changed rows is 3.5 times faster than the box list at
400 MHz, and 4.6 times faster at 165 MHz.

The spec asks that a simple update paints in less than 50 ms at 165 MHz
(section 14). The counter row at 165 MHz (86 ms) does not meet that target.
The `tree1` row is the update that HA Remote makes when one entity changes; it
does not meet the target at 165 MHz (144 ms). JavaScript is most of the time:
116 ms of the 144 ms. The earlier estimate of 75 ms for the counter was too
low.

The hand checks of `examples/widgets` on the tablet passed (Task 10 Step 3):
tap to select, the toggle column, the brightness `Scale` reports on release
(`update-policy` works on Maemo's GTK), the mode `ComboBox`, the shared
favorite state, the hardware Menu key with the "Reconnect" banner, and
"Remove". At start, Diablo's GtkTreeView selects "Light 0" by itself.

## Open items for M2b

1. Make the JavaScript part of an update faster: at 165 MHz, a change of one
   row in a 200-row `List` takes 116 ms of JavaScript. The candidates are:
   - react-reconciler 0.34 in the interpreter (the probe used React 18).
   - the work of `LIST_EXT` for each update: it walks all 200 keys and builds
     a `Set` even when one row changed.
   - the allocations of `applyProps` at each update.
   - the layout of the label after each text change.
2. Time `js_set` alone on the tablet.
3. `bridgeTime()` counts a signal handler twice when the handler runs inside a
   helper that is not marked "emits". This affects only the GTK column, and
   only if a handler is connected to `show` or `hide`.
