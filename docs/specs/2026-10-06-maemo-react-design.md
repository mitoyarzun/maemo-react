# maemo-react: design

Date: 2026-10-06. Status: draft for review.

maemo-react lets you write applications for Maemo 4.1 (Diablo) in React and
TypeScript. The applications draw native GTK 2 and Hildon widgets. A small C
host runs the JavaScript in QuickJS on the GLib main loop of the tablet.

The library starts in the `maemo-react/` directory of n810-modern. It will
move to its own repository later. Everything in `maemo-react/` must build and
test without files from outside it, except `tools/env.sh` and the sysroot.

## 1. Goals and non-goals

### Goals

- Write Maemo applications with React function components, hooks and
  TypeScript.
- Use the native Hildon look, menus and input methods.
- Give standard web APIs (`fetch`, `WebSocket`, `URL`, `localStorage`) and
  typed Maemo modules (`maemo:*`).
- Export TypeScript types for every widget and every native module.
- Install the runtime once. Install each application as a small `.deb`.
- Run on the N800 and N810 with Diablo, on the stock kernel and on the
  n810-modern backport kernel.

### Non-goals

- React Native compatibility in the core. A separate `native-compat` package
  can come later (milestone M6).
- CSS, a browser engine, or a DOM.
- Maemo 5 (Fremantle) support now. The design keeps it possible (section 10).
- Web Workers, HTTP/2, streaming response bodies, and SQLite in version 1.

## 2. Decisions and evidence

| Decision | Reason |
| --- | --- |
| QuickJS, not Hermes or V8 | QuickJS is C and compiles against glibc 2.5 with one change (`CONFIG_ATOMICS` off). Hermes and V8 need ARMv7 and C++. |
| Native GTK widgets, not LVGL | Measured: GTK updates are 3–5 times faster than LVGLJS, and use 1.5 MB less memory. GTK gives the Hildon look and input methods. LVGLJS needs a maintained fork (appendix A). |
| A generic GObject bridge (approach A) | GLib 2.12 gives property and signal metadata at runtime. Most widgets then need no C code. Diablo has no GObject Introspection. |
| C99 only in the runtime | The tablet has only the GCC 3.4 `libstdc++`. A modern `libstdc++` against glibc 2.5 needs a custom toolchain (appendix A). |
| The GLib main loop, not libuv | GTK already runs the GLib loop. libuv needs Linux 3.10 and `eventfd`, which the tablet does not have. |
| React inside each application bundle | Each application can use its own React version. The runtime package contains no JavaScript framework. The cost is about 100 KB for each application. |
| Bytecode compiled on the tablet | The bytecode always matches the installed QuickJS. The development computer needs no ARM tools. |

## 3. Architecture

```
 app.tsx ──esbuild──▶ app.js ──────────────── .deb ─────────────┐
                                                                │
 ┌──────────────────────────── tablet ──────────────────────────▼─────┐
 │ maemo-react-host (C)                                               │
 │  ├─ QuickJS + module loader + bytecode cache                       │
 │  ├─ GLib main loop: timers, microtasks, fd watches, curl multi     │
 │  ├─ maemo:gobject bridge: create, set, get, connect, childSet,     │
 │  │                        call, destroy                            │
 │  ├─ built-in modules: fetch, WebSocket, net, fs, system, notify,   │
 │  │                    crypto, localStorage                         │
 │  ├─ dlopen modules: maemo:gps, maemo:dbus, maemo:audio             │
 │  └─ prelude (JS bytecode): Response, Headers, URL, AbortController │
 │                                                                    │
 │ application bundle (JS):                                           │
 │  @maemo-react/core     reconciler + host config over the bridge    │
 │  @maemo-react/widgets  typed components                            │
 │  application code                                                  │
 └────────────────────────────────────────────────────────────────────┘
```

- One process for each application, with one thread for JavaScript and GTK.
- All input and output runs on the GLib main loop. Calls that block (DNS
  lookup, large file reads) run in a GLib thread and post the result back with
  `g_idle_add`.
- The bridge is the only path from JavaScript to GTK.
- Hildon-specific code is in one place: the Hildon component definitions and
  their C helpers.

## 4. The GObject bridge (`maemo:gobject`)

The bridge is a private native module. Applications use it only through
`@maemo-react/core`.

| Function | Behaviour |
| --- | --- |
| `create(typeName)` | Makes an object with `g_object_new`. Returns an integer handle. The handle table holds one reference (`g_object_ref_sink`). |
| `set(h, prop, value)` / `get(h, prop)` | Converts the value with the `GParamSpec` of the property. |
| `connect(h, signal, fn)` | Connects a generic `GClosure`. The closure converts the signal arguments (from `g_signal_query`) to JavaScript and converts the return value back. Returns the handler id. |
| `childSet(parent, child, prop, value)` | Sets a container child property, for example `expand`, `fill`, `padding` or `pack-type`. |
| `call(h, helper, ...args)` | Runs a hand-written C helper from a registry, for functions that are not properties. Example: `box.reorder`, `treeView.setModel`. |
| `destroy(h)` | Disconnects the closures and releases the reference. A toplevel window also gets `gtk_widget_destroy`. |

### Value conversion

| GType | JavaScript |
| --- | --- |
| `gboolean` | boolean |
| integer types | number (range-checked) |
| `gfloat`, `gdouble` | number |
| `gchararray` | string or `null` |
| enum | nickname string, for example `"automatic"` |
| flags | array of nickname strings |
| GObject | handle |
| `GdkColor` | `"#rrggbb"` string |
| other boxed types | `TypeError` that names the GType |

A new boxed converter is added only when a component needs it.

### Lifetime

- A closure keeps its JavaScript function with `JS_DupValue`. The closure
  invalidate notifier frees the function.
- The renderer calls `destroy` from `detachDeletedInstance`.
- A test checks that 1000 create/destroy cycles do not grow the handle table
  or the QuickJS heap.

## 5. The renderer (`@maemo-react/core`)

- React 19 and the matching `react-reconciler`, in mutation mode. The probe
  used React 18. The host config must use the React 19 signatures.
- A root from `createRoot` for each window.
- One definition table describes each intrinsic element:
  - the GType,
  - the props that are GObject properties,
  - the props that are child properties,
  - the event props and their signals (`onClick` → `clicked`),
  - the children model: `none`, `single`, `box` or `text`.
- Only changed props call `set`. Each event signal is connected once. A
  JavaScript table keeps the newest handler for each widget.
- React's scheduler and microtasks run on the GLib loop. Events from GTK run at
  discrete priority, so a click updates the screen in the same loop iteration.
- `<List data columns>` drives a `GtkTreeView` with a `GtkListStore`. It does
  not use React children, because GTK then draws only the visible rows.
- Errors:
  - An exception in an event handler prints its stack to stderr. In
    development mode, a Hildon banner also shows it.
  - A render error with no error boundary replaces the window content with the
    error and its stack.

## 6. Components (`@maemo-react/widgets`)

| Group | Components |
| --- | --- |
| M1 | `Window` (a `HildonWindow`), `Box`, `Label`, `Button`, `Entry`, `ScrolledWindow` |
| M2 | `TextView`, `Image`, `CheckButton`, `ToggleButton`, `Scale`, `ComboBox`, `ProgressBar`, `List` |
| M2, Hildon | `Menu`, `Toolbar`, `Banner`, `Note`, `FileChooser` |

- Prop types come from the generated widget types (section 8).
- Components give friendly names, for example `<Box vertical>` in place of
  `GtkVBox`.
- A `style` prop accepts a small subset: `color`, `background`, `font`,
  `padding`. It maps to `gtk_widget_modify_*`, Pango and `GtkAlignment`.

## 7. Native modules

### Web-standard globals

`fetch`, `Headers`, `Request`, `Response`, `AbortController`, `WebSocket`,
`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `setTimeout`,
`setInterval`, `queueMicrotask`, `console`, `performance`,
`crypto.getRandomValues`, `crypto.randomUUID`, a `crypto.subtle` subset
(SHA-1, SHA-256, HMAC, AES-GCM), and `localStorage`.

### Maemo modules

| Module | Contents | Built on | Loading |
| --- | --- | --- | --- |
| `maemo:net` | TCP client and server, UDP, DNS lookup | sockets, GLib fd watches | built in |
| `maemo:fs` | read, write, list, stat; `appDataDir`, `documentsDir` | POSIX | built in |
| `maemo:system` | device model, battery, network state, open a URL | sysfs, D-Bus | built in |
| `maemo:notify` | banners, notes, info prints | Hildon | built in |
| `maemo:gps` | position updates | liblocation or gpsd | `dlopen` |
| `maemo:dbus` | method calls and signals | dbus-glib | `dlopen` |
| `maemo:audio` | play, pause, seek, status (MP3, AAC, AMR) | GStreamer 0.10 `playbin` | `dlopen` |

- `appDataDir` is `/home/user/.maemo-react/<app-id>`, on the root file system.
  Use it only for small files.
- `documentsDir` is `/home/user/MyDocs`, on the 2 GB internal card. Use it for
  downloads.

### Rules for every module

- The C part gives primitives. The JavaScript prelude gives the standard shape.
  Example: C runs a curl request and calls back with the status, the headers
  and the data chunks. The prelude builds `Response`.
- No call blocks the main loop. curl runs through its multi interface on GLib
  fd watches.
- `fetch` rejects with `TypeError("Failed to fetch")`. Its `cause` holds the
  curl error. `maemo:*` modules reject with an `Error` that has a `code`, for
  example `ECONNREFUSED`.
- `localStorage` writes to a JSON file in `appDataDir`, during idle time after
  a change.
- TLS always checks certificates against the CA store of `n810-modern-tls`.

## 8. TypeScript types (`@maemo-react/types`)

- **Widget types are generated.** `typegen` runs on the emulator or under
  qemu-user. It calls `g_type_class_ref` for each widget class and reads the
  properties, signals and child properties of GTK 2.10 and Hildon 2.0. The
  output is a `.d.ts` with the JSX intrinsic elements and their props.
- **Module types are hand-written.** Each module folder has `module.c`,
  `module.d.ts` and `module.test.ts`.
- **Web globals** have a hand-written subset of `lib.dom` that lists only what
  the runtime implements.
- **A conformance test** reads each `.d.ts` with the TypeScript compiler API.
  It compares the declared names with the names that the runtime exports. A
  name on one side only fails the build.
- Application templates use `"lib": ["es2023"]` without `dom`.

## 9. Tools

### CLI (`@maemo-react/cli`, Node on the development computer)

| Command | Behaviour |
| --- | --- |
| `create <name>` | Makes an application from a template: TypeScript, React 19, `tsconfig`, `app.json` (id, name, version, icon). |
| `build` | Bundles with esbuild (ES2020, production) into `app.js`. |
| `package` | Makes the application `.deb` in Node (ar and tar). It contains `app.js`, the icon, the `.desktop` file and `Depends: maemo-react-runtime`. |
| `deploy` | Copies the `.deb` over SSH and installs it with `sudo gainroot`. |
| `dev` | Watches, rebuilds, copies the bundle to the development folder on the tablet, restarts the application and streams its log. |
| `run --desktop` | Runs the application in the desktop dev host. |

### Bytecode

- The `postinst` of an application compiles `app.js` to `app.qbc` on the
  tablet. A runtime update compiles all installed applications again.
- The bytecode header records the QuickJS version. If the bytecode is missing
  or stale, the host loads `app.js` and compiles it again.

### Desktop dev host

- The same C host, built against GTK 2.24 in an Ubuntu 24.04 container, with
  Xvfb and VNC.
- A Hildon shim: `HildonWindow` becomes `GtkWindow`, the Hildon menu becomes a
  menu bar, banners print to the log.
- The generated types come from GTK 2.10, so TypeScript rejects props that
  exist only in GTK 2.24.
- The desktop host is for iteration. It does not replace tests on the tablet.

### Packages on the tablet

| Package | Contents |
| --- | --- |
| `maemo-react-runtime` | `/opt/n810-modern/bin/maemo-react-host`, `/opt/n810-modern/lib/maemo-react/` (dlopen modules, prelude bytecode). `Depends: n810-modern-tls`. |
| an application | `/opt/n810-modern/share/maemo-react/apps/<id>/app.js`, the icon, `/usr/share/applications/hildon/<id>.desktop`. `Depends: maemo-react-runtime (>= x.y)`. |

`n810-modern-update` serves both kinds of package.

## 10. Fremantle later

- The bridge, the runtime and the modules use no Hildon 2.0 API.
- Fremantle support needs a second sysroot and toolchain (ARMv7, Maemo 5),
  Hildon 2.2 component definitions and C helpers, and new generated types.
- No other part changes.

## 11. Tests

| Level | What | Where |
| --- | --- | --- |
| 1 | Renderer against a fake bridge that records operations. Prelude behaviour. | Node, Vitest |
| 2 | Bridge value conversion, closures, handle lifetime. | Desktop container; qemu-user with the Diablo sysroot |
| 3 | Type conformance (section 8). | Node, with the runtime under qemu-user |
| 4 | End-to-end: a `--test-socket` option lets a driver read the widget tree, click a widget by `name` and read its text. | Desktop host, emulator, tablet |
| 5 | Benchmarks: the counter and 200-row list from the probe, recorded for each release. | Tablet |

Rules for benchmarks (level 5):

- Start only after the first real paint (`expose-event`).
- Give control back to the main loop after each update. One update every
  50 ms from a GLib timeout.
- Measure from the event to the end of the paint (`gdk_window_process_all_updates`
  and `gdk_flush`). Report the parts: JavaScript, GTK calls, and layout + paint.
- The tablet changes its CPU clock (`ondemand`, 165–400 MHz). Record the
  governor and the clock with each result. Run each benchmark twice: at the
  default governor, and with `performance` (as root).

The emulator runs use boot scripts, as both probes did. Run one QEMU at a time.

## 12. Repository layout

```
maemo-react/
  runtime/     C host, bridge, built-in modules, vendored QuickJS, Makefile
  modules/     dlopen modules: gps, dbus, audio
  prelude/     JS on the C primitives
  packages/    core, widgets, types, cli  (later: native-compat)
  typegen/     widget type generator
  devhost/     Dockerfile and Hildon shim
  examples/    hello, bench  (later: ha-remote)
  docs/        specs, plans, guides
```

## 13. Milestones

| # | Milestone | Done when |
| --- | --- | --- |
| M0 | Skeleton: layout, Makefile on `tools/env.sh`, vendored QuickJS, desktop dev host container, qemu-user test runner. | A C host runs `console.log` from JavaScript on the desktop host, under qemu-user and in the emulator. |
| M1 | First vertical slice: runtime, the full bridge, React 19 renderer, the six M1 components, `fetch`, `URL`, `TextEncoder`, first `typegen` output, CLI `create`, `build`, `package`, `deploy`, test levels 1 and 2. | A `hello` application, installed as a `.deb` by the CLI, fetches JSON over HTTPS and shows it in the emulator and on the tablet. Benchmark numbers are recorded. |
| M2 | Components: `List` first, then the other M2 widgets, the Hildon components, the `style` subset, the error screen, `dev`, the test socket. | A demo application uses every component. `useSyncExternalStore` works. End-to-end tests pass on all three targets. |
| M3 | Showcase: `WebSocket`, `localStorage`, and HA Remote, a Home Assistant client (spec `2026-10-06-ha-remote-design.md`). | HA Remote passes its acceptance test on the tablet, on the LAN and through a remote URL. |
| M4 | The other platform modules: `maemo:net`, `maemo:fs`, `maemo:system`, `maemo:notify`, `crypto`, the conformance test. | Each module has tests on the tablet and complete `.d.ts` files. |
| M5 | Device modules: `maemo:gps`, `maemo:dbus`. `maemo:audio` waits until an application needs it. | A GPS position and a D-Bus call work on the tablet. |
| M6 | Later: `native-compat`, own repository, docs site, Fremantle. | Planned at that time. |

The first implementation plan covers M0 and M1 only.

## 14. Risks

| Risk | Plan |
| --- | --- |
| Lists made of boxes are slow on the tablet: 580 ms for each update of 200 rows (appendix A). | Move `List` (on `GtkTreeView`) to the start of M2. The frame benchmark shows that 80 % of the time is JavaScript, so the fix is fewer React elements, not faster GTK calls. Document a row limit for box-based lists. |
| The CPU clock changes between 165 and 400 MHz, so the same update can take 2.5 times longer. | Record the governor with each benchmark (section 11). Design for the low clock: a simple update must paint in less than 50 ms at 165 MHz. |
| The emulator is about 10 times faster than the tablet. | Take time measurements only on the tablet. Memory measurements from the emulator are valid. |
| React 19 has not run on QuickJS yet. | The first M1 task renders the probe counter with React 19. If it fails, use React 18.3, which the probe proved. |
| `typegen` needs GTK classes at runtime. | Run it under qemu-user with Xvfb, as in the LVGLJS probe. The emulator is the fallback. |
| curl multi on GLib fd watches is new code. | Test it under qemu-user against a local HTTPS server, with timeouts and aborts. |
| Ubuntu may drop `libgtk2.0-dev`. | Pin the dev host image to Ubuntu 24.04. |

## Appendix A: probe results (2026-10-06)

Both probes ran on the real Diablo firmware in QEMU, and then on a real N810
(RX-44, Diablo-Turbo, the n810-modern PREEMPT backport kernel).

### React + QuickJS + GTK 2 (the chosen base)

React 18.3, `react-reconciler` 0.29, QuickJS 2025-09-13, Hildon window.

| Measure | Counter, N810 | 200-row list, N810 | Counter, emulator | 200-row list, emulator |
| --- | --- | --- | --- | --- |
| `gtk_init` + Hildon window | 375 ms | 375 ms | 62 ms | 62 ms |
| Bytecode load | 40 ms | 40 ms | 5 ms | 5 ms |
| Start to first render (bytecode) | 494 ms | 1660 ms | 134 ms | 176 ms |
| Start to first render (source) | 1290 ms | 2420 ms | 318 ms | 322 ms |
| Start to window shown (bytecode) | 632 ms | 2890 ms | 163 ms | 310 ms |
| One state update (median) | 6.0 ms | 580 ms | 0.55 ms | 53–57 ms |
| Resident memory | 7.0 MB | 8.4 MB | 7.0 MB | 8.4 MB |

- The emulator is about 10 times faster than the tablet. Memory is the same.
- GTK and Hildon use 4 MB of the resident memory before JavaScript starts.
- Parsing the 108 KB bundle from source takes 900 ms on the tablet. Loading
  its bytecode takes 40 ms.
- The update times above do not include the paint. The probe ran its updates
  in one blocking loop, so the window did not paint during the benchmark.

Frame benchmark on the N810: one click every 50 ms from the main loop, measured
from the click to the end of the paint (bytecode, median):

| Part | Counter, 400 MHz | Counter, 165 MHz | 200-row list |
| --- | --- | --- | --- |
| Total, click to painted | 12.6 ms | 31.8 ms | 635 ms |
| JavaScript (React + bridge) | 5.8 ms | 14.5 ms | 510 ms |
| GTK setters | 0.4 ms | 1.0 ms | 59 ms |
| Layout + paint + XSync | 6.4 ms | 16.1 ms | 65 ms |

- The tablet uses the `ondemand` governor (165, 266, 330, 400 MHz). The two
  counter runs differ by 2.5 times in every part, which matches 400 / 165.
- A simple screen paints in 13–32 ms after a click, which is acceptable.
- In the 200-row list, JavaScript is 80 % of the time. React's work for each
  element in the QuickJS interpreter is the cost, not GTK. `List` on
  `GtkTreeView` removes this work from React, and `React.memo` helps when only
  some rows change.

### LVGLJS (rejected)

`lvgl/lv_binding_js`: txiki.js (June 2024), libuv 1.48, LVGL 8.3, React 16.
It runs on the stock Diablo kernel after these changes:

- a glibc 2.5 compat layer of about 20 functions, with fallbacks for 2.6.21,
- a libuv patch: a pipe in place of `eventfd`,
- 64-bit atomics with a lock (ARMv6 has no `ldrexd`),
- a `libstdc++` config edit and 6 glibc shims for the C++14 code,
- an SDL 1.2 display driver.

| Measure | GTK probe | LVGLJS |
| --- | --- | --- |
| Counter update (median), N810 | 6.0 ms | 24 ms |
| 200-row list update (median), N810 | 580 ms | 1650 ms (constant styles) |
| 200-row list first render, N810 | 1.2 s | 3.3 s |
| Start to bundle evaluated, N810 | 0.49 s (bytecode) | 1.7 s (source) |
| Peak memory (counter / list), N810 | 7.0 / 8.4 MB | 8.6 / 9.9 MB |
| Counter update (median), qemu-user | 0.42 ms | 1.6 ms |
| 200-row list update (median), qemu-user | 40 ms | 109 ms |

Most of these changes cannot go upstream. libuv requires Linux 3.10, and the
compat layer is for one platform. Ideas from LVGLJS that maemo-react keeps:
the component names, the style-object API and the demo applications.
