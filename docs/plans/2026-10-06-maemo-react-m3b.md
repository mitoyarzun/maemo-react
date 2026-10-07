# HA Remote (maemo-react M3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build HA Remote, the Home Assistant client of the HA spec, as `examples/ha-remote`: sign-in with the server URL and a Home Assistant long-lived access token; a main screen with pages, entities and a detail panel; live state over `WebSocket`; a snapshot in `localStorage`; reconnect with back-off; and the acceptance test on the tablet, on the LAN and through the remote URL.

**Architecture:** `src/ha/` has no React and no GTK: `auth.ts` (the server URL, the token check, the token in the storage), `connection.ts` (the socket, the auth message, the message ids, the pings, the back-off), `model.ts` (registries and states to rows and pages, pure functions), `actions.ts` (entity and user action to a service call, pure functions) and `store.ts` (one state object, listeners, one notification per Home Assistant message). `src/ui/` has the React components over `@maemo-react/widgets`; they read the store with `useSyncExternalStore`. The `List` rows keep their identity when the entity did not change (the M2a lesson: one store update for each changed cell), and the store rebuilds only the pages whose rows changed. A fake Home Assistant in Python serves the unit of the end-to-end checks. The application ships as a `.deb` through the CLI.

**Tech Stack:** TypeScript 5.9.3, React 19.3.0, `@maemo-react/core`, `@maemo-react/widgets`, the runtime 0.3.0 (`WebSocket`, `localStorage`, `maemo:app`, `maemo:storage` from the M3a plan), Vitest 5.0.3, Python 3.12 (stdlib only) for the fake server, the Diablo emulator, a Nokia N810, the user's Home Assistant server.

**Spec:** `maemo-react/docs/specs/2026-10-06-ha-remote-design.md` (all of it) and `maemo-react/docs/specs/2026-10-06-maemo-react-design.md` (sections 7, 11, 13 and 14). Read both before you start. The M3a plan, `docs/plans/2026-10-06-maemo-react-m3a.md`, must be complete first: this plan uses the runtime 0.3.0.

**Revision, 2026-10-07:** the user decided: "let's use a token for now, I don't want to do hacky workarounds". HA Remote signs in with a long-lived access token only. This revision removes the login flow, the second factor, the `client_id`, `/auth/token`, the token refresh and the revoke. Task 1 now checks the token and the TLS chain. The old Task 10 (the long-lived token as a fallback) is removed, because the token is now the main path. The plan has nine tasks; the other task numbers do not change.

Run the commands in `maemo-react/` unless the command says otherwise. The `git` paths start at the repository root (`n810-modern/`).

## Global Constraints

- The runtime is 0.3.0 (M3a). The application depends on `maemo-react-runtime (>= 0.3.0)`; the CLI writes that.
- Use only APIs that exist in GLib 2.12, GTK 2.10 and Hildon 2.0. `is-topmost` is a read-only boolean property of `HildonWindow` in Hildon 2.0.6 (`packages/types/generated/gtk.json`, made by typegen on Diablo, lists it; `hildon_window_get_is_topmost` is in `hildon-window.h`). The desktop host has a `GtkWindow`, which has `is-active` instead.
- `src/ha/` uses only `fetch`, `WebSocket`, `localStorage`, timers and `Date.now` (HA spec section 3). The unit tests give it fakes. No React, no GTK, no `maemo:*` import in `src/ha/`.
- The state of a row changes only when Home Assistant sends the new state. The application never guesses the result of a service call (HA spec section 3).
- A `Scale` sends its value when the user releases the slider (HA spec section 4; the M2a `RANGE_EXT` does this).
- The `localStorage` file holds the long-lived access token (`ha.token`), so it has mode 0600 (M3a). Never write the user's token or server address to the repository, to a plan, to a log that is committed, or to a file outside `localStorage`. The manual steps take them from the user at that time; a token goes into a shell only through `read -s`. The token `test-token` of the fake server is a test value, and the checks can put it on the command line.
- HA Remote signs in with a long-lived access token (HA spec section 4). The WebSocket auth message sends it as `access_token`; a REST call sends it as `Authorization: Bearer`. There is no login flow, no `/auth/token`, no token refresh and no revoke. `auth_invalid` and HTTP 401 delete the token and show the sign-in screen with the server URL and `TOKEN_REJECTED`; the application does not reconnect then. Task 1 checks the token and the TLS chain on the real server before any other task.
- The sign-in screen has a server URL field, a token field that hides the text, and a "Show" toggle button. The token field takes a paste. Do not add other entry aids (the user's decision).
- One entity change must not re-render more than needed: rows keep their identity when nothing in them changed, the store notifies once per Home Assistant message, and only the pages that hold a changed row get a new array.
- Never pipe `runtime/test/run.sh` into `grep`, `tail` or `head`: its background Xvfb and servers keep the pipe open. Redirect to a file, then read the file.
- Never run plain `npm install` in `maemo-react` (npm bug #4828 drops the `@rolldown/binding-*` entries from `package-lock.json`). Task 3 adds the workspace entries to the lock by hand, as commit `db36392` did, and checks `git diff package-lock.json` shows no deletion.
- Run one QEMU system emulator at a time. Boot the emulator with `VNC_PASSWORD=n810` when you use `tools/emulator-gui-build.sh`; `devhost/emulator-run.sh` boots without VNC and needs no password.
- Take time measurements on the tablet only. The tablet kernel has no `userspace` governor: use `powersave` for 165 MHz and check the `cpu` field, or the clock in `/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq`.
- Write all English prose, code comments and commit messages in ASD-STE100 Simplified Technical English. The user interface text is English. Commit messages follow the repository style: an imperative summary line, no `feat:` prefixes, no attribution lines.

## Review Focus

These six conditions are implied by the spec but no task's main tests exercise them. Each one has a test in the task that owns the code:

1. **A server URL typed without a scheme, with a trailing slash, or with a path** (`homeassistant.local:8123`, `http://ha/`, a dashboard URL `https://x.ui.nabu.casa/lovelace/0` copied from the browser). Expected: the application adds `http://`, keeps only the scheme, the host and the port, and builds `ws://ha/api/websocket`; no double slash, no path. Test: Task 4, `auth.test.ts` "normalizeServer", and Task 6, `store.test.ts` "a pasted token loses its spaces and line breaks, and a URL with a path keeps only the origin".
2. **An entity in the registry that has no state yet, or a state whose entity is not in the registry.** Expected: the first does not appear; the second appears on the "Other" page with its `friendly_name`. Test: Task 3, `model.test.ts` "a state without a registry entry goes to Other; a registry entry without a state is not shown".
3. **A `subscribe_entities` change for an entity that the application dropped (a sensor).** Expected: ignored, no new row, no exception. Test: Task 3, `model.test.ts` "a change of an unknown or dropped entity is ignored".
4. **The user deletes the token in the Home Assistant profile while the application keeps it** (the server answers `auth_invalid` on the next connect). Expected: the token goes from the storage, the sign-in screen shows the server URL and "Home Assistant did not accept the token. Make a new token in your profile.", the favorites stay, and no reconnect follows. Test: Task 6, `store.test.ts` "auth_invalid deletes the token and shows the sign-in screen with the server URL; no reconnect", and Task 5, `connection.test.ts` "auth_invalid reports and stops the reconnects".
5. **A favorite whose entity was removed on the server.** Expected: the Favorites page shows nothing for it, the id stays in storage, and no exception (HA spec section 7). Test: Task 6, `store.test.ts` "a removed favorite stays in storage and shows nothing".
6. **A pasted token with spaces or a line break at the start or at the end** (a copy in the browser often adds them). Expected: the application removes them before the check and before the storage; a space or a line break inside the token gives "The token has a space or a line break in it" without a request. Test: Task 4, `auth.test.ts` "normalizeToken", and Task 6, `store.test.ts` "a pasted token loses its spaces and line breaks, and a URL with a path keeps only the origin".

## Defaults in this plan

The HA spec says "do your best and we'll adjust later". These choices are not in the spec. Each is a one-line edit:

| Value | Where | Why |
| --- | --- | --- |
| The example lives in `examples/ha-remote` | Task 3 | spec section 12 of the parent lists `examples/ ... (later: ha-remote)`; the workspace already resolves the `@maemo-react/*` packages |
| Entities with an entity category (`config`, `diagnostic`) are dropped | `model.ts`, `parseDisplay` | a child-lock switch is not a control of the home; the spec drops only hidden and disabled entities |
| The name of a row is `friendly_name`, else the registry name, else the id | `model.ts`, `nameOf` | the frontend shows `friendly_name` |
| Rows in a page are sorted by name | `model.ts`, `buildPage` | the registry has no order for entities |
| The snapshot is written at most every 10 s, and at sign-out, pause and quit | `store.ts`, `SNAPSHOT_EVERY_MS` | a write on each message would stringify the whole state on each change |
| The snapshot keeps only the attributes that the rows and the detail panel use | `store.ts`, `SNAPSHOT_ATTRS` | the file stays small (risk table) |
| Toggles are shown only while the connection is live | `store.ts`, `rowsLive` | spec section 5: "the toggles are not available until the connection is live" |
| The brightness `Scale` appears when `supported_color_modes` has a mode other than `onoff` | `ui/Detail.tsx`, `hasBrightness` | that is the Home Assistant rule for a dimmable light |
| The default server URL is `http://homeassistant.local:8123` | `ui/SignIn.tsx` | the Home Assistant default |
| The server URL keeps only the scheme, the host and the port | `auth.ts`, `normalizeServer` | Home Assistant does not run under a path; a URL copied from the browser has the path of a dashboard |
| A token with a space or a line break inside is refused before a request | `auth.ts`, `normalizeToken` | a token has no white space; a request would only give 401 |
| The note that "Sign out" does not revoke the token is in the About screen | `ui/About.tsx` | the spec allows the About screen or a confirmation; the About screen needs no dialog |
| The fake server accepts one token, `test-token` (`--token` changes it) | `runtime/test/server/ha.py` | one value for the unit of the end-to-end checks |
| The desktop run uses `MR_APP_ID=ha-remote` | Task 7 | the host derives the id from the install path only on the tablet |
| The fake server has 6 entities in 2 areas, plus `--entities N` generated lights | `runtime/test/server/ha.py` | small for the end-to-end check; 2,000 for the size risk |

## File Structure

```
maemo-react/
  packages/core/src/extensions.ts     MODIFY: WINDOW_EXT (onTopmostChange)
  packages/core/src/elements.ts       MODIFY: hildon-window gets WINDOW_EXT
  packages/core/test/extensions.test.tsx MODIFY
  typegen/emit.mjs                    MODIFY: WindowElementProps
  packages/types/generated/intrinsics.d.ts REGENERATE
  packages/types/test/check.tsx       MODIFY
  package.json                        MODIFY: typecheck the example
  package-lock.json                   MODIFY: the workspace entries, by hand
  examples/ha-remote/app.json, package.json, tsconfig.json
  examples/ha-remote/src/ha/types.ts       the shared types
  examples/ha-remote/src/ha/model.ts       registries + states -> entities, rows, pages
  examples/ha-remote/src/ha/auth.ts        server URL, token check, token in storage
  examples/ha-remote/src/ha/connection.ts  WebSocket, auth, ids, ping, back-off
  examples/ha-remote/src/ha/actions.ts     entity + user action -> service call
  examples/ha-remote/src/ha/store.ts       the state of the application
  examples/ha-remote/src/ui/SignIn.tsx, Main.tsx, PageList.tsx, EntityList.tsx, Detail.tsx, About.tsx, App.tsx
  examples/ha-remote/src/main.tsx
  examples/ha-remote/test/fixtures/*.json  recorded Home Assistant messages
  examples/ha-remote/test/*.test.ts        Vitest, with fakes
  runtime/test/server/ha.py           CREATE: the fake Home Assistant
  README.md                           MODIFY
  docs/ha-remote-emulator.png         CREATE
  docs/ha-remote-acceptance.md        CREATE: the results from the tablet
```

---

### Task 1: The token check and the TLS check against the real Home Assistant

**Files:**
- None in the repository. This task runs commands from the development computer and records a yes or no.

**Interfaces:**
- Consumes: the user's Home Assistant server, through its LAN URL and its remote URL; a long-lived access token that the user makes for HA Remote and types at a prompt.
- Produces: three results: the token works on the LAN URL; the token works on the remote URL; the curl of the tablet build trusts the certificate chain of the remote URL. A "no" stops the plan until your human partner decides what to do.

This is a manual task. Do it before the code tasks. Never put the URL or the token into a file, a commit, a plan or a log that is committed. The token goes into the shell only through `read -s`, so it is not in the shell history and not on the screen. If your shell cannot take input at a prompt, ask your human partner to run the lines in their own terminal and to tell you the output.

- [ ] **Step 1: Get the server addresses and the token**

Ask your human partner for the LAN URL of the server (for example `http://192.168.0.20:8123`) and for the remote URL (`https://<id>.ui.nabu.casa` or the public HTTPS name). Ask them to make a long-lived access token: in Home Assistant, open the profile (the user name at the bottom of the sidebar), select the "Security" tab, go to "Long-lived access tokens", select "Create token", and type the name `HA Remote`. Home Assistant shows the token one time only, so they must copy it at once. They can use the same token on the tablet in Task 9.

- [ ] **Step 2: Check the token on the LAN URL**

Run in a shell on the development computer (not in a file):

```bash
HA='<the LAN URL, without a trailing slash>'
read -r -s -p 'token: ' TOKEN; echo
curl -sS -H "Authorization: Bearer $TOKEN" "$HA/api/"; echo
```

Expected: `{"message":"API running."}`. `401: Unauthorized` means that Home Assistant did not accept the token: ask your human partner to copy it again (a character is missing, or the token was deleted), and run `read` again. `curl: (6)` or `curl: (7)` means that the URL is wrong or the server is not on: write it down and stop.

- [ ] **Step 3: Check the token and the TLS chain on the remote URL**

In the same shell, set `HA` to the remote URL and run the `curl` line again (the `TOKEN` variable is still set). Expected: `{"message":"API running."}`. Nabu Casa serves `/api/` and `wss://<host>/api/websocket` on the same HTTPS host, and no extra header is necessary. Then delete the token from the shell:

```bash
unset TOKEN
```

Check the TLS chain with the curl of the tablet build, because Nabu Casa uses Let's Encrypt and the n810-modern CA store must hold ISRG Root X1. This check sends no token:

```bash
devhost/run.sh "qemu-arm -L /work/sysroot-diablo -E LD_LIBRARY_PATH=/work/out/opt/n810-modern/lib /work/out/opt/n810-modern/bin/curl -sS -o /dev/null -w '%{http_code}\n' --cacert /work/out/opt/n810-modern/ssl/cert.pem '<the remote URL>/api/'"
```

Expected: `401` (no token was sent; any HTTP code shows that TLS worked). `curl: (60)` means the CA store does not have the root: report it, because `n810-modern-tls` must be updated before the remote acceptance test.

- [ ] **Step 4: Record the result**

Tell your human partner the outcome in one line for each check: "LAN: API running", "remote: API running", "tablet TLS: ok", or the error text. Do not write the URLs or the token. If a check failed, stop and ask your human partner what to do; the code tasks do not depend on the result, but the acceptance test (Task 9) does.

---

### Task 2: The onTopmostChange prop of Window

**Files:**
- Modify: `maemo-react/packages/core/src/extensions.ts` (add `WINDOW_EXT`)
- Modify: `maemo-react/packages/core/src/elements.ts` (`hildon-window`)
- Modify: `maemo-react/packages/core/test/extensions.test.tsx`
- Modify: `maemo-react/typegen/emit.mjs` (`EXTRA_PROPS`, `EXTENSION_TYPES`)
- Regenerate: `maemo-react/packages/types/generated/intrinsics.d.ts`
- Modify: `maemo-react/packages/types/test/check.tsx`

**Interfaces:**
- Consumes: `ElementExt`, `ExtContext`, `ExtInstance` (elements.ts); `connect` with a detailed signal name (`maemo:gobject` passes the name to `g_signal_parse_name` with `force_detail_quark`, so `notify::is-topmost` works; the `GParamSpec` argument of `notify` converts to `undefined` and is ignored).
- Produces: the prop `onTopmostChange?: (topmost: boolean, target: WidgetTarget) => void` on `<hildon-window>` and so on `Window`. On the tablet it follows `notify::is-topmost` and reads `is-topmost`; on the desktop host it follows `notify::is-active` and reads `is-active`. It does not run at mount; it runs on each change. Task 6 and Task 7 use it.

- [ ] **Step 1: Write the failing test**

Add to `maemo-react/packages/core/test/extensions.test.tsx`, at the end of the file:

```tsx
describe('Window (hildon-window)', () => {
  test('onTopmostChange follows notify::is-topmost on hildon', () => {
    const t = setup();
    const seen: boolean[] = [];
    t.renderer.render(<hildon-window onTopmostChange={(top) => seen.push(top)} />);
    const [win] = t.ofType('HildonWindow');
    expect(t.ops).toContainEqual(['connect', win, 'notify::is-topmost']);
    t.poke(win, 'is-topmost', false);
    t.emit(win, 'notify::is-topmost');
    t.poke(win, 'is-topmost', true);
    t.emit(win, 'notify::is-topmost');
    expect(seen).toEqual([false, true]);
  });

  test('onTopmostChange follows notify::is-active on the desktop', () => {
    const fake = fakeBridge();
    const renderer = createRenderer(fake.bridge, 'desktop');
    const seen: boolean[] = [];
    renderer.render(<hildon-window onTopmostChange={(top) => seen.push(top)} />);
    const [win] = fake.ofType('GtkWindow');
    expect(fake.ops).toContainEqual(['connect', win, 'notify::is-active']);
    fake.poke(win, 'is-active', true);
    fake.emit(win, 'notify::is-active');
    expect(seen).toEqual([true]);
  });

  test('a window without the prop connects nothing, and a later prop connects once', () => {
    const t = setup();
    const root = t.renderer.createRoot();
    root.render(<hildon-window />);
    const [win] = t.ofType('HildonWindow');
    expect(t.ops.filter((op) => op[0] === 'connect' && op[1] === win && String(op[2]).startsWith('notify::'))).toHaveLength(0);
    root.render(<hildon-window onTopmostChange={() => {}} />);
    root.render(<hildon-window onTopmostChange={() => {}} />);
    expect(t.ops.filter((op) => op[0] === 'connect' && op[1] === win && op[2] === 'notify::is-topmost')).toHaveLength(1);
  });
});
```

Run `npx vitest run packages/core/test/extensions.test.tsx`. Expected: the three new tests fail (`onTopmostChange` reaches `b.set` as a GObject property, or no `connect` op is found).

- [ ] **Step 2: Write WINDOW_EXT**

Add to `maemo-react/packages/core/src/extensions.ts`, at the end:

```ts
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
```

`ExtContext` has no `platform` yet. In `maemo-react/packages/core/src/elements.ts`, add to `ExtContext`:

```ts
  /** 'hildon' on the tablet, 'desktop' in the desktop dev host. */
  platform: Platform;
```

In `maemo-react/packages/core/src/hostConfig.ts`, change `const ext: ExtContext = { bridge: b, run: runDiscrete };` to `const ext: ExtContext = { bridge: b, platform, run: runDiscrete };`.

In `maemo-react/packages/core/src/elements.ts`, change the import to `import { COMBO_EXT, RANGE_EXT, WINDOW_EXT } from './extensions.js';` and add `ext: WINDOW_EXT,` to the `'hildon-window'` entry, after `toplevel: true,`.

- [ ] **Step 3: Run the core tests**

```bash
npx vitest run packages/core packages/widgets
```

Expected: every test passes, including the three new ones.

- [ ] **Step 4: The types**

In `maemo-react/typegen/emit.mjs`, add to `EXTRA_PROPS`:

```js
  'hildon-window': 'WindowElementProps',
```

and add to `EXTENSION_TYPES`, before the closing backtick:

```ts
/** The props of <hildon-window> that the renderer applies itself. */
export interface WindowElementProps {
  /** The window came on top (true) or went behind another (false). Not called at mount. */
  onTopmostChange?: (topmost: boolean, target: WidgetTarget) => void;
}
```

Regenerate and check:

```bash
npm run typegen:emit
npx vitest run typegen
```

Expected: `wrote packages/types/generated/intrinsics.d.ts from GTK 2.10.12`; the typegen tests pass. `git diff packages/types/generated/intrinsics.d.ts` shows the new interface and `'hildon-window': HildonWindowProps & WindowElementProps & { children?: ReactNode };`.

In `maemo-react/packages/types/test/check.tsx`, change `<Window title="t">` to `<Window title="t" onTopmostChange={(top) => console.log(top)}>`. Run `npm run typecheck`. Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add maemo-react/packages/core/src/extensions.ts maemo-react/packages/core/src/elements.ts maemo-react/packages/core/src/hostConfig.ts maemo-react/packages/core/test/extensions.test.tsx maemo-react/typegen/emit.mjs maemo-react/packages/types/generated/intrinsics.d.ts maemo-react/packages/types/test/check.tsx
git commit -m "Add onTopmostChange to Window"
```

---

### Task 3: The ha-remote workspace, the types, and the model

**Files:**
- Create: `maemo-react/examples/ha-remote/{app.json,package.json,tsconfig.json}`
- Modify: `maemo-react/package.json` (`typecheck`), `maemo-react/package-lock.json` (by hand)
- Create: `maemo-react/examples/ha-remote/src/ha/types.ts`, `maemo-react/examples/ha-remote/src/ha/model.ts`
- Create: `maemo-react/examples/ha-remote/test/fixtures/registries.json`, `states.json`
- Create: `maemo-react/examples/ha-remote/test/model.test.ts`

**Interfaces:**
- Consumes: `ListRow` from `@maemo-react/widgets`.
- Produces (`types.ts`): `DOMAINS`, `Domain`, `Area {id, name}`, `Entity {id, domain, name, areaId, state, attrs}`, `Row extends ListRow {key, name, state, on}`, `Page {key, name, rows}`, `ServiceCall`, `StatesEvent`, `CompressedState`.
- Produces (`model.ts`): `parseAreas(result): Area[]`; `parseDevices(result): Map<deviceId, areaId | null>`; `parseDisplay(result): { display: Map<entityId, DisplayEntry>, hidden: Set<entityId> }`; `Registries {areas, deviceArea, display, hidden}`; `emptyRegistries()`; `domainOf(id)`; `areaOf(id, reg)`; `nameOf(id, attrs, entry)`; `stateText(domain, state, attrs)`; `onOf(domain, state)`; `makeRow(entity, live, pending, prev): Row` (returns `prev` when nothing changed); `applyStates(entities, event, reg): { entities, changed }` (unchanged entities keep their objects); `placeAgain(entities, reg)`; `FAVORITES`, `OTHER`, `pageKeysOf(entity, favorites)`, `pageName(key, areas)`, `sortRows(rows, favoritesOrder?)`. Task 6 builds the store on these.

- [ ] **Step 1: Make the workspace**

Create `maemo-react/examples/ha-remote/app.json`:

```json
{
  "id": "ha-remote",
  "name": "HA Remote",
  "version": "0.1.0",
  "description": "A Home Assistant remote for the N810: lights, switches, climate and covers"
}
```

Create `maemo-react/examples/ha-remote/package.json`:

```json
{
  "name": "ha-remote",
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

Create `maemo-react/examples/ha-remote/tsconfig.json`:

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

In `maemo-react/package.json`, change the `typecheck` script to:

```
"typecheck": "tsc -p packages/types/test && tsc -p packages/cli && tsc -p examples/hello && tsc -p examples/bench && tsc -p examples/widgets && tsc -p examples/ha-remote"
```

Add the workspace to `maemo-react/package-lock.json` by hand (never with `npm install`). In the `"packages"` object, after the `"examples/widgets"` entry, add:

```json
    "examples/ha-remote": {
      "name": "ha-remote",
      "version": "0.1.0",
      "dependencies": {
        "@maemo-react/core": "0.1.0",
        "@maemo-react/widgets": "0.1.0",
        "react": "19.3.0"
      },
      "devDependencies": {
        "@maemo-react/cli": "0.1.0",
        "@maemo-react/types": "0.1.0"
      }
    },
```

and, in alphabetical order among the `"node_modules/..."` entries (after `"node_modules/globals"` or wherever `ha-remote` sorts), add:

```json
    "node_modules/ha-remote": {
      "resolved": "examples/ha-remote",
      "link": true
    },
```

Check: `git diff --stat package-lock.json` shows only insertions (`+`), and `git diff package-lock.json | grep '^-' | grep -v '^---'` prints nothing. The `@maemo-react/*` packages and `react` resolve through the root `node_modules`, so no install is needed: `ls node_modules/@maemo-react` lists `cli core types widgets`.

- [ ] **Step 2: Write the types**

Create `maemo-react/examples/ha-remote/src/ha/types.ts`:

```ts
// The types that the ha/ modules share. No React, no GTK.
import type { ListRow } from '@maemo-react/widgets';

export const DOMAINS = ['light', 'switch', 'fan', 'input_boolean', 'climate', 'cover'] as const;
export type Domain = (typeof DOMAINS)[number];

export interface Area {
  id: string;
  name: string;
}

/** One entity that the application shows. The object changes only when the entity changes. */
export interface Entity {
  id: string;
  domain: Domain;
  name: string;
  areaId: string | null;
  state: string;
  attrs: Record<string, unknown>;
}

/** A row of the entity List. The object changes only when its text or its toggle changes. */
export interface Row extends ListRow {
  key: string;
  name: string;
  state: string;
  on: boolean | null;
}

export interface Page {
  key: string;
  name: string;
  rows: Row[];
}

/** A row of the page List. */
export interface PageRow extends ListRow {
  key: string;
  name: string;
}

export interface ServiceCall {
  domain: string;
  service: string;
  service_data?: Record<string, unknown>;
  target: { entity_id: string };
}

/** The compressed state of subscribe_entities. */
export interface CompressedState {
  s: string;
  a: Record<string, unknown>;
  lc?: number;
  lu?: number;
  c?: unknown;
}

/** One subscribe_entities event: added, changed and removed entities. */
export interface StatesEvent {
  a?: Record<string, CompressedState>;
  c?: Record<string, { '+'?: Partial<CompressedState>; '-'?: { a?: string[] } }>;
  r?: string[];
}
```

- [ ] **Step 3: Write the fixtures and the failing tests**

Create `maemo-react/examples/ha-remote/test/fixtures/registries.json` (the results of the three registry commands, in the shape that Home Assistant 2024.x sends; `hb` marks a hidden entity, `hn` that the entity has an entity name, `ec` an entity category):

```json
{
  "areas": [
    { "area_id": "living_room", "name": "Living room", "picture": null },
    { "area_id": "kitchen", "name": "Kitchen", "picture": null },
    { "area_id": "garage", "name": "Garage", "picture": null }
  ],
  "devices": [
    { "id": "dev1", "area_id": "kitchen", "name": "Fan controller" },
    { "id": "dev2", "area_id": null, "name": "Hub" }
  ],
  "display": {
    "entity_categories": { "0": "config", "1": "diagnostic" },
    "entities": [
      { "ei": "light.ceiling", "ai": "living_room", "pl": "hue" },
      { "ei": "light.desk", "ai": "living_room", "en": "Desk lamp", "pl": "hue" },
      { "ei": "switch.fan", "di": "dev1", "pl": "mqtt" },
      { "ei": "climate.thermostat", "ai": "living_room", "pl": "mqtt" },
      { "ei": "cover.blinds", "ai": "living_room", "pl": "mqtt" },
      { "ei": "light.hidden", "ai": "kitchen", "hb": true, "pl": "hue" },
      { "ei": "switch.child_lock", "ai": "kitchen", "ec": 0, "pl": "mqtt" },
      { "ei": "light.no_state", "ai": "garage", "pl": "hue" },
      { "ei": "sensor.temp", "ai": "kitchen", "pl": "mqtt" }
    ]
  }
}
```

Create `maemo-react/examples/ha-remote/test/fixtures/states.json` (the first `subscribe_entities` event):

```json
{
  "a": {
    "light.ceiling": { "s": "on", "a": { "friendly_name": "Ceiling light", "brightness": 128, "supported_color_modes": ["brightness"], "color_mode": "brightness" }, "c": "c1", "lc": 1700000000, "lu": 1700000000 },
    "light.desk": { "s": "off", "a": { "friendly_name": "Desk", "supported_color_modes": ["onoff"] }, "c": "c2", "lc": 1700000000, "lu": 1700000000 },
    "switch.fan": { "s": "off", "a": { "friendly_name": "Fan" }, "c": "c3", "lc": 1700000000, "lu": 1700000000 },
    "climate.thermostat": { "s": "heat", "a": { "friendly_name": "Thermostat", "temperature": 21, "current_temperature": 19.5, "hvac_modes": ["off", "heat", "cool"], "target_temp_step": 0.5, "min_temp": 7, "max_temp": 35 }, "c": "c4", "lc": 1700000000, "lu": 1700000000 },
    "cover.blinds": { "s": "open", "a": { "friendly_name": "Blinds", "current_position": 100, "supported_features": 15 }, "c": "c5", "lc": 1700000000, "lu": 1700000000 },
    "input_boolean.guest": { "s": "off", "a": { "friendly_name": "Guest mode" }, "c": "c6", "lc": 1700000000, "lu": 1700000000 },
    "light.hidden": { "s": "off", "a": { "friendly_name": "Hidden" }, "c": "c7", "lc": 1700000000, "lu": 1700000000 },
    "switch.child_lock": { "s": "off", "a": { "friendly_name": "Child lock" }, "c": "c8", "lc": 1700000000, "lu": 1700000000 },
    "sensor.temp": { "s": "19.5", "a": { "friendly_name": "Temperature", "unit_of_measurement": "°C" }, "c": "c9", "lc": 1700000000, "lu": 1700000000 }
  }
}
```

Create `maemo-react/examples/ha-remote/test/model.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  FAVORITES, OTHER, applyStates, areaOf, domainOf, emptyRegistries, makeRow, onOf, pageKeysOf, pageName, parseAreas, parseDevices, parseDisplay,
  placeAgain, sortRows, stateText, type Registries,
} from '../src/ha/model.js';
import type { Entity, Row, StatesEvent } from '../src/ha/types.js';
import registries from './fixtures/registries.json';
import states from './fixtures/states.json';

function reg(): Registries {
  const { display, hidden } = parseDisplay(registries.display);
  return { areas: parseAreas(registries.areas), deviceArea: parseDevices(registries.devices), display, hidden };
}

function loaded() {
  return applyStates(new Map(), states as StatesEvent, reg()).entities;
}

describe('registries', () => {
  test('areas keep the registry order', () => {
    expect(parseAreas(registries.areas).map((a) => a.name)).toEqual(['Living room', 'Kitchen', 'Garage']);
    expect(parseAreas('nope')).toEqual([]);
  });

  test('devices map to areas; hidden entities and entity categories are dropped', () => {
    const r = reg();
    expect(r.deviceArea.get('dev1')).toBe('kitchen');
    expect(r.deviceArea.get('dev2')).toBeNull();
    expect(r.display.has('light.hidden')).toBe(false);
    expect(r.hidden.has('light.hidden')).toBe(true);
    expect(r.display.has('switch.child_lock')).toBe(false);
    expect(r.display.get('light.desk')).toEqual({ areaId: 'living_room', deviceId: null, name: 'Desk lamp' });
  });

  test('the area of an entity is its own, else the area of its device', () => {
    const r = reg();
    expect(areaOf('light.ceiling', r)).toBe('living_room');
    expect(areaOf('switch.fan', r)).toBe('kitchen');
    expect(areaOf('input_boolean.guest', r)).toBeNull();
  });

  test('domainOf keeps the six domains', () => {
    expect([domainOf('light.x'), domainOf('cover.x'), domainOf('sensor.x'), domainOf('nodot')]).toEqual(['light', 'cover', null, null]);
  });
});

describe('states', () => {
  test('the first event makes entities with names, areas and domains; others are dropped', () => {
    const e = loaded();
    expect([...e.keys()].sort()).toEqual(['climate.thermostat', 'cover.blinds', 'input_boolean.guest', 'light.ceiling', 'light.desk', 'switch.fan']);
    expect(e.get('light.ceiling')).toMatchObject({ domain: 'light', name: 'Ceiling light', areaId: 'living_room', state: 'on' });
    expect(e.get('switch.fan')?.areaId).toBe('kitchen');
    expect(e.get('light.desk')?.name).toBe('Desk');
  });

  test('a state without a registry entry goes to Other; a registry entry without a state is not shown', () => {
    const e = loaded();
    expect(e.get('input_boolean.guest')?.areaId).toBeNull();
    expect(pageKeysOf(e.get('input_boolean.guest')!, new Set())).toEqual([OTHER]);
    expect(e.has('light.no_state')).toBe(false);
  });

  test('a compressed change updates the state and the attributes, and the other entities keep their objects', () => {
    const before = loaded();
    const ev: StatesEvent = { c: { 'light.ceiling': { '+': { s: 'off', a: { brightness: 0 }, lc: 1700000100 } } } };
    const { entities, changed } = applyStates(before, ev, reg());
    expect(changed).toEqual(['light.ceiling']);
    expect(entities.get('light.ceiling')).toMatchObject({ state: 'off', attrs: { brightness: 0, friendly_name: 'Ceiling light' } });
    expect(entities.get('light.desk')).toBe(before.get('light.desk'));
    expect(entities).not.toBe(before);
  });

  test('a minus removes attributes, and r removes entities', () => {
    const before = loaded();
    const { entities, changed } = applyStates(before, { c: { 'light.ceiling': { '-': { a: ['brightness'] } } }, r: ['switch.fan'] }, reg());
    expect(entities.get('light.ceiling')?.attrs).not.toHaveProperty('brightness');
    expect(entities.has('switch.fan')).toBe(false);
    expect(changed).toEqual(['light.ceiling', 'switch.fan']);
  });

  test('a change of an unknown or dropped entity is ignored', () => {
    const before = loaded();
    const ev: StatesEvent = { c: { 'sensor.temp': { '+': { s: '20' } }, 'light.nope': { '+': { s: 'on' } } }, r: ['light.gone'] };
    const { entities, changed } = applyStates(before, ev, reg());
    expect(changed).toEqual([]);
    expect(entities.size).toBe(before.size);
  });

  test('a new friendly_name changes the name', () => {
    const { entities } = applyStates(loaded(), { c: { 'light.desk': { '+': { a: { friendly_name: 'Reading lamp' } } } } }, reg());
    expect(entities.get('light.desk')?.name).toBe('Reading lamp');
  });

  test('placeAgain follows a new registry', () => {
    const r = reg();
    const moved: Registries = { ...r, display: new Map(r.display) };
    moved.display.set('light.desk', { areaId: 'kitchen', deviceId: null, name: null });
    const e = placeAgain(loaded(), moved);
    expect(e.get('light.desk')?.areaId).toBe('kitchen');
    expect(e.get('light.ceiling')?.areaId).toBe('living_room');
  });
});

describe('rows', () => {
  test('stateText for each domain', () => {
    expect(stateText('light', 'on', { brightness: 128 })).toBe('On 50 %');
    expect(stateText('light', 'on', {})).toBe('On');
    expect(stateText('light', 'off', { brightness: 128 })).toBe('Off');
    expect(stateText('switch', 'on', {})).toBe('On');
    expect(stateText('climate', 'heat', { temperature: 21 })).toBe('21.0 °C Heat');
    expect(stateText('climate', 'off', {})).toBe('Off');
    expect(stateText('cover', 'open', { current_position: 40 })).toBe('Open 40 %');
    expect(stateText('cover', 'closed', { current_position: 0 })).toBe('Closed');
    expect(stateText('cover', 'opening', {})).toBe('Opening');
    expect(stateText('fan', 'unavailable', {})).toBe('Unavailable');
  });

  test('onOf gives a toggle for on/off domains only', () => {
    expect([onOf('light', 'on'), onOf('switch', 'off'), onOf('light', 'unavailable'), onOf('climate', 'heat'), onOf('cover', 'open')]).toEqual([true, false, null, null, null]);
  });

  test('makeRow keeps the row object when nothing changed', () => {
    const e = loaded().get('light.ceiling')!;
    const row = makeRow(e, true, false, null);
    expect(row).toEqual({ key: 'light.ceiling', name: 'Ceiling light', state: 'On 50 %', on: true });
    expect(makeRow(e, true, false, row)).toBe(row);
    expect(makeRow(e, true, true, row)).toMatchObject({ state: 'On 50 % ...' });
    expect(makeRow(e, false, false, row)).toMatchObject({ on: null });
    const changed: Entity = { ...e, state: 'off' };
    expect(makeRow(changed, true, false, row)).not.toBe(row);
  });
});

describe('pages', () => {
  test('pageKeysOf puts a favorite on Favorites and on its area', () => {
    const e = loaded();
    expect(pageKeysOf(e.get('light.ceiling')!, new Set(['light.ceiling']))).toEqual([FAVORITES, 'living_room']);
    expect(pageKeysOf(e.get('light.ceiling')!, new Set())).toEqual(['living_room']);
  });

  test('pageName', () => {
    const areas = parseAreas(registries.areas);
    expect([pageName(FAVORITES, areas), pageName('kitchen', areas), pageName(OTHER, areas), pageName('nope', areas)]).toEqual(['Favorites', 'Kitchen', 'Other', 'nope']);
  });

  test('sortRows sorts by name, or by the favorites order', () => {
    const rows: Row[] = [
      { key: 'b', name: 'Beta', state: '', on: null },
      { key: 'a', name: 'alpha', state: '', on: null },
      { key: 'c', name: 'Gamma', state: '', on: null },
    ];
    expect(sortRows(rows).map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, ['c', 'a', 'b']).map((r) => r.key)).toEqual(['c', 'a', 'b']);
    expect(emptyRegistries().areas).toEqual([]);
  });
});
```

Run `npx vitest run examples/ha-remote`. Expected: the file fails to load: `Cannot find module '../src/ha/model.js'`.

- [ ] **Step 4: Write model.ts**

Create `maemo-react/examples/ha-remote/src/ha/model.ts`:

```ts
// Registries and states to entities, rows and pages. Pure functions: no
// React, no GTK, no network. An entity object and a row object change only
// when the entity changes, so the List updates only the changed rows.
import { DOMAINS, type Area, type CompressedState, type Domain, type Entity, type Row, type StatesEvent } from './types.js';

export interface DisplayEntry {
  areaId: string | null;
  deviceId: string | null;
  /** The name in the registry, when the user set one. */
  name: string | null;
}

/** The registries that place an entity on a page and name it. */
export interface Registries {
  areas: Area[];
  /** device id -> area id */
  deviceArea: Map<string, string | null>;
  /** entity id -> its entry. Hidden entities and entity categories are left out. */
  display: Map<string, DisplayEntry>;
  /** The hidden entities and the entities with an entity category: never shown, also when a state arrives. */
  hidden: Set<string>;
}

export const FAVORITES = 'favorites';
export const OTHER = 'other';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function emptyRegistries(): Registries {
  return { areas: [], deviceArea: new Map(), display: new Map(), hidden: new Set() };
}

/** config/area_registry/list -> the areas, in registry order. */
export function parseAreas(result: unknown): Area[] {
  const out: Area[] = [];
  if (!Array.isArray(result)) return out;
  for (const a of result) {
    if (!isObject(a)) continue;
    const id = str(a.area_id);
    if (id !== null) out.push({ id, name: str(a.name) ?? id });
  }
  return out;
}

/** config/device_registry/list -> device id -> area id. */
export function parseDevices(result: unknown): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!Array.isArray(result)) return out;
  for (const d of result) {
    if (!isObject(d)) continue;
    const id = str(d.id);
    if (id !== null) out.set(id, str(d.area_id));
  }
  return out;
}

/**
 * config/entity_registry/list_for_display -> the entries. The compact keys:
 * ei entity id, ai area id, di device id, en name, hb hidden, hn has entity name, ec entity
 * category. Disabled entities are not in the result at all.
 */
export function parseDisplay(result: unknown): { display: Map<string, DisplayEntry>; hidden: Set<string> } {
  const display = new Map<string, DisplayEntry>();
  const hidden = new Set<string>();
  const list = isObject(result) && Array.isArray(result.entities) ? result.entities : [];
  for (const e of list) {
    if (!isObject(e)) continue;
    const id = str(e.ei);
    if (id === null) continue;
    if (e.hb === true || e.ec !== undefined) {
      hidden.add(id); // hidden, config and diagnostic entities: never shown, also when a state arrives
      continue;
    }
    display.set(id, { areaId: str(e.ai), deviceId: str(e.di), name: str(e.en) });
  }
  return { display, hidden };
}

export function domainOf(id: string): Domain | null {
  const d = id.slice(0, id.indexOf('.'));
  return (DOMAINS as readonly string[]).includes(d) ? (d as Domain) : null;
}

/** The area of an entity: its own, else the area of its device (HA spec section 4). */
export function areaOf(id: string, reg: Registries): string | null {
  const e = reg.display.get(id);
  if (!e) return null;
  if (e.areaId !== null) return e.areaId;
  return e.deviceId !== null ? (reg.deviceArea.get(e.deviceId) ?? null) : null;
}

export function nameOf(id: string, attrs: Record<string, unknown>, entry: DisplayEntry | undefined): string {
  return str(attrs.friendly_name) ?? entry?.name ?? id;
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);

/** The state column of a row. */
export function stateText(domain: Domain, state: string, attrs: Record<string, unknown>): string {
  if (state === 'unavailable' || state === 'unknown') return cap(state);
  switch (domain) {
    case 'light': {
      const b = attrs.brightness;
      return state === 'on' && typeof b === 'number' ? 'On ' + Math.round((b / 255) * 100) + ' %' : cap(state);
    }
    case 'climate': {
      const t = attrs.temperature;
      return (typeof t === 'number' ? t.toFixed(1) + ' °C ' : '') + cap(state);
    }
    case 'cover': {
      const p = attrs.current_position;
      return typeof p === 'number' && state !== 'closed' ? cap(state) + ' ' + p + ' %' : cap(state);
    }
    default:
      return cap(state);
  }
}

/** The toggle column: true or false for an on/off entity, null for the others. */
export function onOf(domain: Domain, state: string): boolean | null {
  if (domain === 'climate' || domain === 'cover') return null;
  return state === 'on' ? true : state === 'off' ? false : null;
}

/**
 * The row of an entity. live: the connection is up, so the toggles show.
 * pending: a service call waits for the new state. Returns prev when
 * nothing in the row changed, so the List keeps the row.
 */
export function makeRow(e: Entity, live: boolean, pending: boolean, prev: Row | null): Row {
  const state = stateText(e.domain, e.state, e.attrs) + (pending ? ' ...' : '');
  const on = live ? onOf(e.domain, e.state) : null;
  if (prev && prev.name === e.name && prev.state === state && prev.on === on) return prev;
  return { key: e.id, name: e.name, state, on };
}

function fromCompressed(id: string, domain: Domain, s: CompressedState, reg: Registries): Entity {
  const attrs = isObject(s.a) ? s.a : {};
  return { id, domain, name: nameOf(id, attrs, reg.display.get(id)), areaId: areaOf(id, reg), state: String(s.s), attrs };
}

/**
 * Apply one subscribe_entities event. The result is a new Map; the entities
 * that did not change keep their objects. changed lists the ids that got a
 * new object or went away.
 */
export function applyStates(entities: Map<string, Entity>, ev: StatesEvent, reg: Registries): { entities: Map<string, Entity>; changed: string[] } {
  const next = new Map(entities);
  const changed: string[] = [];
  if (isObject(ev.a)) {
    for (const [id, s] of Object.entries(ev.a)) {
      const domain = domainOf(id);
      if (domain === null || reg.hidden.has(id) || !isObject(s)) continue;
      next.set(id, fromCompressed(id, domain, s as CompressedState, reg));
      changed.push(id);
    }
  }
  if (isObject(ev.c)) {
    for (const [id, diff] of Object.entries(ev.c)) {
      const old = next.get(id);
      if (!old || !isObject(diff)) continue; // a dropped entity, or one that never arrived
      const plus = isObject(diff['+']) ? diff['+'] : {};
      const minus = isObject(diff['-']) ? diff['-'] : {};
      let attrs = old.attrs;
      if (isObject(plus.a) || Array.isArray(minus.a)) {
        attrs = { ...old.attrs, ...(isObject(plus.a) ? plus.a : {}) };
        if (Array.isArray(minus.a)) for (const k of minus.a) delete attrs[String(k)];
      }
      const state = typeof plus.s === 'string' ? plus.s : old.state;
      next.set(id, { ...old, state, attrs, name: nameOf(id, attrs, reg.display.get(id)) });
      changed.push(id);
    }
  }
  if (Array.isArray(ev.r)) {
    for (const id of ev.r) if (next.delete(String(id))) changed.push(String(id));
  }
  return { entities: next, changed };
}

/** Place and name every entity again after the registries changed. */
export function placeAgain(entities: Map<string, Entity>, reg: Registries): Map<string, Entity> {
  const next = new Map<string, Entity>();
  for (const [id, e] of entities) {
    if (reg.hidden.has(id)) continue;
    const areaId = areaOf(id, reg);
    const name = nameOf(id, e.attrs, reg.display.get(id));
    next.set(id, areaId === e.areaId && name === e.name ? e : { ...e, areaId, name });
  }
  return next;
}

/** The pages that show an entity: Favorites when it is one, then its area or Other. */
export function pageKeysOf(e: Entity, favorites: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (favorites.has(e.id)) out.push(FAVORITES);
  out.push(e.areaId ?? OTHER);
  return out;
}

export function pageName(key: string, areas: readonly Area[]): string {
  if (key === FAVORITES) return 'Favorites';
  if (key === OTHER) return 'Other';
  return areas.find((a) => a.id === key)?.name ?? key;
}

/** Rows by name, or in the order of the favorites list when it is given. */
export function sortRows(rows: readonly Row[], favoritesOrder?: readonly string[]): Row[] {
  const out = rows.slice();
  if (favoritesOrder) {
    const at = new Map(favoritesOrder.map((id, i) => [id, i]));
    out.sort((a, b) => (at.get(a.key) ?? 1e9) - (at.get(b.key) ?? 1e9));
    return out;
  }
  // No localeCompare with a locale: QuickJS has no Intl.
  out.sort((a, b) => {
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return out;
}
```

- [ ] **Step 5: Run the tests and the type check**

```bash
npx vitest run examples/ha-remote
npm run typecheck
```

Expected: every test in `model.test.ts` passes; `tsc` prints nothing. If `tsc` rejects the JSON imports in the tests, nothing changes: the tests are not in `include`, and Vitest reads JSON by itself.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/examples/ha-remote/app.json maemo-react/examples/ha-remote/package.json maemo-react/examples/ha-remote/tsconfig.json maemo-react/examples/ha-remote/src/ha/types.ts maemo-react/examples/ha-remote/src/ha/model.ts maemo-react/examples/ha-remote/test maemo-react/package.json maemo-react/package-lock.json
git commit -m "Add the ha-remote workspace with its types and model"
```

---

### Task 4: auth.ts, the server URL and the token

**Files:**
- Create: `maemo-react/examples/ha-remote/src/ha/auth.ts`
- Create: `maemo-react/examples/ha-remote/test/auth.test.ts`

**Interfaces:**
- Consumes: the globals `fetch`, `Response`, `URL`; a storage object with `getItem`, `setItem` and `removeItem` (`localStorage` in the application, a fake in the tests).
- Produces: `TOKEN_REJECTED` (the sign-in message for `auth_invalid` and HTTP 401); `SERVER_KEY` (`ha.server`), `TOKEN_KEY` (`ha.token`); `AuthError` with `code: 'url' | 'token' | 'network' | 'certificate' | 'server' | 'rejected'` and a plain-words `message` for the screen; `AuthDeps {fetch}`; `TokenStorage`; `Credentials {server, token}`; `normalizeServer(input): string`; `normalizeToken(input): string`; `socketUrl(server): string`; `checkToken(deps, server, token): Promise<void>`; `readCredentials(storage): Credentials`; `saveCredentials(storage, server, token)`; `clearToken(storage)`; `messageOf(e): string`. Task 6 uses them.

- [ ] **Step 1: Write the failing tests**

Create `maemo-react/examples/ha-remote/test/auth.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  AuthError, SERVER_KEY, TOKEN_KEY, TOKEN_REJECTED, checkToken, clearToken, normalizeServer, normalizeToken, readCredentials, saveCredentials, socketUrl,
} from '../src/ha/auth.js';

type Answer = { status: number; body: unknown } | Error;

// A fake fetch with scripted answers, in order.
function fakeFetch(answers: Answer[]) {
  const calls: Array<{ url: string; method: string; auth: string }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization') ?? '' });
    const a = answers.shift();
    if (!a) throw new Error('the test gave no answer for ' + String(url));
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as typeof fetch;
  return { fetch, calls };
}

// A fake storage: a Map.
function memory(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const S = 'http://ha:8123';
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return e instanceof AuthError ? e.code + ': ' + e.message : String(e);
  }
};

describe('normalizeServer', () => {
  test('adds http, and keeps only the scheme, the host and the port', () => {
    expect(normalizeServer('homeassistant.local:8123')).toBe('http://homeassistant.local:8123');
    expect(normalizeServer('http://ha/')).toBe('http://ha');
    expect(normalizeServer(' https://x.ui.nabu.casa/ ')).toBe('https://x.ui.nabu.casa');
    expect(normalizeServer('http://h:8123/lovelace/0?edit=1#top')).toBe('http://h:8123');
  });

  test('refuses an empty or a non-http URL', () => {
    expect(() => normalizeServer('')).toThrow(expect.objectContaining({ code: 'url' }));
    expect(() => normalizeServer('ftp://x')).toThrow(expect.objectContaining({ code: 'url' }));
    expect(() => normalizeServer('http://')).toThrow(expect.objectContaining({ code: 'url' }));
  });

  test('socketUrl', () => {
    expect(socketUrl('http://h:8123')).toBe('ws://h:8123/api/websocket');
    expect(socketUrl('https://x.ui.nabu.casa')).toBe('wss://x.ui.nabu.casa/api/websocket');
  });
});

describe('normalizeToken', () => {
  test('removes the spaces and the line breaks of a paste at the start and at the end', () => {
    expect(normalizeToken('  eyJ0.abc.def\n')).toBe('eyJ0.abc.def');
    expect(normalizeToken('\teyJ0.abc.def\r\n')).toBe('eyJ0.abc.def');
  });

  test('refuses an empty token, and a token with a space or a line break inside', () => {
    expect(() => normalizeToken(' \n')).toThrow(expect.objectContaining({ code: 'token', message: 'Paste the token' }));
    expect(() => normalizeToken('eyJ0.abc\ndef')).toThrow(expect.objectContaining({ code: 'token' }));
  });
});

describe('checkToken', () => {
  test('GET /api/ with the bearer token; 200 accepts it', async () => {
    const f = fakeFetch([{ status: 200, body: { message: 'API running.' } }]);
    expect(await code(checkToken({ fetch: f.fetch }, S, 'tok'))).toBe('no error');
    expect(f.calls).toEqual([{ url: S + '/api/', method: 'GET', auth: 'Bearer tok' }]);
  });

  test('401 gives the sign-in message', async () => {
    const f = fakeFetch([{ status: 401, body: '401: Unauthorized' }]);
    expect(await code(checkToken({ fetch: f.fetch }, S, 'bad'))).toBe('rejected: ' + TOKEN_REJECTED);
    expect(TOKEN_REJECTED).toBe('Home Assistant did not accept the token. Make a new token in your profile.');
  });

  test('network, certificate and server errors', async () => {
    const dns = new TypeError('Failed to fetch', { cause: new Error('Could not resolve host: ha') });
    expect(await code(checkToken({ fetch: fakeFetch([dns]).fetch }, S, 't'))).toBe('network: The server did not answer');
    const tls = new TypeError('Failed to fetch', { cause: new Error('SSL certificate problem: unable to get local issuer certificate') });
    expect(await code(checkToken({ fetch: fakeFetch([tls]).fetch }, S, 't'))).toBe('certificate: The certificate is not valid');
    expect(await code(checkToken({ fetch: fakeFetch([{ status: 500, body: 'oops' }]).fetch }, S, 't'))).toBe('server: The server answered 500');
  });
});

describe('the token in the storage', () => {
  test('save, read and clear; the server URL stays', () => {
    const s = memory();
    expect(readCredentials(s)).toEqual({ server: '', token: null });
    saveCredentials(s, S, 'tok');
    expect(Object.fromEntries(s.map)).toEqual({ [SERVER_KEY]: S, [TOKEN_KEY]: 'tok' });
    expect([SERVER_KEY, TOKEN_KEY]).toEqual(['ha.server', 'ha.token']);
    expect(readCredentials(s)).toEqual({ server: S, token: 'tok' });
    clearToken(s);
    expect(readCredentials(s)).toEqual({ server: S, token: null });
  });

  test('a token without a server URL does not count', () => {
    expect(readCredentials(memory({ 'ha.token': 'tok' }))).toEqual({ server: '', token: null });
  });
});
```

Run `npx vitest run examples/ha-remote/test/auth.test.ts`. Expected: the file fails to load (`Cannot find module '../src/ha/auth.js'`).

- [ ] **Step 2: Write auth.ts**

Create `maemo-react/examples/ha-remote/src/ha/auth.ts`:

```ts
// The server URL and the long-lived access token (HA spec section 4). Only
// fetch and a storage object: the tests give fakes. There is no login flow,
// no token refresh and no revoke: the user makes the token in the Home
// Assistant profile, and deletes it there.

/** The sign-in message when Home Assistant refuses the token: auth_invalid on the socket, or HTTP 401. */
export const TOKEN_REJECTED = 'Home Assistant did not accept the token. Make a new token in your profile.';

export const SERVER_KEY = 'ha.server';
export const TOKEN_KEY = 'ha.token';

export type AuthCode = 'url' | 'token' | 'network' | 'certificate' | 'server' | 'rejected';

/** An error with a plain-words message for the screen (HA spec sections 2 and 7). */
export class AuthError extends Error {
  readonly code: AuthCode;

  constructor(code: AuthCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export interface AuthDeps {
  fetch: typeof fetch;
}

/** The part of localStorage that this module uses. */
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Credentials {
  /** '' when there is no saved server URL. */
  server: string;
  /** null when the user is not signed in. */
  token: string | null;
}

/**
 * The server URL as the application keeps it: the scheme, the host and the
 * port. Home Assistant does not run under a path, and a URL copied from the
 * browser often has the path of a dashboard.
 */
export function normalizeServer(input: string): string {
  let s = input.trim();
  if (s === '') throw new AuthError('url', 'Type the server URL');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new AuthError('url', 'The server URL is not valid');
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.host === '') throw new AuthError('url', 'The server URL must start with http:// or https://');
  return u.origin;
}

/** The token as the application keeps it. A paste often adds a space or a line break at the start or at the end. */
export function normalizeToken(input: string): string {
  const t = input.trim();
  if (t === '') throw new AuthError('token', 'Paste the token');
  if (/\s/.test(t)) throw new AuthError('token', 'The token has a space or a line break in it');
  return t;
}

/** The WebSocket URL of a server. */
export function socketUrl(server: string): string {
  return server.replace(/^http/, 'ws') + '/api/websocket';
}

function networkError(e: unknown): AuthError {
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : '';
  if (/certificate|SSL|TLS/i.test(cause)) return new AuthError('certificate', 'The certificate is not valid');
  return new AuthError('network', 'The server did not answer');
}

/**
 * Check the token before the application keeps it: GET /api/ with the
 * bearer token. Home Assistant answers 200 ({"message":"API running."}), or
 * 401 when it does not accept the token.
 */
export async function checkToken(deps: AuthDeps, server: string, token: string): Promise<void> {
  let r: Response;
  try {
    r = await deps.fetch(server + '/api/', { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
  } catch (e) {
    throw networkError(e);
  }
  if (r.status === 401) throw new AuthError('rejected', TOKEN_REJECTED);
  if (r.status !== 200) throw new AuthError('server', 'The server answered ' + r.status);
}

/** The saved server URL and token. A token without a server URL does not count. */
export function readCredentials(storage: TokenStorage): Credentials {
  const server = storage.getItem(SERVER_KEY) ?? '';
  const token = storage.getItem(TOKEN_KEY);
  return { server, token: server !== '' && token ? token : null };
}

export function saveCredentials(storage: TokenStorage, server: string, token: string): void {
  storage.setItem(SERVER_KEY, server);
  storage.setItem(TOKEN_KEY, token);
}

/** Delete the token and keep the server URL. The application cannot revoke a long-lived token. */
export function clearToken(storage: TokenStorage): void {
  storage.removeItem(TOKEN_KEY);
}

/** The text of an error for the screen. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run examples/ha-remote/test/auth.test.ts
npm run typecheck
```

Expected: every test passes; `tsc` prints nothing.

- [ ] **Step 4: Commit**

```bash
git add maemo-react/examples/ha-remote/src/ha/auth.ts maemo-react/examples/ha-remote/test/auth.test.ts
git commit -m "Add the server URL and token rules of HA Remote"
```

---

### Task 5: connection.ts, the live connection

**Files:**
- Create: `maemo-react/examples/ha-remote/src/ha/connection.ts`
- Create: `maemo-react/examples/ha-remote/test/connection.test.ts`

**Interfaces:**
- Consumes: the global `WebSocket` shape (M3a), timers.
- Produces: `BACKOFF_MS`, `PING_EVERY_MS`, `PONG_WITHIN_MS`; `HaError {code, message}`; `ConnectionEvent` (`connecting`, `connected {haVersion}`, `disconnected {reason, retryInMs}`, `auth-invalid {message}`); `ConnectionDeps {WebSocket, setTimeout, clearTimeout}`; `createConnection(deps, {url, token, onEvent}): Connection` with `start()`, `stop()`, `call(message): Promise<unknown>`, `subscribe(message, onEvent): Promise<number>`, `isConnected()`. After `auth_invalid` the connection stops and does not reconnect: a long-lived token does not become valid again. Task 6 uses it.

- [ ] **Step 1: Write the failing tests**

Create `maemo-react/examples/ha-remote/test/connection.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { BACKOFF_MS, HaError, createConnection, type ConnectionEvent } from '../src/ha/connection.js';

// A fake WebSocket. The test plays the server.
class FakeSocket {
  static all: FakeSocket[] = [];
  readonly url: string;
  sent: string[] = [];
  closed = false;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent<string | ArrayBuffer>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }

  send(data: string) {
    this.sent.push(String(data));
  }

  close() {
    this.closed = true;
  }

  /** The server accepts the socket and asks for auth. */
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
    this.serverSend({ type: 'auth_required', ha_version: '2025.1.0' });
  }

  serverSend(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent<string>);
  }

  serverClose(code = 1006, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: code === 1000 } as CloseEvent);
  }

  last() {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

// Fake timers that run when the test advances the clock.
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(nextId, { at: now + ms, fn });
      return nextId++;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, t] = due[0];
        timers.delete(id);
        now = t.at;
        t.fn();
        await Promise.resolve();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  FakeSocket.all = [];
  const timers = fakeTimers();
  const events: ConnectionEvent[] = [];
  const conn = createConnection(
    { WebSocket: FakeSocket as unknown as typeof WebSocket, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    { url: 'ws://ha:8123/api/websocket', token: 'tok', onEvent: (e) => events.push(e) },
  );
  const socket = () => FakeSocket.all[FakeSocket.all.length - 1];
  const types = () => events.map((e) => e.type);
  // Connect and authenticate.
  const up = async () => {
    conn.start();
    await tick();
    socket().open();
    socket().serverSend({ type: 'auth_ok', ha_version: '2025.1.0' });
  };
  return { conn, timers, events, socket, types, up };
}

describe('connection', () => {
  test('connects, sends the auth message, and reports connected', async () => {
    const t = setup();
    t.conn.start();
    expect(t.types()).toEqual(['connecting']);
    await tick();
    expect(t.socket().url).toBe('ws://ha:8123/api/websocket');
    t.socket().open();
    expect(t.socket().last()).toEqual({ type: 'auth', access_token: 'tok' });
    expect(t.conn.isConnected()).toBe(false);
    t.socket().serverSend({ type: 'auth_ok', ha_version: '2025.1.0' });
    expect(t.conn.isConnected()).toBe(true);
    expect(t.events[1]).toEqual({ type: 'connected', haVersion: '2025.1.0' });
  });

  test('call resolves with the result and rejects with the error', async () => {
    const t = setup();
    await t.up();
    const a = t.conn.call({ type: 'config/area_registry/list' });
    const b = t.conn.call({ type: 'call_service', domain: 'light', service: 'nope' });
    expect(t.socket().sent.slice(1).map((s) => JSON.parse(s).id)).toEqual([1, 2]);
    t.socket().serverSend({ id: 2, type: 'result', success: false, error: { code: 'not_found', message: 'Service not found' } });
    t.socket().serverSend({ id: 1, type: 'result', success: true, result: [{ area_id: 'k' }] });
    expect(await a).toEqual([{ area_id: 'k' }]);
    await expect(b).rejects.toMatchObject({ name: 'HaError', code: 'not_found', message: 'Service not found' });
  });

  test('subscribe routes the events of its id', async () => {
    const t = setup();
    await t.up();
    const got: unknown[] = [];
    const p = t.conn.subscribe({ type: 'subscribe_entities' }, (e) => got.push(e));
    t.socket().serverSend({ id: 1, type: 'result', success: true, result: null });
    expect(await p).toBe(1);
    t.socket().serverSend({ id: 1, type: 'event', event: { a: {} } });
    t.socket().serverSend({ id: 7, type: 'event', event: { a: { x: 1 } } });
    expect(got).toEqual([{ a: {} }]);
  });

  test('call before connected rejects', async () => {
    const t = setup();
    await expect(t.conn.call({ type: 'ping' })).rejects.toBeInstanceOf(HaError);
  });

  test('a ping every 30 s; no pong in 10 s closes the socket and reconnects', async () => {
    const t = setup();
    await t.up();
    await t.timers.advance(30000);
    expect(t.socket().last()).toEqual({ id: 1, type: 'ping' });
    t.socket().serverSend({ id: 1, type: 'pong' });
    await t.timers.advance(30000);
    expect(t.socket().last()).toEqual({ id: 2, type: 'ping' });
    const first = t.socket();
    await t.timers.advance(10000);
    expect(first.closed).toBe(true);
    expect(t.events[t.events.length - 1]).toEqual({ type: 'disconnected', reason: 'No pong in 10 s', retryInMs: 1000 });
    await t.timers.advance(1000);
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
  });

  test('the back-off is 1, 2, 5, 10, 30, 30 s, and auth_ok resets it', async () => {
    const t = setup();
    t.conn.start();
    const waits: Array<number | null> = [];
    for (let i = 0; i < 6; i++) {
      await tick();
      t.socket().serverClose();
      const last = t.events[t.events.length - 1];
      waits.push(last.type === 'disconnected' ? last.retryInMs : -1);
      await t.timers.advance(30000);
    }
    expect(waits).toEqual([...BACKOFF_MS, 30000]);
    await tick();
    t.socket().open();
    t.socket().serverSend({ type: 'auth_ok', ha_version: '1' });
    t.socket().serverClose();
    const last = t.events[t.events.length - 1];
    expect(last.type === 'disconnected' && last.retryInMs).toBe(1000);
  });

  test('stop closes the socket and does not reconnect; start connects at once', async () => {
    const t = setup();
    await t.up();
    const pending = t.conn.call({ type: 'ping' });
    t.conn.stop();
    expect(t.socket().closed).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(HaError);
    expect(t.events[t.events.length - 1]).toEqual({ type: 'disconnected', reason: 'Stopped', retryInMs: null });
    await t.timers.advance(60000);
    expect(FakeSocket.all).toHaveLength(1);
    t.conn.start();
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
  });

  test('start during a back-off wait connects at once', async () => {
    const t = setup();
    t.conn.start();
    await tick();
    t.socket().serverClose();
    t.conn.start();
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
    expect(t.timers.pending()).toBe(0);
  });

  test('auth_invalid reports and stops the reconnects', async () => {
    const t = setup();
    t.conn.start();
    await tick();
    t.socket().open();
    t.socket().serverSend({ type: 'auth_invalid', message: 'Invalid access token or password' });
    expect(t.events[t.events.length - 1]).toEqual({ type: 'auth-invalid', message: 'Invalid access token or password' });
    t.socket().serverClose(1000, '');
    expect(t.events[t.events.length - 1]).toEqual({ type: 'disconnected', reason: 'Connection closed (1000)', retryInMs: null });
    await t.timers.advance(60000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('a binary or broken message is ignored', async () => {
    const t = setup();
    await t.up();
    t.socket().onmessage?.({ data: new ArrayBuffer(2) } as MessageEvent<ArrayBuffer>);
    t.socket().onmessage?.({ data: '{not json' } as MessageEvent<string>);
    expect(t.conn.isConnected()).toBe(true);
  });
});
```

Run `npx vitest run examples/ha-remote/test/connection.test.ts`. Expected: the file fails to load.

- [ ] **Step 2: Write connection.ts**

Create `maemo-react/examples/ha-remote/src/ha/connection.ts`:

```ts
// The live connection (HA spec section 4): the socket, the auth message,
// the message ids, the pings and the reconnect with back-off. Only
// WebSocket and timers: the tests give fakes.

export const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
export const PING_EVERY_MS = 30000;
export const PONG_WITHIN_MS = 10000;

/** An error answer of Home Assistant, or a lost connection. */
export class HaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HaError';
    this.code = code;
  }
}

export type ConnectionEvent =
  | { type: 'connecting' }
  | { type: 'connected'; haVersion: string }
  | { type: 'disconnected'; reason: string; retryInMs: number | null }
  | { type: 'auth-invalid'; message: string };

export interface ConnectionDeps {
  WebSocket: typeof WebSocket;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export interface ConnectionOptions {
  url: string;
  /** The long-lived access token of the auth message. */
  token: string;
  onEvent: (event: ConnectionEvent) => void;
}

export interface Connection {
  /** Connect now, also during a back-off wait. Resets the back-off. */
  start(): void;
  /** Close the socket and stop the reconnects. */
  stop(): void;
  /** Send a command; resolves with its result, rejects with an HaError. */
  call(message: Record<string, unknown>): Promise<unknown>;
  /** Send a subscription; onEvent gets each event of its id. Resolves with the id. */
  subscribe(message: Record<string, unknown>, onEvent: (event: unknown) => void): Promise<number>;
  isConnected(): boolean;
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Message {
  id?: unknown;
  type?: unknown;
  success?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown } | null;
  event?: unknown;
  message?: unknown;
  ha_version?: unknown;
}

function parse(text: unknown): Message | null {
  if (typeof text !== 'string') return null;
  try {
    const m: unknown = JSON.parse(text);
    return typeof m === 'object' && m !== null ? (m as Message) : null;
  } catch {
    return null;
  }
}

export function createConnection(deps: ConnectionDeps, options: ConnectionOptions): Connection {
  let socket: WebSocket | null = null;
  let connected = false; // auth_ok arrived
  let wanted = false; // start() ran and stop() did not
  let attempt = 0;
  let nextId = 1;
  let retryTimer: number | null = null;
  let pingTimer: number | null = null;
  let pongTimer: number | null = null;
  const waiters = new Map<number, Waiter>();
  const subscriptions = new Map<number, (event: unknown) => void>();

  function clearTimer(id: number | null) {
    if (id !== null) deps.clearTimeout(id);
  }

  function stopTimers() {
    clearTimer(pingTimer);
    clearTimer(pongTimer);
    pingTimer = null;
    pongTimer = null;
  }

  function send(message: Record<string, unknown>): number {
    if (!socket || !connected) throw new HaError('disconnected', 'Not connected');
    const id = nextId++;
    socket.send(JSON.stringify({ id, ...message }));
    return id;
  }

  function failWaiters(reason: string) {
    for (const w of waiters.values()) w.reject(new HaError('disconnected', reason));
    waiters.clear();
    subscriptions.clear();
  }

  /** Forget the socket without a close handshake; onClosed runs the reconnect. */
  function detach(): WebSocket | null {
    const s = socket;
    if (!s) return null;
    s.onopen = null;
    s.onmessage = null;
    s.onerror = null;
    s.onclose = null;
    socket = null;
    return s;
  }

  function onClosed(reason: string) {
    connected = false;
    socket = null;
    stopTimers();
    failWaiters(reason);
    if (!wanted) {
      options.onEvent({ type: 'disconnected', reason, retryInMs: null });
      return;
    }
    const ms = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt++;
    options.onEvent({ type: 'disconnected', reason, retryInMs: ms });
    clearTimer(retryTimer);
    retryTimer = deps.setTimeout(() => {
      retryTimer = null;
      connect();
    }, ms);
  }

  function schedulePing() {
    clearTimer(pingTimer);
    pingTimer = deps.setTimeout(() => {
      pingTimer = null;
      if (!connected) return;
      let id: number;
      try {
        id = send({ type: 'ping' });
      } catch {
        return;
      }
      waiters.set(id, {
        resolve: () => {
          clearTimer(pongTimer);
          pongTimer = null;
          schedulePing();
        },
        reject: () => {},
      });
      pongTimer = deps.setTimeout(() => {
        pongTimer = null;
        const s = detach();
        if (s) s.close();
        onClosed('No pong in 10 s');
      }, PONG_WITHIN_MS);
    }, PING_EVERY_MS);
  }

  function handle(m: Message) {
    if (m.type === 'auth_ok') {
      connected = true;
      attempt = 0;
      options.onEvent({ type: 'connected', haVersion: String(m.ha_version ?? '') });
      schedulePing();
      return;
    }
    if (m.type === 'auth_invalid') {
      // Home Assistant closes the socket next. A long-lived token does not
      // become valid again, so there is no reconnect.
      wanted = false;
      options.onEvent({ type: 'auth-invalid', message: String(m.message ?? '') });
      return;
    }
    if (typeof m.id !== 'number') return;
    if (m.type === 'result') {
      const w = waiters.get(m.id);
      if (!w) return;
      waiters.delete(m.id);
      if (m.success) w.resolve(m.result);
      else w.reject(new HaError(String(m.error?.code ?? 'unknown'), String(m.error?.message ?? 'Home Assistant answered with an error')));
    } else if (m.type === 'pong') {
      const w = waiters.get(m.id);
      if (w) {
        waiters.delete(m.id);
        w.resolve(undefined);
      }
    } else if (m.type === 'event') {
      subscriptions.get(m.id)?.(m.event);
    }
  }

  function connect() {
    if (socket || !wanted) return;
    options.onEvent({ type: 'connecting' });
    const s = new deps.WebSocket(options.url);
    socket = s;
    s.onmessage = (e) => {
      const m = parse(e.data);
      if (!m) return;
      if (!connected && m.type === 'auth_required') {
        s.send(JSON.stringify({ type: 'auth', access_token: options.token }));
        return;
      }
      handle(m);
    };
    s.onerror = () => {};
    s.onclose = (e) => {
      if (socket !== s) return;
      onClosed(e.reason || 'Connection closed (' + e.code + ')');
    };
  }

  return {
    start() {
      wanted = true;
      attempt = 0;
      clearTimer(retryTimer);
      retryTimer = null;
      connect();
    },
    stop() {
      wanted = false;
      clearTimer(retryTimer);
      retryTimer = null;
      const s = detach();
      if (!s) return;
      s.close();
      onClosed('Stopped');
    },
    call(message) {
      return new Promise((resolve, reject) => {
        let id: number;
        try {
          id = send(message);
        } catch (e) {
          reject(e);
          return;
        }
        waiters.set(id, { resolve, reject });
      });
    },
    subscribe(message, onEvent) {
      return new Promise((resolve, reject) => {
        let id: number;
        try {
          id = send(message);
        } catch (e) {
          reject(e);
          return;
        }
        subscriptions.set(id, onEvent);
        waiters.set(id, {
          resolve: () => resolve(id),
          reject: (e) => {
            subscriptions.delete(id);
            reject(e);
          },
        });
      });
    },
    isConnected: () => connected,
  };
}
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run examples/ha-remote/test/connection.test.ts
npm run typecheck
```

Expected: every test passes; `tsc` prints nothing.

- [ ] **Step 4: Commit**

```bash
git add maemo-react/examples/ha-remote/src/ha/connection.ts maemo-react/examples/ha-remote/test/connection.test.ts
git commit -m "Add the Home Assistant connection with pings and back-off"
```

---

### Task 6: actions.ts and store.ts

**Files:**
- Create: `maemo-react/examples/ha-remote/src/ha/actions.ts`, `maemo-react/examples/ha-remote/src/ha/store.ts`
- Create: `maemo-react/examples/ha-remote/test/fakes.ts` (the fakes that Tasks 5 and 6 share)
- Modify: `maemo-react/examples/ha-remote/test/connection.test.ts` (import the fakes)
- Create: `maemo-react/examples/ha-remote/test/actions.test.ts`, `maemo-react/examples/ha-remote/test/store.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4 and 5.
- Produces (`actions.ts`): `toggleCall(e)`, `brightnessCall(e, pct)`, `temperatureCall(e, direction)`, `temperatureStep(e)`, `modeCall(e, mode)`, `hvacModes(e)`, `coverFeatures(e)`, `coverCall(e, action)`, `positionCall(e, position)`, `hasBrightness(e)`, `brightnessPct(e)`.
- Produces (`store.ts`): `createStore(deps): Store`, `State`, `SignInState {server, error, busy}`, `Store` (with `signIn(server, token): Promise<void>` and `signOut(): void`), `StoreDeps`, `Screen`, `Status`, `PENDING_MS`, `PAUSE_AFTER_MS`, `SNAPSHOT_EVERY_MS`. The UI (Task 7) reads `getState()` with `useSyncExternalStore(store.subscribe, store.getState)` and calls the methods.

- [ ] **Step 1: Move the fakes of Task 5 to a shared file**

Create `maemo-react/examples/ha-remote/test/fakes.ts` with the `FakeSocket` class and the `fakeTimers` function exactly as they are in `connection.test.ts`, with `export` in front of each, plus a fake storage:

```ts
/** A fake localStorage: a Map. */
export function fakeStorage(init: Record<string, string> = {}) {
  let map = new Map(Object.entries(init));
  return {
    get length() {
      return map.size;
    },
    key: (n: number) => [...map.keys()][n] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem(k: string, v: string) {
      map.set(k, String(v));
    },
    removeItem(k: string) {
      map.delete(k);
    },
    clear() {
      map = new Map();
    },
    /** For the tests: every item. */
    all: () => Object.fromEntries(map),
  };
}
```

In `connection.test.ts`, delete the inline `FakeSocket` and `fakeTimers`, and add `import { FakeSocket, fakeTimers } from './fakes.js';`. Run `npx vitest run examples/ha-remote/test/connection.test.ts`; expected: every test still passes.

- [ ] **Step 2: Write the failing tests of actions.ts**

Create `maemo-react/examples/ha-remote/test/actions.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { brightnessCall, brightnessPct, coverCall, coverFeatures, hasBrightness, hvacModes, modeCall, positionCall, temperatureCall, temperatureStep, toggleCall } from '../src/ha/actions.js';
import type { Entity } from '../src/ha/types.js';

const entity = (id: string, state: string, attrs: Record<string, unknown> = {}): Entity => ({
  id, domain: id.slice(0, id.indexOf('.')) as Entity['domain'], name: id, areaId: null, state, attrs,
});

describe('actions', () => {
  test('toggle for on/off domains only', () => {
    expect(toggleCall(entity('light.a', 'on'))).toEqual({ domain: 'light', service: 'toggle', target: { entity_id: 'light.a' } });
    expect(toggleCall(entity('input_boolean.a', 'off'))?.service).toBe('toggle');
    expect(toggleCall(entity('climate.a', 'heat'))).toBeNull();
    expect(toggleCall(entity('cover.a', 'open'))).toBeNull();
  });

  test('brightness', () => {
    const e = entity('light.a', 'on', { brightness: 128, supported_color_modes: ['brightness'] });
    expect(brightnessCall(e, 60.4)).toEqual({ domain: 'light', service: 'turn_on', service_data: { brightness_pct: 60 }, target: { entity_id: 'light.a' } });
    expect(brightnessCall(e, 150).service_data).toEqual({ brightness_pct: 100 });
    expect([hasBrightness(e), hasBrightness(entity('light.b', 'on', { supported_color_modes: ['onoff'] })), hasBrightness(entity('light.c', 'on'))]).toEqual([true, false, false]);
    expect([brightnessPct(e), brightnessPct(entity('light.b', 'off', { brightness: 128 }))]).toEqual([50, 0]);
  });

  test('temperature steps within the limits', () => {
    const e = entity('climate.a', 'heat', { temperature: 21, target_temp_step: 0.5, min_temp: 7, max_temp: 21.4 });
    expect(temperatureStep(e)).toBe(0.5);
    expect(temperatureCall(e, 1)?.service_data).toEqual({ temperature: 21.4 });
    expect(temperatureCall(e, -1)).toEqual({ domain: 'climate', service: 'set_temperature', service_data: { temperature: 20.5 }, target: { entity_id: 'climate.a' } });
    expect(temperatureStep(entity('climate.b', 'heat'))).toBe(0.5);
    expect(temperatureCall(entity('climate.b', 'heat'), 1)).toBeNull();
    expect(temperatureCall(entity('climate.c', 'heat', { temperature: 20.1, target_temp_step: 1 }), 1)?.service_data).toEqual({ temperature: 21.1 });
  });

  test('mode', () => {
    const e = entity('climate.a', 'heat', { hvac_modes: ['off', 'heat', 7] });
    expect(hvacModes(e)).toEqual(['off', 'heat']);
    expect(modeCall(e, 'off')).toEqual({ domain: 'climate', service: 'set_hvac_mode', service_data: { hvac_mode: 'off' }, target: { entity_id: 'climate.a' } });
  });

  test('cover', () => {
    const e = entity('cover.a', 'open', { supported_features: 15, current_position: 100 });
    expect(coverFeatures(e)).toEqual({ open: true, close: true, stop: true, position: true });
    expect(coverFeatures(entity('cover.b', 'open', { supported_features: 3 }))).toEqual({ open: true, close: true, stop: false, position: false });
    expect(coverFeatures(entity('cover.c', 'open', { supported_features: 4 }))).toEqual({ open: false, close: false, stop: false, position: false });
    expect(coverCall(e, 'open').service).toBe('open_cover');
    expect(coverCall(e, 'stop').service).toBe('stop_cover');
    expect(coverCall(e, 'close').service).toBe('close_cover');
    expect(positionCall(e, 40)).toEqual({ domain: 'cover', service: 'set_cover_position', service_data: { position: 40 }, target: { entity_id: 'cover.a' } });
  });
});
```

- [ ] **Step 3: Write actions.ts**

Create `maemo-react/examples/ha-remote/src/ha/actions.ts`:

```ts
// An entity and a user action to a service call (HA spec section 4). Pure
// functions: no network, no state.
import type { Entity, ServiceCall } from './types.js';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function call(e: Entity, service: string, data?: Record<string, unknown>): ServiceCall {
  return data ? { domain: e.domain, service, service_data: data, target: { entity_id: e.id } } : { domain: e.domain, service, target: { entity_id: e.id } };
}

/** The toggle of a row: <domain>.toggle. null for climate and cover. */
export function toggleCall(e: Entity): ServiceCall | null {
  return e.domain === 'climate' || e.domain === 'cover' ? null : call(e, 'toggle');
}

/** A light has a brightness when it supports a color mode other than onoff. */
export function hasBrightness(e: Entity): boolean {
  const modes = e.attrs.supported_color_modes;
  return Array.isArray(modes) && modes.some((m) => m !== 'onoff');
}

/** The brightness in percent; 0 when the light is off. */
export function brightnessPct(e: Entity): number {
  const b = e.attrs.brightness;
  return e.state === 'on' && typeof b === 'number' ? Math.round((b / 255) * 100) : 0;
}

export function brightnessCall(e: Entity, pct: number): ServiceCall {
  return call(e, 'turn_on', { brightness_pct: clamp(Math.round(pct), 0, 100) });
}

export function temperatureStep(e: Entity): number {
  const s = e.attrs.target_temp_step;
  return typeof s === 'number' && s > 0 ? s : 0.5;
}

/** The target temperature one step up or down, within min_temp..max_temp. null without a target. */
export function temperatureCall(e: Entity, direction: 1 | -1): ServiceCall | null {
  const t = e.attrs.temperature;
  if (typeof t !== 'number') return null;
  const min = typeof e.attrs.min_temp === 'number' ? e.attrs.min_temp : 7;
  const max = typeof e.attrs.max_temp === 'number' ? e.attrs.max_temp : 35;
  const next = clamp(Math.round((t + direction * temperatureStep(e)) * 10) / 10, min, max);
  return call(e, 'set_temperature', { temperature: next });
}

export function hvacModes(e: Entity): string[] {
  const modes = e.attrs.hvac_modes;
  return Array.isArray(modes) ? modes.filter((m): m is string => typeof m === 'string') : [];
}

export function modeCall(e: Entity, mode: string): ServiceCall {
  return call(e, 'set_hvac_mode', { hvac_mode: mode });
}

const COVER_OPEN = 1;
const COVER_CLOSE = 2;
const COVER_SET_POSITION = 4;
const COVER_STOP = 8;

/** The buttons of a cover, from supported_features. position needs a current_position too. */
export function coverFeatures(e: Entity): { open: boolean; close: boolean; stop: boolean; position: boolean } {
  const f = typeof e.attrs.supported_features === 'number' ? e.attrs.supported_features : 0;
  return {
    open: (f & COVER_OPEN) !== 0,
    close: (f & COVER_CLOSE) !== 0,
    stop: (f & COVER_STOP) !== 0,
    position: (f & COVER_SET_POSITION) !== 0 && typeof e.attrs.current_position === 'number',
  };
}

export function coverCall(e: Entity, action: 'open' | 'stop' | 'close'): ServiceCall {
  return call(e, action + '_cover');
}

export function positionCall(e: Entity, position: number): ServiceCall {
  return call(e, 'set_cover_position', { position: clamp(Math.round(position), 0, 100) });
}
```

Run `npx vitest run examples/ha-remote/test/actions.test.ts`. Expected: every test passes.

- [ ] **Step 4: Write the failing tests of store.ts**

Create `maemo-react/examples/ha-remote/test/store.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { TOKEN_REJECTED } from '../src/ha/auth.js';
import { PAUSE_AFTER_MS, PENDING_MS, SNAPSHOT_EVERY_MS, createStore, type State } from '../src/ha/store.js';
import type { StatesEvent } from '../src/ha/types.js';
import { FakeSocket, fakeStorage, fakeTimers } from './fakes.js';
import registries from './fixtures/registries.json';
import states from './fixtures/states.json';

const S = 'http://ha:8123';
const NOW = 1_700_000_000_000;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ticks = async (n = 5) => {
  for (let i = 0; i < n; i++) await tick();
};

// A fake fetch: one answer for each URL suffix, in order of the calls to that suffix.
function fakeFetch(script: Record<string, unknown[]>) {
  const calls: Array<{ url: string; auth: string }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, auth: new Headers(init?.headers).get('authorization') ?? '' });
    const key = Object.keys(script).find((k) => u.endsWith(k));
    const a = key ? script[key].shift() : undefined;
    if (a === undefined) throw new TypeError('Failed to fetch', { cause: new Error('no answer for ' + u) });
    if (a instanceof Error) throw a;
    const { status, ...body } = a as { status?: number };
    return new Response(JSON.stringify(body), { status: status ?? 200 });
  }) as typeof fetch;
  return { fetch, calls };
}

// Answer the registry commands and the subscription like Home Assistant.
function serve(socket: FakeSocket, firstEvent: StatesEvent = states as StatesEvent) {
  const answered = new Set<number>();
  for (const text of socket.sent) {
    const m = JSON.parse(text);
    if (typeof m.id !== 'number' || answered.has(m.id)) continue;
    answered.add(m.id);
    if (m.type === 'config/area_registry/list') socket.serverSend({ id: m.id, type: 'result', success: true, result: registries.areas });
    else if (m.type === 'config/device_registry/list') socket.serverSend({ id: m.id, type: 'result', success: true, result: registries.devices });
    else if (m.type === 'config/entity_registry/list_for_display') socket.serverSend({ id: m.id, type: 'result', success: true, result: registries.display });
    else if (m.type === 'subscribe_entities') {
      socket.serverSend({ id: m.id, type: 'result', success: true, result: null });
      socket.serverSend({ id: m.id, type: 'event', event: firstEvent });
    }
  }
  return answered;
}

function setup(init: Record<string, string> = {}, script: Record<string, unknown[]> = {}) {
  FakeSocket.all = [];
  const timers = fakeTimers();
  const storage = fakeStorage(init);
  const f = fakeFetch(script);
  const banners: string[] = [];
  let now = NOW;
  const store = createStore({
    fetch: f.fetch,
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    storage: storage as unknown as Storage,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => now,
    banner: (t) => banners.push(t),
    versions: { app: '0.1.0', runtime: '0.3.0' },
  });
  let notifications = 0;
  store.subscribe(() => notifications++);
  const socket = () => FakeSocket.all[FakeSocket.all.length - 1];
  const st = () => store.getState();
  const row = (id: string) => st().pages.flatMap((p) => p.rows).find((r) => r.key === id);
  const page = (key: string) => st().pages.find((p) => p.key === key);
  const subId = () => JSON.parse(socket().sent.find((s) => JSON.parse(s).type === 'subscribe_entities')!).id as number;
  /** Answer each ping at once, so a long advance of the clock does not drop the socket. */
  const autoPong = (s: FakeSocket) => {
    const send = s.send.bind(s);
    s.send = (data: string) => {
      send(data);
      const m = JSON.parse(String(data));
      // Later, as a real server: the connection registers the ping after send() returns.
      if (m.type === 'ping') void Promise.resolve().then(() => s.serverSend({ id: m.id, type: 'pong' }));
    };
  };
  /** Open the socket, authenticate, and serve the registries and the first event. */
  const up = async () => {
    await ticks();
    autoPong(socket());
    socket().open();
    socket().serverSend({ type: 'auth_ok', ha_version: '2025.1.0' });
    await ticks();
    serve(socket());
    await ticks();
    serve(socket());
    await ticks();
  };
  const signedIn = async () => {
    store.start();
    await store.signIn(S, 'tok');
    await up();
  };
  return { store, timers, storage, f, banners, socket, st, row, page, subId, up, signedIn, count: () => notifications, setNow: (t: number) => (now = t) };
}

/** The answer of GET /api/ to a good token. */
const API = () => ({ '/api/': [{ message: 'API running.' }] });

describe('start', () => {
  test('without a token: the sign-in screen with the saved server', () => {
    const t = setup({ 'ha.server': S });
    t.store.start();
    expect(t.st().screen).toBe('signin');
    expect(t.st().signin.server).toBe(S);
    expect(FakeSocket.all).toHaveLength(0);
  });

  test('with a snapshot: the main screen at once, offline, then connect', async () => {
    const snapshot = {
      areas: [{ id: 'kitchen', name: 'Kitchen' }],
      entities: [{ id: 'switch.fan', domain: 'switch', name: 'Fan', areaId: 'kitchen', state: 'on', attrs: { friendly_name: 'Fan' } }],
      haVersion: '2024.12.0',
    };
    const t = setup({ 'ha.server': S, 'ha.token': 'tok', 'ha.snapshot': JSON.stringify(snapshot) });
    t.store.start();
    expect([t.st().screen, t.st().status, t.st().haVersion]).toEqual(['main', 'connecting', '2024.12.0']);
    expect(t.st().pages.map((p) => p.name)).toEqual(['Kitchen']);
    expect(t.row('switch.fan')).toEqual({ key: 'switch.fan', name: 'Fan', state: 'On', on: null });
    await t.up();
    expect(t.st().status).toBe('connected');
    expect(t.row('switch.fan')).toMatchObject({ state: 'Off', on: false });
    expect(t.st().pages.map((p) => p.name)).toEqual(['Living room', 'Kitchen', 'Other']);
  });
});

describe('sign-in', () => {
  test('signIn checks the token, stores the server and the token, shows main, and connects', async () => {
    const t = setup({}, API());
    await t.signedIn();
    expect(t.f.calls).toEqual([{ url: S + '/api/', auth: 'Bearer tok' }]);
    expect(t.storage.getItem('ha.server')).toBe(S);
    expect(t.storage.getItem('ha.token')).toBe('tok');
    expect(t.socket().sent[0]).toBe(JSON.stringify({ type: 'auth', access_token: 'tok' }));
    expect([t.st().screen, t.st().status, t.st().haVersion]).toEqual(['main', 'connected', '2025.1.0']);
    expect(t.socket().url).toBe('ws://ha:8123/api/websocket');
    expect(t.st().pages.map((p) => p.key)).toEqual(['living_room', 'kitchen', 'other']);
    expect(t.st().pageRows.map((p) => p.name)).toEqual(['Living room', 'Kitchen', 'Other']);
    expect(t.page('living_room')!.rows.map((r) => r.name)).toEqual(['Blinds', 'Ceiling light', 'Desk', 'Thermostat']);
    expect(t.row('light.ceiling')).toEqual({ key: 'light.ceiling', name: 'Ceiling light', state: 'On 50 %', on: true });
    expect(t.st().selectedPage).toBe('living_room');
    expect(t.st().lastUpdate).toBe(NOW);
  });

  test('a pasted token loses its spaces and line breaks, and a URL with a path keeps only the origin', async () => {
    const t = setup({}, API());
    t.store.start();
    await t.store.signIn(' https://x.ui.nabu.casa/lovelace/0 ', '  tok\n');
    expect(t.f.calls).toEqual([{ url: 'https://x.ui.nabu.casa/api/', auth: 'Bearer tok' }]);
    expect(t.storage.getItem('ha.server')).toBe('https://x.ui.nabu.casa');
    expect(t.storage.getItem('ha.token')).toBe('tok');
    expect(t.socket().url).toBe('wss://x.ui.nabu.casa/api/websocket');
  });

  test('a token that Home Assistant refuses keeps the screen and shows the message', async () => {
    const t = setup({}, { '/api/': [{ status: 401, message: '401: Unauthorized' }] });
    t.store.start();
    await t.store.signIn('ha:8123', 'bad');
    expect(t.st().screen).toBe('signin');
    expect(t.st().signin).toEqual({ server: S, error: TOKEN_REJECTED, busy: false });
    expect(t.storage.getItem('ha.token')).toBeNull();
    expect(FakeSocket.all).toHaveLength(0);
  });

  test('a bad URL or an empty token shows the message without a request; no answer shows the network error', async () => {
    const t = setup();
    t.store.start();
    await t.store.signIn('', 'tok');
    expect(t.st().signin.error).toBe('Type the server URL');
    await t.store.signIn(S, ' \n');
    expect(t.st().signin.error).toBe('Paste the token');
    expect(t.f.calls).toHaveLength(0);
    await t.store.signIn(S, 'tok');
    expect(t.st().signin).toEqual({ server: S, error: 'The server did not answer', busy: false });
  });
});

describe('live state', () => {
  test('one notification per message, and the unchanged rows and pages keep their objects', async () => {
    const t = setup({}, API());
    await t.signedIn();
    const before = t.st();
    const desk = t.row('light.desk');
    const kitchen = t.page('kitchen');
    const n = t.count();
    t.socket().serverSend({ id: t.subId(), type: 'event', event: { c: { 'light.ceiling': { '+': { s: 'off', a: { brightness: 0 } } } } } });
    expect(t.count()).toBe(n + 1);
    expect(t.row('light.ceiling')).toMatchObject({ state: 'Off', on: false });
    expect(t.row('light.desk')).toBe(desk);
    expect(t.page('kitchen')).toBe(kitchen);
    expect(t.page('living_room')).not.toBe(before.pages[0]);
    expect(t.st().pageRows).toBe(before.pageRows);
  });

  test('a removed entity goes away, and the selection of a removed entity clears', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.selectEntity('switch.fan');
    t.socket().serverSend({ id: t.subId(), type: 'event', event: { r: ['switch.fan'] } });
    expect(t.row('switch.fan')).toBeUndefined();
    expect(t.st().pages.map((p) => p.key)).toEqual(['living_room', 'other']);
    expect(t.st().selectedEntity).toBeNull();
  });

  test('toggle sends the call, marks the row pending, and the new state clears it', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.toggle('light.ceiling');
    const sent = JSON.parse(t.socket().sent[t.socket().sent.length - 1]);
    expect(sent).toMatchObject({ type: 'call_service', domain: 'light', service: 'toggle', target: { entity_id: 'light.ceiling' } });
    expect(t.row('light.ceiling')!.state).toBe('On 50 % ...');
    expect(t.st().pending.has('light.ceiling')).toBe(true);
    t.socket().serverSend({ id: sent.id, type: 'result', success: true, result: { context: {} } });
    t.socket().serverSend({ id: t.subId(), type: 'event', event: { c: { 'light.ceiling': { '+': { s: 'off' } } } } });
    expect(t.row('light.ceiling')!.state).toBe('Off');
    expect(t.st().pending.size).toBe(0);
    await t.timers.advance(PENDING_MS);
    expect(t.banners).toEqual([]);
  });

  test('no state change in 5 s shows a banner and clears the pending mark', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.toggle('switch.fan');
    await t.timers.advance(PENDING_MS);
    expect(t.banners).toEqual(['Home Assistant did not answer']);
    expect(t.row('switch.fan')!.state).toBe('Off');
  });

  test('a call_service error shows a banner with the message of Home Assistant', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setMode('climate.thermostat', 'dry');
    const sent = JSON.parse(t.socket().sent[t.socket().sent.length - 1]);
    expect(sent).toMatchObject({ domain: 'climate', service: 'set_hvac_mode', service_data: { hvac_mode: 'dry' } });
    t.socket().serverSend({ id: sent.id, type: 'result', success: false, error: { code: 'invalid_format', message: 'value must be one of [off, heat, cool]' } });
    await ticks();
    expect(t.banners).toEqual(['value must be one of [off, heat, cool]']);
    expect(t.st().pending.size).toBe(0);
  });

  test('the other actions send their calls', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setBrightness('light.ceiling', 75);
    t.store.stepTemperature('climate.thermostat', 1);
    t.store.cover('cover.blinds', 'close');
    t.store.setPosition('cover.blinds', 30);
    t.store.toggle('climate.thermostat');
    const sent = t.socket().sent.slice(-4).map((s) => JSON.parse(s));
    expect(sent.map((m) => [m.service, m.service_data])).toEqual([
      ['turn_on', { brightness_pct: 75 }],
      ['set_temperature', { temperature: 21.5 }],
      ['close_cover', undefined],
      ['set_cover_position', { position: 30 }],
    ]);
  });

  test('a disconnect hides the toggles and shows offline; a reconnect brings them back', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.socket().serverClose();
    expect(t.st().status).toBe('offline');
    expect(t.row('light.ceiling')).toMatchObject({ state: 'On 50 %', on: null });
    await t.timers.advance(1000);
    await t.up();
    expect(t.st().status).toBe('connected');
    expect(t.row('light.ceiling')!.on).toBe(true);
  });

  test('the snapshot is written 10 s after a change, with the small attributes only', async () => {
    const t = setup({}, API());
    await t.signedIn();
    expect(t.storage.getItem('ha.snapshot')).toBeNull();
    await t.timers.advance(SNAPSHOT_EVERY_MS);
    const snap = JSON.parse(t.storage.getItem('ha.snapshot')!);
    expect(snap.areas.map((a: { id: string }) => a.id)).toEqual(['living_room', 'kitchen', 'garage']);
    expect(snap.haVersion).toBe('2025.1.0');
    const ceiling = snap.entities.find((e: { id: string }) => e.id === 'light.ceiling');
    expect(ceiling).toMatchObject({ domain: 'light', areaId: 'living_room', state: 'on', attrs: { friendly_name: 'Ceiling light', brightness: 128 } });
    expect(ceiling.attrs).not.toHaveProperty('color_mode');
  });
});

describe('favorites', () => {
  test('setFavorite adds the Favorites page first, in the order added, and persists', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setFavorite('switch.fan', true);
    t.store.setFavorite('light.ceiling', true);
    expect(t.st().pages[0].key).toBe('favorites');
    expect(t.st().pages[0].rows.map((r) => r.key)).toEqual(['switch.fan', 'light.ceiling']);
    expect(t.row('switch.fan')).toBe(t.page('kitchen')!.rows[0]);
    expect(JSON.parse(t.storage.getItem('ha.favorites')!)).toEqual(['switch.fan', 'light.ceiling']);
    t.store.setFavorite('switch.fan', false);
    expect(t.st().pages[0].rows.map((r) => r.key)).toEqual(['light.ceiling']);
  });

  test('a removed favorite stays in storage and shows nothing', async () => {
    const t = setup({ 'ha.favorites': JSON.stringify(['switch.fan', 'light.gone']) }, API());
    await t.signedIn();
    expect(t.st().pages[0].rows.map((r) => r.key)).toEqual(['switch.fan']);
    t.socket().serverSend({ id: t.subId(), type: 'event', event: { r: ['switch.fan'] } });
    expect(t.st().pages[0].key).not.toBe('favorites');
    expect(JSON.parse(t.storage.getItem('ha.favorites')!)).toEqual(['switch.fan', 'light.gone']);
  });
});

describe('the token and sign-out', () => {
  test('auth_invalid deletes the token and shows the sign-in screen with the server URL; no reconnect', async () => {
    const t = setup({ 'ha.server': S, 'ha.token': 'old', 'ha.favorites': '["switch.fan"]' });
    t.store.start();
    await ticks();
    t.socket().open();
    expect(t.socket().sent[0]).toBe(JSON.stringify({ type: 'auth', access_token: 'old' }));
    t.socket().serverSend({ type: 'auth_invalid', message: 'Invalid access token or password' });
    t.socket().serverClose(1000);
    await t.timers.advance(60000);
    await ticks();
    expect(t.st().screen).toBe('signin');
    expect(t.st().signin).toEqual({ server: S, error: TOKEN_REJECTED, busy: false });
    expect(t.storage.getItem('ha.token')).toBeNull();
    expect(t.storage.getItem('ha.server')).toBe(S);
    expect(t.storage.getItem('ha.favorites')).toBe('["switch.fan"]');
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('signOut deletes the token and the snapshot, sends no request, and keeps the server and the favorites', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setFavorite('switch.fan', true);
    await t.timers.advance(SNAPSHOT_EVERY_MS);
    const requests = t.f.calls.length;
    t.store.signOut();
    expect(t.f.calls).toHaveLength(requests);
    expect([t.st().screen, t.st().status, t.st().pages.length]).toEqual(['signin', 'offline', 0]);
    expect(t.st().signin).toEqual({ server: S, error: null, busy: false });
    expect(t.storage.all()).toEqual({ 'ha.server': S, 'ha.favorites': '["switch.fan"]' });
    expect(t.socket().closed).toBe(true);
  });
});

describe('topmost', () => {
  test('60 s behind another window closes the socket; coming back connects at once', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setTopmost(false);
    await t.timers.advance(PAUSE_AFTER_MS - 1);
    expect(t.socket().closed).toBe(false);
    await t.timers.advance(1);
    expect(t.socket().closed).toBe(true);
    expect(t.st().status).toBe('offline');
    expect(t.storage.getItem('ha.snapshot')).not.toBeNull();
    t.store.setTopmost(true);
    await ticks();
    expect(FakeSocket.all).toHaveLength(2);
  });

  test('coming back before 60 s keeps the socket', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.setTopmost(false);
    await t.timers.advance(30000);
    t.store.setTopmost(true);
    await t.timers.advance(60000);
    expect(t.socket().closed).toBe(false);
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('reconnect from the menu connects at once during a back-off wait', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.socket().serverClose();
    t.store.reconnect();
    await ticks();
    expect(FakeSocket.all).toHaveLength(2);
  });
});

describe('screens', () => {
  test('about and back', async () => {
    const t = setup({}, API());
    await t.signedIn();
    t.store.showAbout();
    expect(t.st().screen).toBe('about');
    t.store.showMain();
    expect(t.st().screen).toBe('main');
    const s: State = t.st();
    expect(s.versions).toEqual({ app: '0.1.0', runtime: '0.3.0' });
  });
});
```

Run `npx vitest run examples/ha-remote/test/store.test.ts`. Expected: the file fails to load.

- [ ] **Step 5: Write store.ts**

Create `maemo-react/examples/ha-remote/src/ha/store.ts`:

```ts
// The state of the application (HA spec section 3): one object, listeners
// for useSyncExternalStore, and one notification per Home Assistant
// message. No React, no GTK: the tests give fakes for fetch, WebSocket,
// localStorage and the timers.
import { brightnessCall, coverCall, modeCall, positionCall, temperatureCall, toggleCall } from './actions.js';
import { TOKEN_REJECTED, checkToken, clearToken, messageOf, normalizeServer, normalizeToken, readCredentials, saveCredentials, socketUrl } from './auth.js';
import { HaError, createConnection, type Connection, type ConnectionEvent } from './connection.js';
import { FAVORITES, OTHER, applyStates, emptyRegistries, makeRow, pageKeysOf, pageName, parseAreas, parseDevices, parseDisplay, placeAgain, sortRows, type Registries } from './model.js';
import type { Area, Entity, Page, PageRow, Row, ServiceCall, StatesEvent } from './types.js';

/** A service call with no new state in this time shows a banner (HA spec section 3). */
export const PENDING_MS = 5000;
/** The window is behind another one for this long: close the socket (HA spec section 4). */
export const PAUSE_AFTER_MS = 60000;
/** The snapshot is written at most this often. */
export const SNAPSHOT_EVERY_MS = 10000;
/** The attributes that the rows and the detail panel use. The snapshot keeps only these. */
export const SNAPSHOT_ATTRS = [
  'friendly_name', 'brightness', 'supported_color_modes', 'temperature', 'current_temperature', 'hvac_modes',
  'target_temp_step', 'min_temp', 'max_temp', 'current_position', 'supported_features',
];

export interface StoreDeps {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  storage: Storage;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  now: () => number;
  banner: (text: string) => void;
  versions: { app: string; runtime: string };
}

export type Screen = 'signin' | 'main' | 'about';
export type Status = 'offline' | 'connecting' | 'connected';

export interface SignInState {
  server: string;
  error: string | null;
  /** The token check (GET /api/) runs. */
  busy: boolean;
}

export interface State {
  screen: Screen;
  signin: SignInState;
  status: Status;
  lastUpdate: number | null;
  haVersion: string | null;
  pages: Page[];
  pageRows: PageRow[];
  selectedPage: string | null;
  selectedEntity: string | null;
  entities: Map<string, Entity>;
  favorites: string[];
  pending: ReadonlySet<string>;
  versions: { app: string; runtime: string };
}

export interface Store {
  subscribe(fn: () => void): () => void;
  getState(): State;
  /** Read the storage, show the snapshot, and connect when there is a token. */
  start(): void;
  /** Check the token with GET /api/; keep it and connect when Home Assistant accepts it. */
  signIn(server: string, token: string): Promise<void>;
  /** Delete the token from the storage. The token stays valid on the server until the user deletes it there. */
  signOut(): void;
  reconnect(): void;
  selectPage(key: string | null): void;
  selectEntity(id: string | null): void;
  toggle(id: string): void;
  setBrightness(id: string, pct: number): void;
  stepTemperature(id: string, direction: 1 | -1): void;
  setMode(id: string, mode: string): void;
  cover(id: string, action: 'open' | 'stop' | 'close'): void;
  setPosition(id: string, position: number): void;
  setFavorite(id: string, on: boolean): void;
  setTopmost(topmost: boolean): void;
  showAbout(): void;
  showMain(): void;
  /** Write the snapshot now. Call it before the application quits. */
  flush(): void;
}

interface Snapshot {
  areas: Area[];
  entities: Entity[];
  haVersion: string | null;
}

// ha.server and ha.token belong to auth.ts.
const KEYS = { favorites: 'ha.favorites', snapshot: 'ha.snapshot' };

function readJson(storage: Storage, key: string): unknown {
  const text = storage.getItem(key);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readFavorites(storage: Storage): string[] {
  const f = readJson(storage, KEYS.favorites);
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : [];
}

function readSnapshot(storage: Storage): Snapshot | null {
  const s = readJson(storage, KEYS.snapshot);
  if (!isObject(s) || !Array.isArray(s.areas) || !Array.isArray(s.entities)) return null;
  const entities = s.entities.filter((e): e is Entity => isObject(e) && typeof e.id === 'string' && typeof e.state === 'string' && isObject(e.attrs));
  return { areas: s.areas.filter((a): a is Area => isObject(a) && typeof a.id === 'string'), entities, haVersion: typeof s.haVersion === 'string' ? s.haVersion : null };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function createStore(deps: StoreDeps): Store {
  const listeners = new Set<() => void>();
  let state: State = {
    screen: 'signin',
    signin: { server: '', error: null, busy: false },
    status: 'offline',
    lastUpdate: null,
    haVersion: null,
    pages: [],
    pageRows: [],
    selectedPage: null,
    selectedEntity: null,
    entities: new Map(),
    favorites: [],
    pending: new Set(),
    versions: deps.versions,
  };

  const authDeps = { fetch: deps.fetch };
  let server = '';
  let token: string | null = null;
  let reg: Registries = emptyRegistries();
  let connection: Connection | null = null;
  let live = false; // the subscription is up: the toggles show
  let firstEvent = false; // the next states event replaces everything
  let paused = false;
  let pauseTimer: number | null = null;
  let snapshotTimer: number | null = null;
  let snapshotDirty = false;
  const rows = new Map<string, Row>();
  const rowPages = new Map<string, string[]>();
  const pageRowsByKey = new Map<string, Row[]>();
  const pendingTimers = new Map<string, number>();

  function notify() {
    for (const fn of listeners) fn();
  }

  function set(patch: Partial<State>) {
    state = { ...state, ...patch };
    notify();
  }

  // ---- rows and pages ----

  /**
   * Make the rows of the changed entities again, rebuild only the pages that
   * hold a changed row, and notify once. With all, every row is made again
   * (the toggles appear or go away).
   */
  function rebuild(entities: Map<string, Entity>, changed: Iterable<string>, all: boolean, extra: Partial<State> = {}, pending: ReadonlySet<string> = state.pending) {
    const favorites = extra.favorites ?? state.favorites;
    const favoriteSet = new Set(favorites);
    const dirty = new Set<string>();
    const ids = new Set<string>(all ? [...entities.keys(), ...rows.keys()] : changed);
    for (const id of ids) {
      const prevRow = rows.get(id) ?? null;
      const prevKeys = rowPages.get(id) ?? [];
      const e = entities.get(id);
      if (!e) {
        rows.delete(id);
        rowPages.delete(id);
        for (const k of prevKeys) dirty.add(k);
        continue;
      }
      const row = makeRow(e, live, pending.has(id), prevRow);
      const keys = pageKeysOf(e, favoriteSet);
      if (row !== prevRow || !sameList(keys, prevKeys)) {
        for (const k of keys) dirty.add(k);
        for (const k of prevKeys) dirty.add(k);
      }
      rows.set(id, row);
      rowPages.set(id, keys);
    }
    if (dirty.size > 0) {
      const lists = new Map<string, Row[]>();
      for (const k of dirty) lists.set(k, []);
      for (const [id, keys] of rowPages) {
        for (const k of keys) lists.get(k)?.push(rows.get(id)!);
      }
      for (const [k, list] of lists) {
        if (list.length === 0) pageRowsByKey.delete(k);
        else pageRowsByKey.set(k, sortRows(list, k === FAVORITES ? favorites : undefined));
      }
    }
    // The order: Favorites, the areas of the registry, areas that the registry does not know, Other.
    const order = [FAVORITES, ...reg.areas.map((a) => a.id)];
    for (const k of pageRowsByKey.keys()) if (k !== OTHER && !order.includes(k)) order.push(k);
    order.push(OTHER);
    const prevPages = new Map(state.pages.map((p) => [p.key, p]));
    const pages: Page[] = [];
    for (const k of order) {
      const list = pageRowsByKey.get(k);
      if (!list) continue;
      const name = pageName(k, reg.areas);
      const prev = prevPages.get(k);
      pages.push(prev && prev.rows === list && prev.name === name ? prev : { key: k, name, rows: list });
    }
    const samePageRows = pages.length === state.pageRows.length && pages.every((p, i) => p.key === state.pageRows[i].key && p.name === state.pageRows[i].name);
    const pageRows = samePageRows ? state.pageRows : pages.map((p) => ({ key: p.key, name: p.name }));
    let selectedPage = extra.selectedPage ?? state.selectedPage;
    if (selectedPage === null || !pages.some((p) => p.key === selectedPage)) selectedPage = pages.length ? pages[0].key : null;
    let selectedEntity = state.selectedEntity;
    if (selectedEntity !== null && !entities.has(selectedEntity)) selectedEntity = null;
    set({ ...extra, entities, pages, pageRows, selectedPage, selectedEntity, pending, favorites });
  }

  // ---- pending service calls ----

  function clearPending(pending: Set<string>, id: string): boolean {
    const timer = pendingTimers.get(id);
    if (timer !== undefined) {
      deps.clearTimeout(timer);
      pendingTimers.delete(id);
    }
    return pending.delete(id);
  }

  function callService(id: string, sc: ServiceCall | null) {
    const c = connection;
    if (!sc || !c || !live) return;
    const pending = new Set(state.pending);
    clearPending(pending, id);
    pending.add(id);
    pendingTimers.set(
      id,
      deps.setTimeout(() => {
        pendingTimers.delete(id);
        const p = new Set(state.pending);
        if (!p.delete(id)) return;
        deps.banner('Home Assistant did not answer');
        rebuild(state.entities, [id], false, {}, p);
      }, PENDING_MS),
    );
    rebuild(state.entities, [id], false, {}, pending);
    c.call({ type: 'call_service', domain: sc.domain, service: sc.service, service_data: sc.service_data, target: sc.target }).catch((e: unknown) => {
      const p = new Set(state.pending);
      if (!clearPending(p, id)) return;
      deps.banner(e instanceof HaError && e.code !== 'disconnected' ? e.message : 'Home Assistant did not answer');
      rebuild(state.entities, [id], false, {}, p);
    });
  }

  // ---- the snapshot ----

  function writeSnapshot() {
    if (!snapshotDirty) return;
    snapshotDirty = false;
    const entities: Entity[] = [];
    for (const e of state.entities.values()) {
      const attrs: Record<string, unknown> = {};
      for (const k of SNAPSHOT_ATTRS) if (k in e.attrs) attrs[k] = e.attrs[k];
      entities.push({ ...e, attrs });
    }
    const snapshot: Snapshot = { areas: reg.areas, entities, haVersion: state.haVersion };
    try {
      deps.storage.setItem(KEYS.snapshot, JSON.stringify(snapshot));
    } catch (e) {
      console.error('HA Remote: cannot save the snapshot:', messageOf(e));
    }
  }

  function scheduleSnapshot() {
    snapshotDirty = true;
    if (snapshotTimer !== null) return;
    snapshotTimer = deps.setTimeout(() => {
      snapshotTimer = null;
      writeSnapshot();
    }, SNAPSHOT_EVERY_MS);
  }

  // ---- the connection ----

  function onStates(event: unknown) {
    if (!isObject(event)) return;
    const base = firstEvent && isObject(event.a) ? new Map<string, Entity>() : state.entities;
    const all = firstEvent && isObject(event.a);
    firstEvent = false;
    const { entities, changed } = applyStates(base, event as StatesEvent, reg);
    const pending = new Set(state.pending);
    for (const id of changed) clearPending(pending, id);
    rebuild(entities, changed, all, { lastUpdate: deps.now() }, pending);
    scheduleSnapshot();
  }

  async function loadRegistries(c: Connection) {
    try {
      const [areas, devices, display] = await Promise.all([
        c.call({ type: 'config/area_registry/list' }),
        c.call({ type: 'config/device_registry/list' }),
        c.call({ type: 'config/entity_registry/list_for_display' }),
      ]);
      if (connection !== c) return;
      const d = parseDisplay(display);
      reg = { areas: parseAreas(areas), deviceArea: parseDevices(devices), display: d.display, hidden: d.hidden };
      firstEvent = true;
      // The subscription goes after the registries, so the first event is placed right away.
      await c.subscribe({ type: 'subscribe_entities' }, onStates);
      if (connection !== c) return;
      live = true;
      rebuild(placeAgain(state.entities, reg), [], true, { lastUpdate: deps.now() });
    } catch (e) {
      // The socket closed: the next connect loads the registries again.
      console.error('HA Remote: cannot load the registries:', messageOf(e));
    }
  }

  function onConnectionEvent(ev: ConnectionEvent) {
    switch (ev.type) {
      case 'connecting':
        set({ status: 'connecting' });
        return;
      case 'connected':
        set({ status: 'connected', haVersion: ev.haVersion });
        if (connection) void loadRegistries(connection);
        return;
      case 'disconnected':
        live = false;
        rebuild(state.entities, [], true, { status: 'offline' }); // the toggles go away
        return;
      case 'auth-invalid':
        // There is no refresh: the user makes a new token (HA spec section 4).
        leave(TOKEN_REJECTED);
        return;
    }
  }

  function connect() {
    disconnect();
    if (token === null) return;
    const c = createConnection({ WebSocket: deps.WebSocket, setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout }, { url: socketUrl(server), token, onEvent: onConnectionEvent });
    connection = c;
    c.start();
  }

  function disconnect() {
    const c = connection;
    connection = null;
    live = false;
    if (c) c.stop();
  }

  // ---- sign-in and sign-out ----

  function signedIn(t: string) {
    token = t;
    saveCredentials(deps.storage, server, t);
    set({ screen: 'main', signin: { server, error: null, busy: false } });
    connect();
  }

  /** Back to the sign-in screen. The token goes from the storage; the server URL and the favorites stay. */
  function leave(error: string | null) {
    if (pauseTimer !== null) {
      deps.clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    paused = false;
    disconnect();
    token = null;
    clearToken(deps.storage);
    deps.storage.removeItem(KEYS.snapshot);
    snapshotDirty = false;
    reg = emptyRegistries();
    rebuild(new Map(), [], true, { screen: 'signin', status: 'offline', haVersion: null, lastUpdate: null, signin: { server, error, busy: false } });
  }

  // ---- the store ----

  const store: Store = {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getState: () => state,

    start() {
      const saved = readCredentials(deps.storage);
      server = saved.server;
      token = saved.token;
      const favorites = readFavorites(deps.storage);
      const snapshot = token ? readSnapshot(deps.storage) : null;
      const screen: Screen = token ? 'main' : 'signin';
      const signin = { ...state.signin, server };
      if (snapshot) {
        reg = { ...emptyRegistries(), areas: snapshot.areas };
        rebuild(new Map(snapshot.entities.map((e) => [e.id, e])), [], true, { screen, signin, favorites, haVersion: snapshot.haVersion });
      } else {
        set({ screen, signin, favorites });
      }
      if (token) connect();
    },

    async signIn(serverInput, tokenInput) {
      let s: string;
      let t: string;
      try {
        s = normalizeServer(serverInput);
        t = normalizeToken(tokenInput);
      } catch (e) {
        set({ signin: { ...state.signin, error: messageOf(e) } });
        return;
      }
      server = s;
      set({ signin: { server, busy: true, error: null } });
      try {
        await checkToken(authDeps, server, t);
      } catch (e) {
        set({ signin: { server, busy: false, error: messageOf(e) } });
        return;
      }
      signedIn(t);
    },

    signOut: () => leave(null),

    reconnect() {
      paused = false;
      if (connection) connection.start();
      else if (token) connect();
    },

    selectPage(key) {
      set({ selectedPage: key });
    },

    selectEntity(id) {
      set({ selectedEntity: id });
    },

    toggle(id) {
      const e = state.entities.get(id);
      if (e) callService(id, toggleCall(e));
    },
    setBrightness(id, pct) {
      const e = state.entities.get(id);
      if (e) callService(id, brightnessCall(e, pct));
    },
    stepTemperature(id, direction) {
      const e = state.entities.get(id);
      if (e) callService(id, temperatureCall(e, direction));
    },
    setMode(id, mode) {
      const e = state.entities.get(id);
      if (e) callService(id, modeCall(e, mode));
    },
    cover(id, action) {
      const e = state.entities.get(id);
      if (e) callService(id, coverCall(e, action));
    },
    setPosition(id, position) {
      const e = state.entities.get(id);
      if (e) callService(id, positionCall(e, position));
    },

    setFavorite(id, on) {
      const has = state.favorites.includes(id);
      if (on === has) return;
      const favorites = on ? [...state.favorites, id] : state.favorites.filter((f) => f !== id);
      deps.storage.setItem(KEYS.favorites, JSON.stringify(favorites));
      rebuild(state.entities, [id], false, { favorites });
    },

    setTopmost(topmost) {
      if (topmost) {
        if (pauseTimer !== null) {
          deps.clearTimeout(pauseTimer);
          pauseTimer = null;
        }
        if (paused) {
          paused = false;
          if (connection) connection.start();
        }
        return;
      }
      if (pauseTimer !== null || !connection) return;
      pauseTimer = deps.setTimeout(() => {
        pauseTimer = null;
        paused = true;
        if (connection) connection.stop();
        writeSnapshot();
      }, PAUSE_AFTER_MS);
    },

    showAbout() {
      set({ screen: 'about' });
    },
    showMain() {
      set({ screen: 'main' });
    },
    flush: writeSnapshot,
  };
  return store;
}
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run examples/ha-remote
npm run typecheck
```

Expected: every test in `actions.test.ts`, `store.test.ts`, `connection.test.ts`, `auth.test.ts` and `model.test.ts` passes; `tsc` prints nothing. If "one notification per message" fails with `n + 2`, a `set()` runs inside `rebuild`'s caller: make the caller pass its patch through `extra`, so `rebuild` is the only `set`.

- [ ] **Step 7: Commit**

```bash
git add maemo-react/examples/ha-remote/src/ha/actions.ts maemo-react/examples/ha-remote/src/ha/store.ts maemo-react/examples/ha-remote/test
git commit -m "Add the HA Remote store and the service call actions"
```

---

### Task 7: The fake Home Assistant server

**Files:**
- Create: `maemo-react/runtime/test/server/ha.py`
- Modify: `maemo-react/runtime/test/run.sh` (start it)
- Create: `maemo-react/runtime/test/ha-fake.test.js`

**Interfaces:**
- Consumes: `wsproto.py` (M3a Task 2); `fetch`, `WebSocket` (M3a) in the test.
- Produces: `ha.py <port> [--entities N] [--bind ADDR] [--token TOKEN] [cert.pem key.pem]`. It serves `GET /api/` (200 with the configured token as `Authorization: Bearer`, else 401) and `GET /api/websocket` (auth with the configured token, `ping`, the three registries, `subscribe_entities` with the compressed change format, `call_service` that changes a state, `unsubscribe_events`, and the test commands `fake/set` and `fake/drop`). The token is `test-token` when `--token` is not given; it is a test value, not a secret. Six entities in two areas, plus `--entities N` generated lights. `run.sh` starts it on port 8123 without TLS. Tasks 8 and 9 use it.

- [ ] **Step 1: Write the server**

Create `maemo-react/runtime/test/server/ha.py`:

```python
#!/usr/bin/env python3
"""A fake Home Assistant for the HA Remote tests: GET /api/ and the
WebSocket auth with one long-lived access token, the registries,
subscribe_entities with the compressed change format, and a call_service
that changes a state.

    ha.py <port> [--entities N] [--bind ADDR] [--token TOKEN] [cert.pem key.pem]

The token is test-token when --token is not given. Other tokens get 401 on
GET /api/ and auth_invalid on the socket.
Test commands over the socket: {"id": n, "type": "fake/set", "entity_id": ...,
"state": ..., "attributes": {...}} changes a state; {"type": "fake/drop"}
closes the TCP connection without a close frame.
"""
import json
import ssl
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from wsproto import Closed, upgrade

HA_VERSION = '2025.1.0'


def state(s, **attrs):
    t = time.time()
    return {'s': s, 'a': attrs, 'c': uuid.uuid4().hex, 'lc': t, 'lu': t}


class World:
    """The state that all connections share."""

    def __init__(self, extra, token):
        self.lock = threading.Lock()
        self.token = token   # the one long-lived access token that the server accepts
        self.subscribers = []  # (ws, subscription id)
        self.areas = [
            {'area_id': 'living_room', 'name': 'Living room', 'picture': None},
            {'area_id': 'kitchen', 'name': 'Kitchen', 'picture': None},
        ]
        self.devices = [{'id': 'dev1', 'area_id': 'kitchen', 'name': 'Fan controller'}]
        self.display = [
            {'ei': 'light.ceiling', 'ai': 'living_room', 'pl': 'hue'},
            {'ei': 'light.desk', 'ai': 'living_room', 'pl': 'hue'},
            {'ei': 'switch.fan', 'di': 'dev1', 'pl': 'mqtt'},
            {'ei': 'climate.thermostat', 'ai': 'living_room', 'pl': 'mqtt'},
            {'ei': 'cover.blinds', 'ai': 'living_room', 'pl': 'mqtt'},
            {'ei': 'light.hidden', 'ai': 'kitchen', 'hb': True, 'pl': 'hue'},
            {'ei': 'sensor.temp', 'ai': 'kitchen', 'pl': 'mqtt'},
        ]
        self.states = {
            'light.ceiling': state('on', friendly_name='Ceiling light', brightness=128, supported_color_modes=['brightness'], color_mode='brightness'),
            'light.desk': state('off', friendly_name='Desk lamp', supported_color_modes=['onoff']),
            'switch.fan': state('off', friendly_name='Fan'),
            'climate.thermostat': state('heat', friendly_name='Thermostat', temperature=21.0, current_temperature=19.5,
                                        hvac_modes=['off', 'heat', 'cool'], target_temp_step=0.5, min_temp=7, max_temp=35),
            'cover.blinds': state('open', friendly_name='Blinds', current_position=100, supported_features=15),
            'input_boolean.guest': state('off', friendly_name='Guest mode'),
            'light.hidden': state('off', friendly_name='Hidden light'),
            'sensor.temp': state('19.5', friendly_name='Temperature', unit_of_measurement='°C'),
        }
        for i in range(extra):
            eid = 'light.gen_%d' % i
            self.display.append({'ei': eid, 'ai': 'living_room' if i % 2 == 0 else 'kitchen', 'pl': 'hue'})
            self.states[eid] = state('off', friendly_name='Light %d' % i, supported_color_modes=['brightness'])

    # ---- auth ----

    def token_valid(self, access):
        return access == self.token

    # ---- states ----

    def all_states(self):
        with self.lock:
            return {eid: dict(st) for eid, st in self.states.items()}

    def set_state(self, eid, new_state, attrs):
        """Change a state and push the compressed change. False when nothing changed."""
        with self.lock:
            st = self.states.get(eid)
            if st is None:
                return False
            changed = {k: v for k, v in attrs.items() if st['a'].get(k) != v}
            if new_state == st['s'] and not changed:
                return False
            st['s'] = new_state
            st['a'].update(changed)
            t = time.time()
            st['lc'] = st['lu'] = t
            st['c'] = uuid.uuid4().hex
            plus = {'s': new_state, 'c': st['c'], 'lc': t, 'lu': t}
            if changed:
                plus['a'] = changed
            subscribers = list(self.subscribers)
        for ws, sid in subscribers:
            try:
                ws.send_text(json.dumps({'id': sid, 'type': 'event', 'event': {'c': {eid: {'+': plus}}}}))
            except OSError:
                self.remove_subscriber(ws)
        return True

    def add_subscriber(self, ws, sid):
        with self.lock:
            self.subscribers.append((ws, sid))

    def remove_subscriber(self, ws):
        with self.lock:
            self.subscribers = [(w, s) for w, s in self.subscribers if w is not ws]

    def call_service(self, domain, service, data, target):
        """None when the call is applied, else (code, message)."""
        eids = target.get('entity_id') if isinstance(target, dict) else None
        if isinstance(eids, str):
            eids = [eids]
        if not eids:
            return 'invalid_format', 'target.entity_id is missing'
        for eid in eids:
            with self.lock:
                st = self.states.get(eid)
                s, a = (st['s'], dict(st['a'])) if st else (None, {})
            if st is None or not eid.startswith(domain + '.'):
                return 'not_found', 'Entity %s not found' % eid
            if service == 'toggle':
                self.set_state(eid, 'off' if s == 'on' else 'on', {})
            elif service == 'turn_on':
                pct = data.get('brightness_pct')
                if pct == 0:
                    self.set_state(eid, 'off', {})
                else:
                    self.set_state(eid, 'on', {'brightness': round(pct * 255 / 100)} if isinstance(pct, (int, float)) else {})
            elif service == 'turn_off':
                self.set_state(eid, 'off', {})
            elif domain == 'climate' and service == 'set_temperature':
                self.set_state(eid, s, {'temperature': data.get('temperature')})
            elif domain == 'climate' and service == 'set_hvac_mode':
                mode = data.get('hvac_mode')
                if mode not in a.get('hvac_modes', []):
                    return 'invalid_format', 'value must be one of %s' % a.get('hvac_modes')
                self.set_state(eid, mode, {})
            elif domain == 'cover' and service == 'open_cover':
                self.set_state(eid, 'open', {'current_position': 100})
            elif domain == 'cover' and service == 'close_cover':
                self.set_state(eid, 'closed', {'current_position': 0})
            elif domain == 'cover' and service == 'stop_cover':
                pass
            elif domain == 'cover' and service == 'set_cover_position':
                p = int(data.get('position', 0))
                self.set_state(eid, 'closed' if p == 0 else 'open', {'current_position': p})
            else:
                return 'not_found', 'Service %s.%s not found' % (domain, service)
        return None


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def reply(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/websocket':
            self.websocket()
            return
        if path == '/api/':
            auth = self.headers.get('Authorization') or ''
            if auth == 'Bearer ' + self.server.world.token:
                self.reply(200, {'message': 'API running.'})
            else:
                self.reply(401, {'message': '401: Unauthorized'})
            return
        self.reply(200 if self.path == '/' else 404, {'message': 'fake home assistant'})

    def websocket(self):
        ws = upgrade(self)
        if ws is None:
            return
        world = self.server.world
        send = lambda obj: ws.send_text(json.dumps(obj))
        try:
            send({'type': 'auth_required', 'ha_version': HA_VERSION})
            kind, data = ws.recv_message()
            m = json.loads(data)
            if m.get('type') != 'auth' or not world.token_valid(m.get('access_token')):
                send({'type': 'auth_invalid', 'message': 'Invalid access token or password'})
                ws.send_close(1000)
                return
            send({'type': 'auth_ok', 'ha_version': HA_VERSION})
            while True:
                kind, data = ws.recv_message()
                m = json.loads(data)
                mid, t = m.get('id'), m.get('type')
                result = lambda r: send({'id': mid, 'type': 'result', 'success': True, 'result': r})
                error = lambda code, message: send({'id': mid, 'type': 'result', 'success': False, 'error': {'code': code, 'message': message}})
                if t == 'ping':
                    send({'id': mid, 'type': 'pong'})
                elif t == 'config/area_registry/list':
                    result(world.areas)
                elif t == 'config/device_registry/list':
                    result(world.devices)
                elif t == 'config/entity_registry/list_for_display':
                    result({'entity_categories': {'0': 'config', '1': 'diagnostic'}, 'entities': world.display})
                elif t == 'subscribe_entities':
                    world.add_subscriber(ws, mid)
                    result(None)
                    send({'id': mid, 'type': 'event', 'event': {'a': world.all_states()}})
                elif t == 'unsubscribe_events':
                    result(None)
                elif t == 'call_service':
                    err = world.call_service(str(m.get('domain')), str(m.get('service')), m.get('service_data') or {}, m.get('target') or {})
                    if err is None:
                        result({'context': {'id': uuid.uuid4().hex, 'parent_id': None, 'user_id': None}})
                    else:
                        error(*err)
                elif t == 'fake/set':
                    world.set_state(str(m.get('entity_id')), str(m.get('state')), m.get('attributes') or {})
                    result(None)
                elif t == 'fake/drop':
                    self.connection.close()
                    return
                else:
                    error('unknown_command', 'Unknown command.')
        except (Closed, OSError, ValueError):
            pass
        finally:
            world.remove_subscriber(ws)


def main():
    args = sys.argv[1:]
    port = int(args.pop(0))
    extra, bind, token = 0, '127.0.0.1', 'test-token'
    while args and args[0].startswith('--'):
        flag = args.pop(0)
        if flag == '--entities':
            extra = int(args.pop(0))
        elif flag == '--bind':
            bind = args.pop(0)
        elif flag == '--token':
            token = args.pop(0)
    server = ThreadingHTTPServer((bind, port), Handler)
    server.daemon_threads = True
    server.world = World(extra, token)
    if len(args) >= 2:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(args[0], args[1])
        server.socket = tls.wrap_socket(server.socket, server_side=True)
    print('fake home assistant on %s:%d with %d entities' % (bind, port, len(server.world.states)), flush=True)
    server.serve_forever()


main()
```

In `maemo-react/runtime/test/run.sh`, add after the lines that start `wsserver.py`:

```bash
# The fake Home Assistant for the HA Remote checks, without TLS, on 8123.
pgrep -f 'server/ha.py 8123' >/dev/null || { PYTHONPATH=test/server python3 test/server/ha.py 8123 >/tmp/mr-test-ha.log 2>&1 & sleep 1; }
```

- [ ] **Step 2: Check the HTTP part with curl**

```bash
devhost/run.sh 'cd runtime && (PYTHONPATH=test/server python3 test/server/ha.py 8123 >/tmp/ha.log 2>&1 &); sleep 1; curl -s -H "Authorization: Bearer test-token" localhost:8123/api/; echo; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer nope" localhost:8123/api/; curl -s -o /dev/null -w "%{http_code}\n" localhost:8123/api/; pkill -f "ha.py 8123"'
```

Expected: `{"message": "API running."}`, then `401`, then `401`.

- [ ] **Step 3: Write the runtime test of the whole stack against the fake**

Create `maemo-react/runtime/test/ha-fake.test.js`:

```js
// The fake Home Assistant through the real fetch and WebSocket globals: the
// token check, the socket auth, the registries, subscribe_entities, and a
// call_service that pushes a change.
import { test, assert, assertEqual, run } from './harness.js';

const HA = 'http://localhost:8123';
const TOKEN = 'test-token';

test('GET /api/ accepts the token and refuses the others', async () => {
  const ok = await fetch(HA + '/api/', { headers: { Authorization: 'Bearer ' + TOKEN } });
  assertEqual([ok.status, (await ok.json()).message], [200, 'API running.']);
  const bad = await fetch(HA + '/api/', { headers: { Authorization: 'Bearer nope' } });
  assertEqual(bad.status, 401);
  await bad.text();
  const none = await fetch(HA + '/api/');
  assertEqual(none.status, 401);
  await none.text();
});

test('the socket: auth, registries, subscribe_entities, and a call_service that pushes a change', async () => {
  const s = new WebSocket(HA + '/api/websocket');
  const inbox = [];
  const waiters = [];
  s.onmessage = (e) => {
    inbox.push(JSON.parse(e.data));
    waiters.splice(0).forEach((w) => w());
  };
  const next = (pred) =>
    new Promise((resolve) => {
      const check = () => {
        const i = inbox.findIndex(pred);
        if (i >= 0) resolve(inbox.splice(i, 1)[0]);
        else waiters.push(check);
      };
      check();
    });
  const send = (obj) => s.send(JSON.stringify(obj));
  await next((m) => m.type === 'auth_required');
  send({ type: 'auth', access_token: TOKEN });
  const ok = await next((m) => m.type === 'auth_ok');
  assertEqual(ok.ha_version, '2025.1.0');
  send({ id: 1, type: 'config/area_registry/list' });
  send({ id: 2, type: 'config/entity_registry/list_for_display' });
  send({ id: 3, type: 'subscribe_entities' });
  const areas = await next((m) => m.id === 1);
  assertEqual(areas.result.map((a) => a.area_id), ['living_room', 'kitchen']);
  const display = await next((m) => m.id === 2);
  assert(display.result.entities.some((e) => e.ei === 'light.hidden' && e.hb === true), 'a hidden entity');
  await next((m) => m.id === 3 && m.type === 'result');
  const first = await next((m) => m.id === 3 && m.type === 'event');
  assertEqual(first.event.a['light.ceiling'].s, 'on');
  send({ id: 4, type: 'call_service', domain: 'light', service: 'toggle', target: { entity_id: 'light.ceiling' } });
  const change = await next((m) => m.id === 3 && m.type === 'event');
  assertEqual(change.event.c['light.ceiling']['+'].s, 'off');
  const done = await next((m) => m.id === 4);
  assertEqual(done.success, true);
  send({ id: 5, type: 'call_service', domain: 'climate', service: 'set_hvac_mode', service_data: { hvac_mode: 'dry' }, target: { entity_id: 'climate.thermostat' } });
  const err = await next((m) => m.id === 5);
  assertEqual([err.success, err.error.code], [false, 'invalid_format']);
  send({ id: 6, type: 'ping' });
  assertEqual((await next((m) => m.id === 6)).type, 'pong');
  send({ id: 7, type: 'call_service', domain: 'light', service: 'toggle', target: { entity_id: 'light.ceiling' } }); // back to on
  await next((m) => m.id === 7);
  s.close();
  await new Promise((resolve) => (s.onclose = resolve));
});

test('a wrong token gets auth_invalid and a clean close', async () => {
  const s = new WebSocket(HA + '/api/websocket');
  const types = [];
  s.onmessage = (e) => {
    const m = JSON.parse(e.data);
    types.push(m.type);
    if (m.type === 'auth_required') s.send(JSON.stringify({ type: 'auth', access_token: 'nope' }));
  };
  const ev = await new Promise((resolve) => (s.onclose = resolve));
  assertEqual(types, ['auth_required', 'auth_invalid']);
  assertEqual([ev.code, ev.wasClean], [1000, true]);
});

await run();
```

Run on both targets:

```bash
devhost/run.sh 'runtime/test/run.sh desktop test/ha-fake.test.js && runtime/test/run.sh diablo test/ha-fake.test.js' > /tmp/m3b-t7.log 2>&1; grep -n 'PASS\|FAIL\|not ok' /tmp/m3b-t7.log
```

Expected: `PASS test/ha-fake.test.js` on both targets. The tests share one server, so the second toggle puts the light back on for the next run.

- [ ] **Step 4: Commit**

```bash
git add maemo-react/runtime/test/server/ha.py maemo-react/runtime/test/run.sh maemo-react/runtime/test/ha-fake.test.js
git commit -m "Add a fake Home Assistant server for the HA Remote checks"
```

---

### Task 8: The UI, the desktop run, the package, and the emulator check

**Files:**
- Create: `maemo-react/examples/ha-remote/src/ui/{App,SignIn,Main,Detail,About}.tsx`, `maemo-react/examples/ha-remote/src/main.tsx`
- Create: `maemo-react/docs/ha-remote-emulator.png`
- Modify: `maemo-react/README.md`

**Interfaces:**
- Consumes: `Store`, `State` (Task 6); `Window` with `onTopmostChange` (Task 2); `List`, `Scale`, `ComboBox`, `ToggleButton`, `Entry`, `Menu`, `banner` (M2a); `maemo:app` (`args`, `quit`, `version`); `maemo:storage` (`flush`); the fake server (Task 7).
- Produces: the application. Arguments: `--server <url> --token <token>` sign in at start when there is no token (for the checks with the token `test-token` of the fake server; on the tablet the user pastes or types the real token in the sign-in screen, never on the command line); `--smoke` toggles the first light after the connect, prints `HA-SMOKE ok <id> <old> -> <new> in <ms> ms, <n> entities` and quits after 2 s (`--stay` keeps the window); `--timing` prints `HA-TIMING snapshot <ms>` at the first paint with pages and `HA-TIMING live <ms>` at the first live state. `examples/ha-remote/dist/ha-remote_0.1.0_all.deb`.

- [ ] **Step 1: Write the UI**

Create `maemo-react/examples/ha-remote/src/ui/App.tsx`:

```tsx
import { useSyncExternalStore } from 'react';
import { Menu, MenuItem, MenuSeparator, Window } from '@maemo-react/widgets';
import type { Store } from '../ha/store.js';
import { About } from './About.js';
import { Main } from './Main.js';
import { SignIn } from './SignIn.js';

export function App({ store, onQuit }: { store: Store; onQuit: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return (
    <Window title="HA Remote" onTopmostChange={(top) => store.setTopmost(top)}>
      <Menu>
        <MenuItem onActivate={() => store.reconnect()}>Reconnect</MenuItem>
        <MenuItem onActivate={() => store.signOut()}>Sign out</MenuItem>
        <MenuItem onActivate={() => store.showAbout()}>About</MenuItem>
        <MenuSeparator />
        <MenuItem onActivate={onQuit}>Quit</MenuItem>
      </Menu>
      {state.screen === 'signin' ? <SignIn store={store} signin={state.signin} /> : state.screen === 'about' ? <About store={store} state={state} /> : <Main store={store} state={state} />}
    </Window>
  );
}
```

Create `maemo-react/examples/ha-remote/src/ui/SignIn.tsx`:

```tsx
import { useState } from 'react';
import { Box, Button, Entry, Label, ToggleButton } from '@maemo-react/widgets';
import type { SignInState, Store } from '../ha/store.js';

const DEFAULT_SERVER = 'http://homeassistant.local:8123';

export function SignIn({ store, signin }: { store: Store; signin: SignInState }) {
  const [server, setServer] = useState(signin.server || DEFAULT_SERVER);
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  // No scheme means http: the warning applies (HA spec section 2).
  const plain = !/^https:\/\//i.test(server.trim());
  return (
    <Box vertical spacing={6}>
      <Label xalign={0}>Server URL</Label>
      <Entry value={server} onChangeText={setServer} sensitive={!signin.busy} />
      <Label xalign={0}>Long-lived access token</Label>
      <Box spacing={4}>
        {/* GtkEntry takes a paste from the clipboard; the user can copy the token in the browser of the tablet. */}
        <Entry value={token} onChangeText={setToken} visibility={show} sensitive={!signin.busy} expand />
        <ToggleButton active={show} onToggle={(on) => setShow(on)}>
          Show
        </ToggleButton>
      </Box>
      <Label wrap xalign={0}>
        Make the token in your Home Assistant profile: the "Security" tab, "Long-lived access tokens".
      </Label>
      <Button onClick={() => void store.signIn(server, token)} sensitive={!signin.busy}>
        {signin.busy ? 'Signing in...' : 'Sign in'}
      </Button>
      {plain ? <Label wrap xalign={0}>The token goes over the network without encryption</Label> : null}
      {signin.error ? <Label wrap xalign={0}>{signin.error}</Label> : null}
    </Box>
  );
}
```

Create `maemo-react/examples/ha-remote/src/ui/Main.tsx`:

```tsx
import { memo } from 'react';
import { Box, Label, List, type ListColumn } from '@maemo-react/widgets';
import type { State, Store } from '../ha/store.js';
import type { PageRow, Row } from '../ha/types.js';
import { Detail } from './Detail.js';

const PAGE_COLUMNS: ListColumn[] = [{ field: 'name', expand: true }];
const ENTITY_COLUMNS: ListColumn[] = [{ field: 'name', expand: true }, { field: 'state' }, { field: 'on', kind: 'toggle' }];
const NO_ROWS: Row[] = [];

// memo: a state change renders the lists again only when their rows changed.
const PageList = memo(function PageList({ rows, selected, store }: { rows: readonly PageRow[]; selected: string | null; store: Store }) {
  return <List data={rows} columns={PAGE_COLUMNS} selected={selected} onSelect={(key) => store.selectPage(key)} widthRequest={150} />;
});

const EntityList = memo(function EntityList({ rows, selected, store }: { rows: readonly Row[]; selected: string | null; store: Store }) {
  return <List data={rows} columns={ENTITY_COLUMNS} selected={selected} expand onSelect={(key) => store.selectEntity(key)} onToggle={(key) => store.toggle(key)} />;
});

function clock(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => (n < 10 ? '0' : '') + n;
  return two(d.getHours()) + ':' + two(d.getMinutes());
}

export function statusText(state: State): string {
  const when = state.lastUpdate === null ? '' : ' - ' + clock(state.lastUpdate);
  if (state.status === 'connected') return 'Connected' + when;
  if (state.status === 'connecting') return 'Connecting...' + when;
  return 'Offline - showing the last known state' + when;
}

export function Main({ store, state }: { store: Store; state: State }) {
  const page = state.pages.find((p) => p.key === state.selectedPage) ?? null;
  const entity = state.selectedEntity === null ? null : (state.entities.get(state.selectedEntity) ?? null);
  return (
    <Box vertical spacing={4}>
      <Box spacing={6} expand>
        <PageList rows={state.pageRows} selected={state.selectedPage} store={store} />
        <EntityList rows={page ? page.rows : NO_ROWS} selected={state.selectedEntity} store={store} />
        <Detail entity={entity} live={state.status === 'connected'} favorite={entity !== null && state.favorites.includes(entity.id)} store={store} />
      </Box>
      <Label xalign={0}>{statusText(state)}</Label>
    </Box>
  );
}
```

Create `maemo-react/examples/ha-remote/src/ui/Detail.tsx`:

```tsx
import { memo } from 'react';
import { Box, Button, ComboBox, Label, Scale, ToggleButton } from '@maemo-react/widgets';
import { brightnessPct, coverFeatures, hasBrightness, hvacModes } from '../ha/actions.js';
import { stateText } from '../ha/model.js';
import type { Store } from '../ha/store.js';
import type { Entity } from '../ha/types.js';

const WIDTH = 230;

interface Controls {
  entity: Entity;
  live: boolean;
  store: Store;
}

function LightControls({ entity, live, store }: Controls) {
  const pct = brightnessPct(entity);
  return (
    <Box vertical spacing={2}>
      <Label xalign={0}>{'Brightness ' + pct + ' %'}</Label>
      <Scale min={0} max={100} value={pct} sensitive={live} onChangeValue={(v) => store.setBrightness(entity.id, v)} />
    </Box>
  );
}

function ClimateControls({ entity, live, store }: Controls) {
  const modes = hvacModes(entity);
  const current = entity.attrs.current_temperature;
  const target = entity.attrs.temperature;
  const hasTarget = typeof target === 'number';
  return (
    <Box vertical spacing={4}>
      <Label xalign={0}>{'Current ' + (typeof current === 'number' ? current.toFixed(1) + ' °C' : '-')}</Label>
      <Box spacing={4}>
        <Button sensitive={live && hasTarget} onClick={() => store.stepTemperature(entity.id, -1)}>
          -
        </Button>
        <Label expand>{hasTarget ? target.toFixed(1) + ' °C' : '-'}</Label>
        <Button sensitive={live && hasTarget} onClick={() => store.stepTemperature(entity.id, 1)}>
          +
        </Button>
      </Box>
      <ComboBox
        items={modes}
        active={modes.indexOf(entity.state)}
        sensitive={live && modes.length > 0}
        onChangeActive={(_i, item) => {
          if (item !== undefined && item !== entity.state) store.setMode(entity.id, item);
        }}
      />
    </Box>
  );
}

function CoverControls({ entity, live, store }: Controls) {
  const f = coverFeatures(entity);
  const position = entity.attrs.current_position;
  return (
    <Box vertical spacing={4}>
      <Box spacing={4}>
        {f.open ? <Button sensitive={live} onClick={() => store.cover(entity.id, 'open')}>Open</Button> : null}
        {f.stop ? <Button sensitive={live} onClick={() => store.cover(entity.id, 'stop')}>Stop</Button> : null}
        {f.close ? <Button sensitive={live} onClick={() => store.cover(entity.id, 'close')}>Close</Button> : null}
      </Box>
      {f.position ? <Scale min={0} max={100} value={typeof position === 'number' ? position : 0} sensitive={live} onChangeValue={(v) => store.setPosition(entity.id, v)} /> : null}
    </Box>
  );
}

// memo: the panel renders again only when the entity object, live or favorite changed.
export const Detail = memo(function Detail({ entity, live, favorite, store }: { entity: Entity | null; live: boolean; favorite: boolean; store: Store }) {
  if (entity === null) {
    return (
      <Box vertical widthRequest={WIDTH}>
        <Label>Select an entity</Label>
      </Box>
    );
  }
  return (
    <Box vertical spacing={6} widthRequest={WIDTH}>
      <Label wrap xalign={0}>{entity.name}</Label>
      <Label xalign={0}>{stateText(entity.domain, entity.state, entity.attrs)}</Label>
      {entity.domain === 'light' && hasBrightness(entity) ? <LightControls entity={entity} live={live} store={store} /> : null}
      {entity.domain === 'climate' ? <ClimateControls entity={entity} live={live} store={store} /> : null}
      {entity.domain === 'cover' ? <CoverControls entity={entity} live={live} store={store} /> : null}
      <ToggleButton active={favorite} onToggle={(on) => store.setFavorite(entity.id, on)}>
        Favorite
      </ToggleButton>
    </Box>
  );
});
```

Create `maemo-react/examples/ha-remote/src/ui/About.tsx`:

```tsx
import { Box, Button, Label } from '@maemo-react/widgets';
import type { State, Store } from '../ha/store.js';

export function About({ store, state }: { store: Store; state: State }) {
  return (
    <Box vertical spacing={6}>
      <Label xalign={0}>{'HA Remote ' + state.versions.app}</Label>
      <Label xalign={0}>{'maemo-react ' + state.versions.runtime}</Label>
      <Label xalign={0}>{'Home Assistant ' + (state.haVersion ?? '(not connected yet)')}</Label>
      <Label wrap xalign={0}>
        "Sign out" deletes the token from this tablet only. To stop the token, delete it in your Home Assistant profile, on the "Security" tab.
      </Label>
      <Button onClick={() => store.showMain()}>Back</Button>
    </Box>
  );
}
```

Create `maemo-react/examples/ha-remote/src/main.tsx`:

```tsx
import { banner, render } from '@maemo-react/core';
import { args, quit, version } from 'maemo:app';
import { flush } from 'maemo:storage';
import { createStore } from './ha/store.js';
import { App } from './ui/App.js';

/** Keep it equal to the version in app.json. */
const APP_VERSION = '0.1.0';

const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const SMOKE = args.includes('--smoke');
const STAY = args.includes('--stay');
const TIMING = args.includes('--timing') || SMOKE;
const t0 = performance.now();

const store = createStore({
  fetch,
  WebSocket,
  storage: localStorage,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  now: () => Date.now(),
  banner,
  versions: { app: APP_VERSION, runtime: version },
});

function quitApp(code: number) {
  store.flush(); // the snapshot
  flush(); // the localStorage file
  quit(code);
}

if (TIMING) {
  let snapshotSeen = false;
  let liveSeen = false;
  store.subscribe(() => {
    const s = store.getState();
    if (!snapshotSeen && s.screen === 'main' && s.pages.length > 0) {
      snapshotSeen = true;
      console.log('HA-TIMING snapshot ' + Math.round(performance.now() - t0) + ' ms');
    }
    if (!liveSeen && s.status === 'connected' && s.lastUpdate !== null) {
      liveSeen = true;
      console.log('HA-TIMING live ' + Math.round(performance.now() - t0) + ' ms, ' + s.entities.size + ' entities');
    }
  });
}

store.start();
render(<App store={store} onQuit={() => quitApp(0)} />);

// For the checks against the fake server only. On the tablet the user pastes the token in the sign-in screen.
const server = flag('--server');
const token = flag('--token');
if (server !== undefined && token !== undefined && store.getState().screen === 'signin') {
  void store.signIn(server, token);
}

if (SMOKE) {
  // Toggle the first light after the connect; report when its state changes; quit.
  let phase: 'wait' | 'sent' | 'done' = 'wait';
  let target = '';
  let before = '';
  store.subscribe(() => {
    const s = store.getState();
    if (phase === 'wait' && s.status === 'connected' && s.lastUpdate !== null) {
      const light = [...s.entities.values()].find((e) => e.domain === 'light');
      if (!light) return;
      phase = 'sent';
      target = light.id;
      before = light.state;
      setTimeout(() => store.toggle(target), 0); // not inside the notification
    } else if (phase === 'sent') {
      const e = s.entities.get(target);
      if (!e || e.state === before) return;
      phase = 'done';
      console.log('HA-SMOKE ok ' + target + ' ' + before + ' -> ' + e.state + ' in ' + Math.round(performance.now() - t0) + ' ms, ' + s.entities.size + ' entities');
      if (!STAY) setTimeout(() => quitApp(0), 2000);
    }
  });
  setTimeout(() => {
    if (phase === 'done') return;
    const s = store.getState();
    console.log('HA-SMOKE fail: phase ' + phase + ', status ' + s.status + ', screen ' + s.screen + (s.signin.error ? ', ' + s.signin.error : ''));
    quitApp(1);
  }, 60000);
}
```

- [ ] **Step 2: Type-check, build and package**

```bash
npm run build:cli
npm run typecheck
(cd examples/ha-remote && npm run package)
```

Expected: `tsc` prints nothing; `examples/ha-remote/dist/ha-remote_0.1.0_all.deb` exists; `dpkg-deb -I examples/ha-remote/dist/ha-remote_0.1.0_all.deb | grep Depends` (in the container) prints `Depends: maemo-react-runtime (>= 0.3.0)`. If `tsc` rejects a prop (for example `visibility` or `expand` on `Entry`, or `xalign` on `Label`), read `packages/types/generated/intrinsics.d.ts` for the GTK name of the property and use that camel-case name; do not add a prop to the widgets package in this task.

- [ ] **Step 3: Run it on the desktop host against the fake server**

```bash
npm test
devhost/run.sh 'export DISPLAY=:99; (Xvfb :99 -screen 0 800x480x16 >/dev/null 2>&1 &); sleep 1; (cd runtime && PYTHONPATH=test/server python3 test/server/ha.py 8123 >/tmp/ha.log 2>&1 &); sleep 1; export MR_APP_ID=ha-remote MR_DATA_DIR=$(mktemp -d); runtime/build/desktop/bin/maemo-react-host examples/ha-remote/dist/app.js --server http://127.0.0.1:8123 --token test-token --smoke; echo "exit $?"; ls -l $MR_DATA_DIR/ha-remote; pkill -f "ha.py 8123"'
```

Expected: `HA-TIMING snapshot` is absent (no snapshot on the first run), `HA-TIMING live <ms>, 6 entities`, `HA-SMOKE ok light.ceiling on -> off in <ms> ms, 6 entities`, `exit 0`, and `localStorage.json` with mode `-rw-------`. The six entities are the two lights, the switch, the thermostat, the blinds and `input_boolean.guest`; the hidden light and the sensor are not counted. Run the same command a second time with the same `MR_DATA_DIR` (set it by hand) and without `--server`: the server URL, the token and the snapshot are in the file, so `HA-TIMING snapshot` appears before `HA-TIMING live`. Then check the sign-in screen by hand on the desktop host (run without `--smoke`, with a new `MR_DATA_DIR`): paste `test-token` with a space before it and a line break after it, tap "Show" (the text shows) and "Sign in" (the main screen comes); sign out from the menu (the sign-in screen shows the URL, the token field is empty); sign in with `nope` (the screen shows "Home Assistant did not accept the token. Make a new token in your profile.").

- [ ] **Step 4: Run it in the emulator and take the screenshot**

The emulator reaches the host at `10.0.2.2` (QEMU user networking), so the fake server runs in the container, without TLS, and the application gets `http://10.0.2.2:8123`. Build the runtime package of M3a first if `runtime/dist/maemo-react-runtime_0.3.0_armel.deb` is missing (`devhost/run.sh 'runtime/build.sh diablo deb'`).

```bash
devhost/run.sh '(cd runtime && PYTHONPATH=test/server python3 test/server/ha.py 8123 >/tmp/ha.log 2>&1 &); sleep 1; cp examples/ha-remote/dist/ha-remote_0.1.0_all.deb runtime/dist/ && SHOT=docs/ha-remote-emulator.png MR_DEBS="/work/rel-1.2/n810-modern-tls_1.1_armel.deb runtime/dist/maemo-react-runtime_0.3.0_armel.deb runtime/dist/ha-remote_0.1.0_all.deb" devhost/emulator-run.sh runtime/test/emulator "/opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/ha-remote/app.js --server http://10.0.2.2:8123 --token test-token --smoke --stay"; pkill -f "ha.py 8123"' > /tmp/m3b-t8.log 2>&1; grep -n 'Setting up\|HA-\|MR-END\|error' /tmp/m3b-t8.log
```

Expected, after about 5 minutes: three `Setting up ...` lines; `HA-TIMING live`; `HA-SMOKE ok light.ceiling on -> off`; `MR-END rc=0`. Open `docs/ha-remote-emulator.png`: the "HA Remote" window with the pages "Living room", "Kitchen" and "Other" on the left, the entities of the living room in the middle (a check box on the light rows, none on the thermostat and the blinds; the ceiling light shows "Off" after the toggle), "Select an entity" on the right, and "Connected - <time>" at the bottom. Send the screenshot to your human partner. If the window shows the sign-in screen with "The server did not answer", the guest did not reach `10.0.2.2:8123`: check `/tmp/ha.log` for a connection, and run `devhost/emulator-run.sh runtime/test/emulator "curl -s http://10.0.2.2:8123/"` (the stock image has a curl in `/opt/n810-modern/bin` after the TLS package) to see the network path.

- [ ] **Step 5: The README**

In `maemo-react/README.md`, change the last paragraph to:

```
See `examples/hello` (fetch over HTTPS; `docs/hello-emulator.png` shows it in
the emulator), `examples/widgets` (every M2a component; `docs/widgets-emulator.png`
shows it), `examples/ha-remote` (the Home Assistant client of
`docs/specs/2026-10-06-ha-remote-design.md`: sign-in, live state over
`WebSocket`, a snapshot in `localStorage`; `docs/ha-remote-emulator.png` shows it
against the fake server `runtime/test/server/ha.py`) and `examples/bench` (the
frame benchmark). `docs/benchmarks.md` has the results from a real N810, and
`docs/ha-remote-acceptance.md` the acceptance test of HA Remote.
```

and add after the "Web globals" section:

```
A desktop run of an application needs `MR_APP_ID=<id>` in the environment, so
`localStorage` goes to `~/.maemo-react/<id>/`; on the tablet the host takes the
id from the install path.
```

- [ ] **Step 6: Commit**

```bash
git add maemo-react/examples/ha-remote/src maemo-react/docs/ha-remote-emulator.png maemo-react/README.md
git commit -m "Add the HA Remote screens and check them in the emulator"
```

---

### Task 9: The acceptance test on the tablet, on the LAN and through the remote URL

**Files:**
- Modify: `maemo-react/examples/ha-remote/src/main.tsx` (the `--timing` toggle measurement)
- Create: `maemo-react/docs/ha-remote-acceptance.md`

**Interfaces:**
- Consumes: the runtime package 0.3.0 and `ha-remote_0.1.0_all.deb` (Task 8); the tablet (SSH on port 2222, R&D mode for `sudo gainroot`); the user's Home Assistant server; the fake server with `--entities` for the size checks.
- Produces: the acceptance record (HA spec sections 8 and 9), and the "done" of milestone M3 (parent spec section 13).

This task has manual steps. Ask your human partner to do the steps on the tablet and to tell you the result of each one. Never write the server address or the token into the record.

- [ ] **Step 1: Add the toggle measurement to --timing**

In `maemo-react/examples/ha-remote/src/main.tsx`, add inside `if (TIMING) {`, before `store.subscribe(`:

```tsx
  // The JavaScript part of "tap to service call": from the handler to the send.
  const toggle = store.toggle;
  store.toggle = (id) => {
    const t = performance.now();
    toggle(id);
    console.log('HA-TIMING toggle ' + (performance.now() - t).toFixed(1) + ' ms');
  };
```

Run `npm run typecheck` and `(cd examples/ha-remote && npm run package)`. Expected: no output from `tsc`; a new `.deb`.

- [ ] **Step 2: Deploy the runtime and the application**

Ask your human partner to turn the tablet on, with the network up, and to give its address if it is not `<tablet-ip>`.

```bash
cd examples/ha-remote
npx maemo-react deploy ../../runtime/dist/maemo-react-runtime_0.3.0_armel.deb --host <tablet-ip>
npm run deploy -- --host <tablet-ip>
```

Expected: both installs end with `Setting up ...`. "HA Remote" appears in the Extras menu.

- [ ] **Step 3: The acceptance list on the LAN (HA spec section 9)**

Ask your human partner to open HA Remote on the tablet and to do these steps with the LAN URL of their server. Write each result as "ok" or the text that the screen shows.

1. Type the LAN URL, and paste the long-lived access token of Task 1 into the token field (copy it in the browser of the tablet, or type it). Tap "Show" to check the text, then "Sign in". Expected: the main screen with "Favorites" absent, one page for each area that has a control, and "Other" when an entity has no area; "Connected - <time>" at the bottom.
2. Tap the check box of a light. Expected: the row shows "..." and then the new state within a second; the light changes in the home.
3. Select a dimmable light, drag the brightness slider and release it. Expected: the label follows after the release; the light dims.
4. Select the thermostat, tap "+" twice, then pick another mode. Expected: the target rises by two steps; the mode changes; the row shows the new values.
5. Select a cover, tap "Open" (or "Close"). Expected: the row shows "Opening" and then "Open"; the slider follows when the cover reports a position.
6. Tap "Favorite" on an entity. Expected: the "Favorites" page appears first, with that entity.
7. Close the application (menu, Quit) and open it again. Expected: the main screen appears at once with the last known state and "Offline - showing the last known state", then "Connecting...", then "Connected" within a few seconds; the favorite is still there.
8. Press the Home key, wait 70 s, and come back. Expected: "Offline" or "Connecting..." at the bottom when the window returns, then "Connected" within two seconds (the socket closed after 60 s behind another window and opened again at once).
9. Turn the wireless off for 30 s and on again. Expected: "Offline - showing the last known state", then "Connected" within a minute (the back-off of 1, 2, 5, 10, 30 s).
10. Menu, "Sign out". Expected: the sign-in screen with the server URL filled in and an empty token field. The About screen (before the sign-out) says that the token stays valid until the user deletes it in the profile.
11. Type a wrong token (change one character of the token) and tap "Sign in". Expected: "Home Assistant did not accept the token. Make a new token in your profile."; the URL stays in its field.
12. Sign in again with the correct token. Expected: the main screen, as in item 1.

- [ ] **Step 4: The acceptance list through the remote URL**

Sign out, then repeat items 1, 2 and 7 of Step 3 with the remote URL (`https://<id>.ui.nabu.casa`, or the public HTTPS name) and the same token: a long-lived token is valid on every URL of the server. Nabu Casa serves `/api/` and `wss://<host>/api/websocket` on the same host, with a Let's Encrypt certificate; nothing in the application changes. If step 1 shows "The certificate is not valid", Task 1 Step 3 already said so: the n810-modern CA store misses the root, and `n810-modern-tls` must be updated first; record it as a blocker. If the sign-in works but the main screen stays on "Connecting...", read the log: start the application over SSH with the lines below and look for the close reason of the socket (the `error` event text of M3a); Nabu Casa closes an idle socket after a few minutes, and the 30 s ping keeps it open.

- [ ] **Step 5: Measure the performance targets (HA spec section 8)**

Run the application over SSH with `--timing`, at the default governor, with the real server (the token is in `localStorage` after Step 3 or Step 4, so no token goes on the command line):

```bash
A='. /etc/osso-af-init/af-defines.sh; DISPLAY=:0 /opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/ha-remote/app.js --timing'
G=/sys/devices/system/cpu/cpu0/cpufreq
ssh -p 2222 user@<tablet-ip> "cat $G/scaling_governor $G/scaling_cur_freq; $A" 2>&1 | grep 'HA-TIMING\|kHz\|^[0-9]'
```

Ask your human partner to tap one check box while it runs, then to quit the application from the menu. Expected lines: `HA-TIMING snapshot <ms>` (target: less than 3,000 ms; this is "tap on the icon to the snapshot" minus the process start, which the Extras menu adds and this plan does not measure), `HA-TIMING live <ms>, <n> entities` (target: less than 3,000 ms after the snapshot), and `HA-TIMING toggle <ms>` (the JavaScript part of "tap on a toggle to the service call sent"; the target of 100 ms covers the GTK event too, which the M2a `tree1` row puts at about 56 ms at 400 MHz).

Memory with 300 entities, against the fake server on the development computer (the tablet reaches it over the LAN; `<dev-ip>` is the address of the computer):

```bash
devhost/run.sh 'cd runtime && PYTHONPATH=test/server python3 test/server/ha.py 8123 --bind 0.0.0.0 --entities 294' &
ssh -p 2222 user@<tablet-ip> "$A --server http://<dev-ip>:8123 --token test-token" 2>&1 | grep HA-TIMING &
sleep 40; ssh -p 2222 user@<tablet-ip> 'ps -o rss= -p $(pidof maemo-react-host)'
```

The `--server` arguments sign in only when there is no token: sign out on the tablet first (menu, "Sign out"), and sign in with the real token again after the measurements. `devhost/run.sh` must publish the port: set `PORTS='-p 0.0.0.0:8123:8123'` in its environment for this run. Expected: `HA-TIMING live` with 300 entities, and an RSS below 30,720 kB (target: less than 30 MB). Repeat with `--entities 1994` (2,000 entities): record the `live` time and the RSS; the risk table asks for a "Loading..." label when a parse takes more than 200 ms, so record whether the window stays blank between `snapshot` and `live`.

Repeat the 300-entity run at 165 MHz: `ssh -p 2222 user@<tablet-ip> "echo 'echo powersave > $G/scaling_governor' | sudo gainroot; cat $G/scaling_cur_freq"` before, and `echo ondemand > ...` after. Check that `scaling_cur_freq` prints `165000`; the clock sometimes rises by itself, so read it again after the run.

- [ ] **Step 6: Record the results**

Create `maemo-react/docs/ha-remote-acceptance.md` from this template, with the values of the run (the date, the N810 firmware, the Home Assistant version from "About"; no addresses):

```markdown
# HA Remote acceptance test

Date: <YYYY-MM-DD>. Tablet: Nokia N810, Diablo-Turbo, the n810-modern PREEMPT
backport kernel, runtime 0.3.0, HA Remote 0.1.0. Server: Home Assistant
<version>, over the LAN and through the remote URL.

## The acceptance list (HA spec section 9)

| Step | LAN | Remote URL |
| --- | --- | --- |
| Sign in with the token (paste, "Show") | | |
| Toggle a light | | |
| Change the brightness | | |
| Set the thermostat | | |
| Open a cover | | - |
| Add a favorite | | - |
| Close and open: the snapshot shows first | | |
| 70 s behind another window: reconnect on return | | - |
| Wireless off for 30 s: reconnect | | - |
| Sign out: the URL stays, the token field is empty | | - |
| Wrong token: the message, the URL stays | | - |

## The performance targets (HA spec section 8)

| Measurement | Target | Measured | Governor, clock |
| --- | --- | --- | --- |
| Start to the snapshot (`HA-TIMING snapshot`) | < 3 s | | |
| Snapshot to live state, LAN (`HA-TIMING live`) | < 3 s more | | |
| Toggle to the service call sent, JavaScript part (`HA-TIMING toggle`) | < 100 ms with the GTK event | | |
| Memory with 300 entities (RSS) | < 30 MB | | |
| Live state with 2,000 entities (`HA-TIMING live`) | recorded | | |
| Memory with 2,000 entities (RSS) | recorded | | |
| Live state with 300 entities at 165 MHz | recorded | | |

## Findings

<one line for each thing that did not work, or "none">
```

- [ ] **Step 7: Commit**

```bash
git add maemo-react/examples/ha-remote/src/main.tsx maemo-react/docs/ha-remote-acceptance.md
git commit -m "Record the HA Remote acceptance test on the tablet"
```

---

## Deviations from the HA spec, with the reasons

| Spec | This plan | Why |
| --- | --- | --- |
| Section 4: send the three registry commands and `subscribe_entities` "in one batch" | the subscription goes after the registry results | the first event is placed and named in one pass; the cost is one round trip on the LAN |
| Section 5: "the toggles are not available until the connection is live" | the toggle column is empty while offline (`on: null`), the rows stay selectable | a disabled list would also block the detail panel of the snapshot |
| Section 2: the status line | "Connected - 12:41", "Connecting... - 12:41", "Offline - showing the last known state - 12:41" | the time is the last update, as the spec drawing shows |

## Open risks

1. **A wrong token and the IP ban of Home Assistant.** When the user's configuration sets `ip_ban_enabled` and `login_attempts_threshold`, each refused token counts as a failed login. The application sends one request per "Sign in" and does not reconnect after `auth_invalid`, so a loop cannot ban the tablet; a user who types many wrong tokens can. The user removes a ban in `ip_bans.yaml`.
2. **The CA store and Let's Encrypt (Task 1 Step 3).** If `n810-modern-tls` lacks ISRG Root X1, the remote URL fails in every TLS client of the tablet; that is a change outside this plan.
3. **Large installations (Task 9 Step 5).** The first `subscribe_entities` event of 2,000 entities is a few MB of JSON; `JSON.parse` on the tablet may take seconds. The plan records it; a "Loading..." label is a follow-up if it is over 200 ms.
4. **`is-topmost` on the real tablet (Task 2).** typegen saw the property, and the signal name parses; only the tablet shows whether Hildon changes it when the task navigator covers the window. Task 9 Step 3 item 8 checks it.
5. **A process killed by the task navigator** does not reach the `localStorage` flush of M3a. The snapshot is at most 10 s old then; the token is written at sign-in, during idle time within milliseconds.
