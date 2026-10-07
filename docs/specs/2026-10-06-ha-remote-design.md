# HA Remote: a Home Assistant client for the N810

Status: draft, 2026-10-06; revised 2026-10-07 (sign-in with a long-lived
access token). This spec replaces the podcast player as the
maemo-react showcase. The parent spec is
`2026-10-06-maemo-react-design.md`. Section 13 of the parent spec gives the
new milestone order.

## 1. Purpose

HA Remote makes the N810 a handheld remote for a Home Assistant server. The
user picks up the tablet, opens the application, changes a light or a
thermostat, and puts the tablet down. A fast start and a fast connection are
more important than a view that stays open all day.

The application also proves the library. It uses `List`, the M2 widgets,
`fetch`, `WebSocket` and `localStorage` in one real application.

### What the user said

- The tablet is a handheld remote, not a wall panel.
- Version 1 controls lights, switches, climate devices and covers.
- The tablet connects on the home LAN and from outside, through Nabu Casa or
  a public HTTPS URL.
- 2026-10-07: "let's use a token for now, I don't want to do hacky
  workarounds". The user signs in with a Home Assistant long-lived access
  token. The first draft had a username and a password; that design is
  removed.
- The main screen shows a Favorites page first, then one page for each Home
  Assistant area.
- "Do your best and we'll adjust later." The details in this spec are
  defaults that the user can change.

### Assumptions

- The application does not run in the background. It shows live state only
  when it is open.
- The Home Assistant server is version 2023.x or newer (it has
  `subscribe_entities` and `config/entity_registry/list_for_display`).

### Non-goals for version 1

- Media players, scenes, scripts, cameras, history graphs, and Lovelace
  dashboards.
- Notifications from Home Assistant when the application is closed.
- More than one server.
- Edits to the Home Assistant configuration.

## 2. Screens

The Hildon window is 800 x 480. The application has three screens.

### Sign-in

- Fields: server URL and token. A "Sign in" button.
- The token field hides the text. A "Show" toggle button shows it.
- A token has approximately 180 characters, and the N810 keyboard is slow.
  The token field accepts paste, so the user can copy the token in the
  browser of the tablet. The screen has no other entry aids.
- A short text tells the user where to make the token: the Home Assistant
  profile, "Security" tab, "Long-lived access tokens".
- Errors appear under the button in plain words: "The server did not answer",
  "The certificate is not valid", "Home Assistant did not accept the token.
  Make a new token in your profile."
- A URL that starts with `http://` shows the warning "The token goes over
  the network without encryption". The user can continue.

### Main

```
+-------------+---------------------------------+-----------------+
| Favorites   | Ceiling light      On   [x]     |  Ceiling light  |
| Living room | Desk lamp          Off  [ ]     |                 |
| Kitchen     | Thermostat     21.0 °C  heat    |  Brightness     |
| Bedroom     | Blinds            Open          |  [=====o-----]  |
| ...         |                                 |   [ Favorite ]  |
+-------------+---------------------------------+-----------------+
| Connected - 12:41                                [Menu]          |
+------------------------------------------------------------------+
```

- Left: a `List` of pages. "Favorites" is first. The areas follow in the
  order of the Home Assistant area registry. "Other" collects the entities
  that have no area. An empty page is not shown.
- Middle: a `List` of the entities on the page. Each row shows the name, the
  state and, for an on/off entity, a toggle. A tap on the toggle sends the
  service call at once.
- Right: the detail panel of the selected entity. It shows the controls that
  section 4 gives for the domain, and a "Favorite" toggle button.
- Bottom: the connection state ("Connected", "Connecting...", "Offline -
  showing the last known state") and the time of the last update.
- The Hildon menu has "Reconnect", "Sign out" and "About".

### About

The version of the application, of maemo-react and of the Home Assistant
server. A note: "Sign out" deletes the token from the tablet only. To stop
the token, the user deletes it in the Home Assistant profile.

## 3. Architecture

```
src/
  ha/          no React and no GTK: unit tests run under Node
    auth.ts        server URL, token check, token in storage
    connection.ts  WebSocket, auth message, message ids, reconnect
    model.ts       registries + states -> pages and rows (pure functions)
    actions.ts     entity + user action -> service call (pure function)
    store.ts       state of the application; listeners for React
  ui/          React components (SignIn, Main, PageList, EntityList, Detail)
  main.tsx
```

- `ha/` uses only `fetch`, `WebSocket`, `localStorage` and timers. The tests
  give it fakes.
- `store.ts` keeps one object and calls its listeners after a change. The UI
  reads it with `useSyncExternalStore`.
- The state of a row changes only when Home Assistant sends the new state.
  The application does not guess the result of a service call. A pending call
  shows a small "..." in the row. After 5 s with no state change, a Hildon
  banner shows "Home Assistant did not answer".

## 4. Home Assistant interface

### Sign-in and the token

1. The user makes a long-lived access token in the Home Assistant profile
   ("Security" tab, "Long-lived access tokens"). The token is valid for 10
   years.
2. The application removes the spaces and the line breaks at the start and
   at the end of the token. It keeps only the scheme, the host and the port
   of the server URL.
3. At sign-in, the application sends `GET /api/` with
   `Authorization: Bearer <token>`. When the answer is 200, the application
   keeps the URL and the token and opens the live connection.
4. The WebSocket auth message sends the token as `access_token`. A REST call
   sends the token as `Authorization: Bearer <token>`.
5. There is no token refresh. When Home Assistant answers `auth_invalid` or
   HTTP 401, the application deletes the token and shows the sign-in screen
   with the server URL kept and the message "Home Assistant did not accept
   the token. Make a new token in your profile." It does not reconnect.
6. "Sign out" deletes the token from the storage only. The application
   cannot revoke a long-lived token; the user deletes it in the profile.

### Live connection

1. Open `wss://<server>/api/websocket` (`ws://` for an `http://` URL).
2. Send `{type: "auth", access_token}` and wait for `auth_ok`.
3. Send in one batch: `config/area_registry/list`,
   `config/device_registry/list`, `config/entity_registry/list_for_display`
   and `subscribe_entities`.
4. The area of an entity is its own `area_id`. If it has none, the area is
   the `area_id` of its device.
5. Keep only the domains `light`, `switch`, `fan`, `input_boolean`,
   `climate` and `cover`. Drop hidden and disabled entities.
6. `subscribe_entities` sends the full states first, then changes in its
   compressed form. `model.ts` applies both forms.

### Actions

| Domain | Row | Detail panel |
| --- | --- | --- |
| `light` | toggle (`light.toggle`) | brightness `Scale` 0-100 % (`light.turn_on`, `brightness_pct`), when the light has a brightness mode |
| `switch`, `fan`, `input_boolean` | toggle (`<domain>.toggle`) | none |
| `climate` | current and target temperature, mode | target temperature -/+ in steps of `target_temp_step` (default 0.5); mode `ComboBox` from `hvac_modes` |
| `cover` | position or open/closed | Open, Stop, Close buttons (by `supported_features`); position `Scale` when the cover has a position |

A `Scale` sends its value when the user releases the slider, not during the
drag.

### Connection rules

- If the connection closes, try again after 1, 2, 5, 10 and then every 30 s.
  "Reconnect" in the menu tries again at once.
- Send `{type: "ping"}` every 30 s. If no pong comes in 10 s, close the
  socket and reconnect.
- When the window is not on top (`is-topmost` is false) for 60 s, close the
  socket. When the window comes back on top, reconnect at once. This saves
  the battery when the user leaves the application open.

## 5. Storage

`localStorage` keys:

| Key | Contents |
| --- | --- |
| `ha.server` | the server URL |
| `ha.token` | the long-lived access token |
| `ha.favorites` | an array of entity IDs, in the order the user added them |
| `ha.snapshot` | areas, rows and states from the last connection |

At start, the application shows the snapshot at once with the label
"Offline - showing the last known state", then it connects. The toggles are
not available until the connection is live.

The `localStorage` file must have mode 0600, because it holds the token.

## 6. What the library must give

| Item | Milestone | Note |
| --- | --- | --- |
| `List` on `GtkTreeView`, with a toggle column and row selection | M2 | first M2 item already |
| `Scale`, `ComboBox`, `ToggleButton` | M2 | in the M2 list; the three columns are a `Box`, which M1 has |
| Hildon `Menu`, `Banner` | M2 | in the M2 list |
| `WebSocket` (text frames are enough; binary frames for conformance) | M3 | libcurl 8.22 has WebSocket support; use the same GLib fd-watch design as `fetch`; protocols `ws` and `wss` only |
| `localStorage` | M3 | file in `appDataDir`, mode 0600 |
| `useSyncExternalStore` works with the renderer | M2 | a test in `@maemo-react/core` |

## 7. Errors

| Condition | What the user sees |
| --- | --- |
| No network, DNS failure | Status "Offline - showing the last known state"; reconnect with the back-off |
| TLS certificate not valid | Sign-in error "The certificate is not valid". There is no option to skip the check. |
| Home Assistant does not accept the token (HTTP 401 at sign-in, or `auth_invalid` later) | The sign-in screen, with the server URL filled in and "Home Assistant did not accept the token. Make a new token in your profile." The application deletes the token. |
| `call_service` returns an error | A banner with the Home Assistant message |
| An entity is removed on the server | The row goes away; the favorite stays in storage and shows nothing |

## 8. Performance targets (on the tablet, at the governor's normal clock)

| Measurement | Target |
| --- | --- |
| Tap on the icon to the snapshot on the screen | less than 3 s |
| Snapshot to live state, on the LAN | less than 3 s more |
| Tap on a toggle to the service call sent | less than 100 ms |
| Memory with 300 entities | less than 30 MB resident |

## 9. Tests

- Unit tests (Vitest, on the development computer): `auth.ts` against a fake
  `fetch` and a fake storage; `connection.ts` against a fake `WebSocket`;
  `model.ts` and `actions.ts` with recorded Home Assistant messages.
- A fake Home Assistant server in Python (`runtime/test/server/`): `GET /api/`
  and the WebSocket auth with one configured token, the registries and
  `subscribe_entities`, and a `call_service` that changes the state. The
  emulator end-to-end test signs in with that token, toggles a light and
  checks the row.
- Acceptance on the tablet, against the user's server, on the LAN and through
  the remote URL: sign in with a token, toggle a light, change the
  brightness, set a thermostat, open a cover, add a favorite, close and open
  the application (the snapshot shows first), sign out, and sign in with a
  wrong token (the message shows).

## 10. Risks

| Risk | Plan |
| --- | --- |
| The registries of a large installation are big (MBs of JSON) | Drop unused fields while the JSON is parsed into the model; measure on the tablet with the fake server and 2,000 entities. |
| A JSON parse of a large message blocks the UI | Measure first. If it is more than 200 ms, show "Loading..." before the parse. |
| Nabu Casa needs features that curl does not give | Test the remote URL early in M3. |
