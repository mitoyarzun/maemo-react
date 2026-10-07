# maemo-react

React applications for Maemo 4.1 (Diablo) on the Nokia N800 and N810. The
applications draw native GTK 2 and Hildon widgets. See
`docs/specs/2026-10-06-maemo-react-design.md` for the design.

## Prerequisites

- A checkout of [n810-modern](https://github.com/mitoyarzun/n810-modern) next
  to this repository (`../n810-modern`), or the variable `N810_MODERN` set to
  its path. maemo-react uses its toolchain scripts (`tools/env.sh`,
  `tools/mk-sysroot.sh`) and its build of curl and OpenSSL.
- Docker, and the `n810-build` volume from n810-modern's
  `tools/build-in-docker.sh`, with the emulator from its
  `tools/mk-diablo-emulator.sh` and `STOCK=1 tools/emulator-gui-build.sh`.
- Node.js 22 or later on the development computer.

## Build and test

Add the GTK and Hildon packages to the Diablo sysroot once, then check the
environment:

```sh
devhost/run.sh 'cd /work && MANIFEST=/repo/devhost/sysroot-gtk.manifest /n810/tools/mk-sysroot.sh /work/sysroot-diablo | tail -6'
devhost/run.sh devhost/check-env.sh        # the environment is ready
npm ci                                      # not npm install: npm bug #4828 drops native bindings from the lock
npm run build:prelude
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo'
npm test                                    # JavaScript tests (Node)
devhost/run.sh 'runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

`devhost/run.sh` runs a command in the dev container. `diablo` builds for the
tablet and runs the tests under qemu-user with the Diablo libraries.
The image holds its own curl 8.22.0 with WebSocket support. After a change of
`devhost/Dockerfile`, build the image again with `docker build -t maemo-react-dev devhost`.

## Controlled values

`Entry` (`value`), `ToggleButton` and `CheckButton` (`active`), `ComboBox`
(`active`), `Scale` (`value`) and `List` (`selected`) are controlled when you
give the prop. The renderer puts the React value into GTK on each render, and
GTK then shows it again even if the user changed the widget. The renderer
does not run the handler for a change that it makes itself. The handler runs
only for a change by the user. The handler can keep the old state: the next
render puts the old value back in the widget.

## Web globals

The prelude gives `fetch`, `Headers`, `Request`, `Response`, `URL`,
`URLSearchParams`, `TextEncoder`, `TextDecoder`, `AbortController`,
`WebSocket` (`ws` and `wss`; `binaryType` is `'arraybuffer'` only) and
`localStorage` (a JSON file in `/home/user/.maemo-react/<app-id>/`, mode
0600, written during idle time). `packages/types/globals.d.ts` lists the exact
shape. TLS always checks the certificate against the n810-modern CA store.

## Make an application

```sh
npm install
npm run build:cli
npx maemo-react create ../my-app --id my-app --name "My App"
cd ../my-app && npm install
npm run typecheck
npm run deploy -- --host <tablet address>
```

The packages are not on npm yet. Run `create` from this checkout. It writes
`file:` dependencies with absolute paths to the `packages` folders of the
checkout, so the checkout must stay where it is. `create` stops with an error
when it does not find the packages.

The tablet needs `maemo-react-runtime` once:
`npx maemo-react deploy <path>/maemo-react-runtime_0.3.0_armel.deb --host <tablet address>`.
Deploy uses SSH on port 2222 and `sudo gainroot`, so the tablet must be in
R&D mode. The application appears in the Extras menu.

See `examples/hello` (fetch over HTTPS; `docs/hello-emulator.png` shows it in
the emulator), `examples/widgets` (every M2a component: `List`, `Scale`,
`ComboBox`, `ToggleButton`, `CheckButton`, `Menu` and `banner()`;
`docs/widgets-emulator.png` shows it) and `examples/bench` (the frame
benchmark). `docs/benchmarks.md` has the results from a real N810.
