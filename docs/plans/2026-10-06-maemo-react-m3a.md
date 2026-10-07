# maemo-react M3a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give maemo-react the two web-standard globals that HA Remote needs: `WebSocket` on libcurl 8.22 and `localStorage` on a JSON file in the application data folder, with tests on the desktop host and under qemu-user with the Diablo libraries, and the runtime version 0.3.0.

**Architecture:** The C part gives primitives and the prelude gives the standard shape (spec section 7). A new `curlm.c` owns the one curl multi handle on GLib fd watches; `http.c` and the new `ws.c` add easy handles to it and get a callback when a transfer ends. `ws.c` does the handshake in `CURLOPT_CONNECT_ONLY=2` mode, then watches the socket itself and moves frames with `curl_ws_recv` and `curl_ws_send`. Every event goes to a queue and reaches JavaScript from an idle source, as in `http.c`. `storage.c` reads and writes `localStorage.json` in `appDataDir` with a temporary file and `rename`, during idle time after a change. The prelude adds `WebSocket`, `CloseEvent`, `MessageEvent` and `localStorage`.

**Tech Stack:** C99, QuickJS 2025-09-13, GLib 2.12, GTK 2.10, Hildon 2.0.6, libcurl 8.22.0 (the n810-modern build for Diablo; a new build for the desktop container), Python 3.12 (stdlib only) for the test servers, React 19.3.0, TypeScript 5.9.3, Vitest 5.0.3, Docker (the `maemo-react-dev` image), qemu-user.

**Spec:** `maemo-react/docs/specs/2026-10-06-maemo-react-design.md` (sections 3, 7, 8, 11, 13 and 14) and `maemo-react/docs/specs/2026-10-06-ha-remote-design.md` (sections 4, 5 and 6). Read both before you start. This plan implements the first half of milestone M3 (spec section 13). The second half, HA Remote, is `docs/plans/2026-10-06-maemo-react-m3b.md`.

Run the commands in `maemo-react/` unless the command says otherwise. The `git` paths start at the repository root (`n810-modern/`). `docs/plans/2026-10-06-maemo-react-m2a.md` is the plan of M2a; its tasks show the same conventions.

## Global Constraints

- The runtime is C99 only (spec section 2).
- Diablo binaries must need no glibc symbol newer than `GLIBC_2.5`, and must have the ABI tag `2.6.8`. `runtime/check-glibc.sh` checks both.
- Use only APIs that exist in GLib 2.12, GTK 2.10 and Hildon 2.0. Do not use `g_timeout_add_seconds` (2.14), `g_strcmp0` (2.16), `g_unix_signal_add` (2.30) or `g_file_set_contents` with a mode (the 2.12 function takes no mode; this plan writes the file with `open(2)`). Every GLib, curl and POSIX function in this plan was checked in the headers of `/work/sysroot-diablo` and `/work/out/opt/n810-modern/include` on 2026-10-06, except where a step says to check it.
- libcurl is 8.22.0 on both targets. The Diablo build is in `/work/out/opt/n810-modern` and has `WS` and `WSS` in `curl-config --protocols`. The desktop container has Ubuntu's libcurl 8.5.0, which has no WebSocket support: Task 1 builds curl 8.22.0 into the dev image. `curl_ws_recv`, `curl_ws_send`, `CURLOPT_CONNECT_ONLY`, `CURLOPT_WS_OPTIONS`, `CURLWS_*` and `CURLINFO_ACTIVESOCKET` were checked in the 8.22.0 headers.
- JavaScript never runs inside a curl callback. The C modules queue their events and deliver them from an idle source (`http.c` shows the pattern). A connect-only easy handle stays in the multi handle as long as the module uses the socket (`CURLOPT_CONNECT_ONLY` documentation, 8.22.0).
- `WebSocket` accepts `ws:` and `wss:` URLs only; `http:` and `https:` are converted, as browsers do. TLS checks the certificate against the CA store of `n810-modern-tls`; `MR_CA_BUNDLE` points at the test certificate in the tests. There is no option to skip the check.
- `localStorage` is a JSON file in `appDataDir`, written during idle time after a change (spec section 7), with mode `0600` (HA spec section 5), written with a temporary file and `rename`.
- The install prefix is `/opt/n810-modern`. The runtime binary is `/opt/n810-modern/bin/maemo-react-host`. Applications live in `/opt/n810-modern/share/maemo-react/apps/<id>/app.js`.
- Packages use gzip compression. Diablo's dpkg 1.14 cannot read xz or zstd.
- The runtime version becomes `0.3.0`. An application made by the CLI depends on `maemo-react-runtime (>= 0.3.0)`, because the new prelude needs the new modules.
- Never pipe `runtime/test/run.sh` into `grep`, `tail` or `head`: its background Xvfb and servers keep the pipe open, and the command never ends. Redirect the output to a file, then read the file.
- Never run plain `npm install` in `maemo-react`: npm bug #4828 drops the `@rolldown/binding-*` entries from `package-lock.json`. This plan adds no workspace. If a step changes `package-lock.json`, check `git diff package-lock.json` has no deletions.
- Run one QEMU system emulator at a time. Boot the emulator with `VNC_PASSWORD=n810` when you use `tools/emulator-gui-build.sh`; `devhost/emulator-run.sh` boots without VNC and needs no password. This plan uses qemu-user only; the emulator check is in the M3b plan.
- The tablet kernel has no `userspace` governor. Use `powersave` for 165 MHz and check the `cpu` field of each `BENCH` line. This plan takes no time measurements.
- Write all English prose, code comments and commit messages in ASD-STE100 Simplified Technical English. Commit messages follow the repository style: an imperative summary line, for example `Add the shared curl multi handle`. No `feat:` prefixes, no attribution lines.

## Review Focus

These five conditions are implied by the specs but no task's main tests exercise them. Each one has a test in the task that owns the code:

1. **A `WebSocket` URL with `http:` or `https:`** (HA Remote passes the server URL that the user typed). Expected: the scheme becomes `ws:` or `wss:`, as browsers do since 2023, not a `SyntaxError`. Test: Task 3, `websocket.test.js` (prelude) "an http or https URL becomes ws or wss".
2. **`send()` of a typed array view with a `byteOffset`.** Expected: only the bytes of the view go out, not the whole buffer. Test: Task 3, `websocket.test.js` (prelude) "send of a view sends only the bytes of the view".
3. **The server drops the TCP connection without a close frame** (Home Assistant restarts). Expected: an `error` event, then a `close` event with code 1006 and `wasClean` false; no hang. Test: Task 2, `ws.test.js` "the server drops the connection".
4. **`localStorage.setItem` with a value that is not a string, and `getItem` of a missing key.** Expected: the value is stored as its string form; a missing key gives `null`, not `undefined`. Test: Task 4, `storage.test.js` (prelude) "values become strings and a missing key is null".
5. **A message that arrives after `close()` was called.** Expected: no `message` event (the WHATWG standard delivers messages only in the OPEN state). Test: Task 3, `websocket.test.js` (prelude) "no message after close()".

## File Structure

```
maemo-react/
  devhost/Dockerfile               MODIFY: curl 8.22.0 with WebSocket for the desktop host
  devhost/check-env.sh             MODIFY: check WS in the desktop curl
  runtime/src/mr.h                 MODIFY: MR_VERSION 0.3.0, curlm, ws, storage, app id
  runtime/src/curlm.c              CREATE: the shared curl multi handle on GLib fd watches
  runtime/src/http.c               MODIFY: use curlm.c
  runtime/src/ws.c                 CREATE: maemo:ws
  runtime/src/storage.c            CREATE: maemo:storage
  runtime/src/app.c                MODIFY: id, dataDir
  runtime/src/main.c               MODIFY: register the modules; flush the storage at exit
  runtime/test/run.sh              MODIFY: the WebSocket servers, MR_DATA_DIR
  runtime/test/server/wsproto.py   CREATE: RFC 6455 framing and handshake on the stdlib
  runtime/test/server/wsserver.py  CREATE: the test WebSocket server
  runtime/test/http.test.js        MODIFY: the User-Agent version
  runtime/test/ws.test.js          CREATE: maemo:ws against the test server
  runtime/test/websocket.test.js   CREATE: the WebSocket global against the test server
  runtime/test/storage.test.js     CREATE: localStorage in one process
  runtime/test/storage.sh          CREATE: the file, its mode, and a corrupt file, over several runs
  runtime/test/storage/*.js        CREATE: the small programs that storage.sh runs
  prelude/src/websocket.js         CREATE: WebSocket, CloseEvent, MessageEvent
  prelude/src/storage.js           CREATE: localStorage
  prelude/src/index.js             MODIFY: the new globals
  prelude/test/websocket.test.js   CREATE
  prelude/test/storage.test.js     CREATE
  packages/types/globals.d.ts      MODIFY: WebSocket, CloseEvent, MessageEvent, Storage, localStorage
  packages/types/modules.d.ts      MODIFY: maemo:ws, maemo:storage, maemo:app id and dataDir
  packages/types/test/check.tsx    MODIFY
  packages/cli/src/app.ts          MODIFY: the runtime dependency
  packages/cli/test/cli.test.ts    MODIFY: the runtime dependency
  README.md                        MODIFY: the runtime version, the dev image, the new globals
```

---

### Task 1: The shared curl multi handle, curl 8.22 in the dev image, and the runtime version

**Files:**
- Create: `maemo-react/runtime/src/curlm.c`
- Modify: `maemo-react/runtime/src/http.c` (the `Req` struct, the multi code, `check_done`, `req_free`, `js_request`, `mr_init_http`)
- Modify: `maemo-react/runtime/src/mr.h:8` and the end of the file
- Modify: `maemo-react/devhost/Dockerfile`, `maemo-react/devhost/check-env.sh`
- Modify: `maemo-react/packages/cli/src/app.ts:8`, `maemo-react/packages/cli/test/cli.test.ts:118`
- Modify: `maemo-react/runtime/test/http.test.js` (the User-Agent test)
- Test: the existing `runtime/test/http.test.js` and `runtime/test/fetch.test.js` on both targets

**Interfaces:**
- Consumes: the curl multi code that is in `http.c` now (`on_socket`, `on_timer`, `on_io`, `check_done`).
- Produces (in `mr.h`):
  - `typedef struct MrCurlOwner MrCurlOwner; struct MrCurlOwner { void (*done)(CURL *easy, CURLcode result, MrCurlOwner *owner); };` The owner of an easy handle is a struct whose first member is an `MrCurlOwner`. curl keeps the pointer in `CURLOPT_PRIVATE`. `done` runs from the main loop when the transfer ends; it may run JavaScript and may free the easy handle.
  - `CURLM *mr_curl_multi(void)`: the multi handle; made on the first call, with `curl_global_init`.
  - `void mr_curl_add(CURL *easy, MrCurlOwner *owner)`: sets `CURLOPT_PRIVATE` and adds the handle to the multi.
  - `void mr_curl_remove(CURL *easy)`: removes the handle from the multi. Task 2 uses all three.
  - `MR_VERSION` is `"0.3.0"`. `runtime/build.sh diablo deb` makes `runtime/dist/maemo-react-runtime_0.3.0_armel.deb`.
  - The dev image has libcurl 8.22.0 in `/usr/local`, and `pkg-config --modversion libcurl` prints `8.22.0` in the container.

- [ ] **Step 1: Build curl 8.22.0 into the dev image**

In `maemo-react/devhost/Dockerfile`, add `libssl-dev` to the `apt-get install` list (after `libcurl4-openssl-dev`), and add at the end of the file:

```dockerfile
# Ubuntu's libcurl 8.5.0 has no WebSocket support. The host needs the same
# curl as the tablet: 8.22.0, with ws and wss. It goes to /usr/local, which
# pkg-config and the loader search first.
ARG CURL_VERSION=8.22.0
ARG CURL_SHA256=d54dd598bf05927a726deb38df31c6a255ba83ff1de57c5d1464dac3ed8f44a1
RUN cd /tmp \
    && curl -fsSL --retry 3 -O "https://curl.se/download/curl-$CURL_VERSION.tar.gz" \
    && echo "$CURL_SHA256  curl-$CURL_VERSION.tar.gz" | sha256sum -c - \
    && tar xzf "curl-$CURL_VERSION.tar.gz" && cd "curl-$CURL_VERSION" \
    && ./configure --prefix=/usr/local --with-openssl \
         --with-ca-bundle=/etc/ssl/certs/ca-certificates.crt \
         --enable-websockets \
         --disable-ldap --disable-ldaps --without-libpsl --without-libidn2 \
         --without-brotli --without-zstd --without-nghttp2 --without-libssh2 \
         --without-librtmp --disable-manual \
    && make -j"$(nproc)" >/dev/null && make install >/dev/null && ldconfig \
    && cd / && rm -rf "/tmp/curl-$CURL_VERSION" "/tmp/curl-$CURL_VERSION.tar.gz"
ENV PKG_CONFIG_PATH=/usr/local/lib/pkgconfig
```

The SHA256 is the one in `tools/build-curl.sh`. In `maemo-react/devhost/check-env.sh`, add after the line that checks the n810-modern libcurl:

```bash
need "desktop libcurl 8.22 with WebSocket" sh -c 'curl-config --protocols | grep -q WSS'
```

Read `check-env.sh` first: `need` takes a label and a command. If its signature differs, follow the file.

Build the image again. `devhost/run.sh` builds it only when it is missing, so build it by hand:

```bash
docker build -t maemo-react-dev devhost
devhost/run.sh 'pkg-config --modversion libcurl; curl-config --protocols | tr "\n" " "; echo; devhost/check-env.sh'
```

Expected: `8.22.0`, a protocol list with `WS WSS`, and `check-env.sh` reports every item as ready. The build takes a few minutes.

- [ ] **Step 2: Write curlm.c**

Create `maemo-react/runtime/src/curlm.c`:

```c
/* The curl multi handle on the GLib main loop. http.c and ws.c add easy
   handles to it. The owner of an easy handle is a struct that starts with
   an MrCurlOwner; curl keeps the pointer in CURLOPT_PRIVATE. When a transfer
   ends, the done callback of the owner runs. It runs from the main loop, not
   inside a curl callback, so it may run JavaScript and free the handle. */
#include <curl/curl.h>
#include "mr.h"

typedef struct {
    GIOChannel *channel;
    guint watch;
} Sock;

static CURLM *multi;
static guint timer_source;

static void check_done(void)
{
    CURLMsg *msg;
    int left;
    while ((msg = curl_multi_info_read(multi, &left))) {
        MrCurlOwner *owner = NULL;
        if (msg->msg != CURLMSG_DONE)
            continue;
        curl_easy_getinfo(msg->easy_handle, CURLINFO_PRIVATE, (char **)&owner);
        if (owner && owner->done)
            owner->done(msg->easy_handle, msg->data.result, owner);
    }
}

static gboolean on_io(GIOChannel *ch, GIOCondition cond, gpointer data)
{
    int running, flags = 0;
    if (cond & (G_IO_IN | G_IO_HUP))
        flags |= CURL_CSELECT_IN;
    if (cond & G_IO_OUT)
        flags |= CURL_CSELECT_OUT;
    if (cond & (G_IO_ERR | G_IO_NVAL))
        flags |= CURL_CSELECT_ERR;
    curl_multi_socket_action(multi, g_io_channel_unix_get_fd(ch), flags, &running);
    check_done();
    return TRUE;
}

static int on_socket(CURL *easy, curl_socket_t s, int what, void *userp, void *socketp)
{
    Sock *k = socketp;
    GIOCondition cond = G_IO_ERR;
    if (what == CURL_POLL_REMOVE) {
        if (k) {
            g_source_remove(k->watch);
            g_io_channel_unref(k->channel);
            g_free(k);
        }
        curl_multi_assign(multi, s, NULL);
        return 0;
    }
    if (!k) {
        k = g_new0(Sock, 1);
        k->channel = g_io_channel_unix_new(s);
        curl_multi_assign(multi, s, k);
    } else {
        g_source_remove(k->watch);
    }
    if (what & CURL_POLL_IN)
        cond |= G_IO_IN | G_IO_HUP;
    if (what & CURL_POLL_OUT)
        cond |= G_IO_OUT;
    k->watch = g_io_add_watch(k->channel, cond, on_io, NULL);
    return 0;
}

static gboolean on_timeout(gpointer data)
{
    int running;
    timer_source = 0;
    curl_multi_socket_action(multi, CURL_SOCKET_TIMEOUT, 0, &running);
    check_done();
    return FALSE;
}

static int on_timer(CURLM *m, long ms, void *userp)
{
    if (timer_source) {
        g_source_remove(timer_source);
        timer_source = 0;
    }
    if (ms >= 0)
        timer_source = g_timeout_add((guint)ms, on_timeout, NULL);
    return 0;
}

CURLM *mr_curl_multi(void)
{
    if (!multi) {
        curl_global_init(CURL_GLOBAL_DEFAULT);
        multi = curl_multi_init();
        curl_multi_setopt(multi, CURLMOPT_SOCKETFUNCTION, on_socket);
        curl_multi_setopt(multi, CURLMOPT_TIMERFUNCTION, on_timer);
    }
    return multi;
}

void mr_curl_add(CURL *easy, MrCurlOwner *owner)
{
    curl_easy_setopt(easy, CURLOPT_PRIVATE, owner);
    curl_multi_add_handle(mr_curl_multi(), easy);
}

void mr_curl_remove(CURL *easy)
{
    if (multi)
        curl_multi_remove_handle(multi, easy);
}
```

In `maemo-react/runtime/src/mr.h`, change `#include "quickjs.h"` to:

```c
#include <curl/curl.h>
#include "quickjs.h"
```

change `#define MR_VERSION "0.2.0"` to `#define MR_VERSION "0.3.0"`, and add before the `/* http.c */` block:

```c
/* curlm.c */
typedef struct MrCurlOwner MrCurlOwner;
struct MrCurlOwner {
    /* The transfer ended. Runs from the main loop; it may run JavaScript and free easy. */
    void (*done)(CURL *easy, CURLcode result, MrCurlOwner *owner);
};
CURLM *mr_curl_multi(void);
void mr_curl_add(CURL *easy, MrCurlOwner *owner);
void mr_curl_remove(CURL *easy);
```

- [ ] **Step 3: Make http.c use curlm.c**

In `maemo-react/runtime/src/http.c`:

1. In the `Req` struct, add as the first member: `MrCurlOwner owner; /* first: curlm.c finds the request through it */`.
2. Delete the `Sock` typedef, the statics `multi` and `timer_source`, the prototype `static void check_done(void);`, and the functions `on_io`, `on_socket`, `on_timeout`, `on_timer` and `check_done`.
3. In `req_free`, change `curl_multi_remove_handle(multi, r->easy);` to `mr_curl_remove(r->easy);`.
4. Add after `free_aborted` the callback that replaces `check_done`:

```c
/* curlm.c calls this when the transfer ends. */
static void on_done(CURL *easy, CURLcode result, MrCurlOwner *owner)
{
    Req *r = (Req *)owner;
    if (!r->aborted) {
        if (result == CURLE_OK) {
            send_headers(r);
            flush_req(r);
            if (!r->aborted)
                emit(r, new_event("end"));
        } else {
            flush_req(r);
            if (!r->aborted) {
                JSValue ev = new_event("error");
                const char *text = r->error[0] ? r->error : curl_easy_strerror(result);
                JS_SetPropertyStr(mr_ctx, ev, "message", JS_NewString(mr_ctx, text));
                JS_SetPropertyStr(mr_ctx, ev, "code", JS_NewInt32(mr_ctx, result));
                emit(r, ev);
            }
        }
    }
    req_free(r);
}
```

5. In `js_request`, delete `curl_easy_setopt(r->easy, CURLOPT_PRIVATE, r);`, and change the last two statements before `return` from:

```c
    g_hash_table_insert(requests, GINT_TO_POINTER(r->id), r);
    curl_multi_add_handle(multi, r->easy);
```

to:

```c
    r->owner.done = on_done;
    g_hash_table_insert(requests, GINT_TO_POINTER(r->id), r);
    mr_curl_add(r->easy, &r->owner);
```

6. In `mr_init_http`, replace the `if (!multi) { ... }` block with:

```c
    if (!requests)
        requests = g_hash_table_new(g_direct_hash, g_direct_equal);
```

`emit`, `flush_req`, `emit_later`, `in_emit` and `js_abort` stay as they are: the events still reach JavaScript from the idle source or from `on_done`, which runs from the main loop.

- [ ] **Step 4: The version in the CLI, the tests and the README**

In `maemo-react/packages/cli/src/app.ts`, change line 8 to:

```ts
export const RUNTIME_DEPENDS = 'maemo-react-runtime (>= 0.3.0)';
```

In `maemo-react/packages/cli/test/cli.test.ts:118`, change `(>= 0.2.0)` to `(>= 0.3.0)`. In `maemo-react/runtime/test/http.test.js`, change `'maemo-react/0.2.0'` to `'maemo-react/0.3.0'`. In `maemo-react/README.md`, change `maemo-react-runtime_0.2.0_armel.deb` to `maemo-react-runtime_0.3.0_armel.deb`, and add after the sentence that explains `devhost/run.sh`:

```
The image holds its own curl 8.22.0 with WebSocket support. After a change of
`devhost/Dockerfile`, build the image again with `docker build -t maemo-react-dev devhost`.
```

- [ ] **Step 5: Run the tests on both targets**

```bash
npm test
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo' > /tmp/m3a-t1.log 2>&1; tail -40 /tmp/m3a-t1.log
```

Expected: every Vitest file passes; every runtime line is `PASS` on both targets, including `test/http.test.js` and `test/fetch.test.js`. `check-glibc.sh` prints no error for the Diablo binary. `ldd runtime/build/desktop/bin/maemo-react-host | grep curl` (in the container) prints `/usr/local/lib/libcurl.so.4`.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/runtime/src/curlm.c maemo-react/runtime/src/http.c maemo-react/runtime/src/mr.h maemo-react/devhost/Dockerfile maemo-react/devhost/check-env.sh maemo-react/packages/cli/src/app.ts maemo-react/packages/cli/test/cli.test.ts maemo-react/runtime/test/http.test.js maemo-react/README.md
git commit -m "Share the curl multi handle, build curl 8.22 into the dev image, and make the runtime 0.3.0"
```

---

### Task 2: The maemo:ws module and the test WebSocket server

**Files:**
- Create: `maemo-react/runtime/src/ws.c`
- Modify: `maemo-react/runtime/src/mr.h` (the `ws.c` block), `maemo-react/runtime/src/main.c` (`register_modules`)
- Create: `maemo-react/runtime/test/server/wsproto.py`, `maemo-react/runtime/test/server/wsserver.py`
- Modify: `maemo-react/runtime/test/run.sh` (start the servers)
- Create: `maemo-react/runtime/test/ws.test.js`

**Interfaces:**
- Consumes: `mr_curl_add`, `mr_curl_remove`, `MrCurlOwner` (Task 1); `mr_call`, `mr_ctx` (loop.c).
- Produces the native module `maemo:ws`. Task 3 builds `WebSocket` on it.
  - `open(options, onEvent): number`. `options.url` (a `ws:` or `wss:` URL; another scheme throws a `TypeError`), `options.protocols` (an array of strings for `Sec-WebSocket-Protocol`; CR or LF in one throws a `TypeError`), `options.timeoutMs` (the handshake limit, default 30000). Returns the connection id.
  - `send(id, data, binary)`: `data` is a string (a text frame) or an `ArrayBuffer` (a binary frame when `binary` is true, else a text frame). Throws a `TypeError` when the connection is not open.
  - `close(id, code, reason)`: sends a close frame (no payload when `code` is 0) and waits 5 s for the close frame of the server.
  - `abort(id)`: drops the connection at once; no more events.
  - `bufferedAmount(id): number`: the bytes of `send` data that curl did not take yet.
  - The events, in the order they happen: `{type: 'open', protocol}`; `{type: 'message', data}` with a string for a text message or an `ArrayBuffer` for a binary message, fragments already joined; `{type: 'error', message}`; `{type: 'close', code, reason, wasClean}`. `error` always comes before a `close` with `wasClean` false, except when the 5 s wait for the server close frame times out; then `close` with `wasClean` false comes without `error`. After `close` there are no more events.
- Produces the test servers. `wsproto.py` has the framing. `wsserver.py <port> [cert key]` serves these paths: `/echo`, `/fragments`, `/big`, `/many`, `/close`, `/drop`, `/hang`, `/reject`, `/badproto`, `/ping`, `/slow-close`. The M3b plan reuses `wsproto.py` for the fake Home Assistant.

**The design decisions, with the reasons:**

- Connect-only mode (`CURLOPT_CONNECT_ONLY=2`) with `curl_ws_recv` and `curl_ws_send`, not the write-callback mode. In the callback mode the transfer never ends, frames arrive only inside a curl callback, and `curl_ws_send` outside a callback is not supported for that mode in a reliable way; HA Remote sends at any time (auth, subscribe, service calls, pings). In connect-only mode curl does the handshake through the multi handle, reports `CURLMSG_DONE`, and leaves the socket to the application. The `CURLOPT_CONNECT_ONLY` documentation of 8.22.0 says the easy handle must stay in the multi handle while the application uses the socket; `conn_free` removes it at the end.
- The module watches the socket (`CURLINFO_ACTIVESOCKET`) with its own GLib watch. On input it calls `curl_ws_recv` until `CURLE_AGAIN`: TLS can hold decoded bytes that the socket does not show. On `CURLE_AGAIN` from `curl_ws_send` it adds `G_IO_OUT` to the watch and continues later.
- Fragments: in curl 8.22.0 every fragment carries `CURLWS_TEXT` or `CURLWS_BINARY`, and `CURLWS_CONT` is set on all fragments except the final one (`lib/ws.c`, `ws_frame_op2flags`, and `curl_ws_recv.md`). A frame larger than the receive buffer arrives in pieces with `bytesleft > 0`. The module joins both into one message.
- Ping: curl answers a ping with a pong by itself in the default mode (`CURLWS_NOAUTOPONG` is off) and does not return the ping frame from `curl_ws_recv`. The `/ping` test checks this.
- A message is at most 16 MB. A larger one fails the connection.

- [ ] **Step 1: Write the framing module and the test server**

Create `maemo-react/runtime/test/server/wsproto.py`:

```python
"""RFC 6455 framing and handshake for the test servers, on the stdlib only
(the dev image has no `websockets` package). Server side: the server reads
masked frames and sends unmasked frames.

    ws = upgrade(handler)        # in a BaseHTTPRequestHandler method
    kind, data = ws.recv_message()
    ws.send_text('hi')
"""
import base64
import hashlib
import struct
import threading

GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
CONT, TEXT, BINARY, CLOSE, PING, PONG = 0, 1, 2, 8, 9, 10


class Closed(Exception):
    """The peer sent a close frame, or the stream ended."""


def accept_key(key):
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()


def unmask(data, mask):
    n = len(data)
    if n == 0:
        return data
    m = int.from_bytes(mask * (n // 4 + 1), 'little') & ((1 << (8 * n)) - 1)
    return (int.from_bytes(data, 'little') ^ m).to_bytes(n, 'little')


class WebSocket:
    """One server-side connection over the rfile and wfile of a request handler."""

    def __init__(self, rfile, wfile):
        self.rfile = rfile
        self.wfile = wfile
        self.pongs = []
        self.close_sent = False
        self.close_code = None
        self.close_reason = ''
        # When False, recv_message does not answer the close frame of the peer.
        self.answer_close = True
        # The fake Home Assistant sends events from other threads.
        self.send_lock = threading.Lock()

    def send_frame(self, opcode, payload=b'', fin=True):
        head = bytes([(0x80 if fin else 0) | opcode])
        n = len(payload)
        if n < 126:
            head += bytes([n])
        elif n < 65536:
            head += struct.pack('>BH', 126, n)
        else:
            head += struct.pack('>BQ', 127, n)
        with self.send_lock:
            self.wfile.write(head + payload)
            self.wfile.flush()

    def send_text(self, text, fin=True, cont=False):
        self.send_frame(CONT if cont else TEXT, text.encode(), fin)

    def send_binary(self, data, fin=True, cont=False):
        self.send_frame(CONT if cont else BINARY, data, fin)

    def send_ping(self, payload=b''):
        self.send_frame(PING, payload)

    def send_pong(self, payload=b''):
        self.send_frame(PONG, payload)

    def send_close(self, code=1000, reason=''):
        self.close_sent = True
        self.send_frame(CLOSE, struct.pack('>H', code) + reason.encode() if code else b'')

    def read_frame(self):
        """(fin, opcode, payload). Raises Closed at the end of the stream."""
        head = self.rfile.read(2)
        if len(head) < 2:
            raise Closed()
        fin = bool(head[0] & 0x80)
        opcode = head[0] & 0x0F
        masked = bool(head[1] & 0x80)
        n = head[1] & 0x7F
        if n == 126:
            n = struct.unpack('>H', self.rfile.read(2))[0]
        elif n == 127:
            n = struct.unpack('>Q', self.rfile.read(8))[0]
        mask = self.rfile.read(4) if masked else b''
        data = self.rfile.read(n)
        if len(data) < n:
            raise Closed()
        return fin, opcode, unmask(data, mask) if masked else data

    def recv_message(self):
        """The next data message as (opcode, bytes), with its fragments joined.
        Answers a ping. Keeps a pong in self.pongs. A close frame gets an
        answer (when answer_close is True) and raises Closed."""
        buf = b''
        kind = None
        while True:
            fin, opcode, data = self.read_frame()
            if opcode == PING:
                self.send_pong(data)
                continue
            if opcode == PONG:
                self.pongs.append(data)
                continue
            if opcode == CLOSE:
                has_code = len(data) >= 2
                self.close_code = struct.unpack('>H', data[:2])[0] if has_code else 1005
                self.close_reason = data[2:].decode('utf-8', 'replace')
                if self.answer_close and not self.close_sent:
                    self.send_close(self.close_code if has_code else 0)
                raise Closed()
            if opcode in (TEXT, BINARY):
                kind = opcode
                buf = data
            elif opcode == CONT:
                buf += data
            if fin:
                return kind, buf


def upgrade(handler, protocol=None):
    """Answer the Upgrade request of a BaseHTTPRequestHandler. Returns a
    WebSocket, or None after a 400 for a request that is not an upgrade."""
    key = handler.headers.get('Sec-WebSocket-Key')
    if handler.headers.get('Upgrade', '').lower() != 'websocket' or not key:
        handler.send_response(400)
        handler.send_header('Content-Length', '0')
        handler.end_headers()
        return None
    handler.send_response(101)
    handler.send_header('Upgrade', 'websocket')
    handler.send_header('Connection', 'Upgrade')
    handler.send_header('Sec-WebSocket-Accept', accept_key(key))
    if protocol:
        handler.send_header('Sec-WebSocket-Protocol', protocol)
    handler.end_headers()
    handler.close_connection = True
    return WebSocket(handler.rfile, handler.wfile)


def offered_protocols(handler):
    """The protocols that the client offered, in order."""
    line = handler.headers.get('Sec-WebSocket-Protocol', '')
    return [p.strip() for p in line.split(',') if p.strip()]
```

Create `maemo-react/runtime/test/server/wsserver.py`:

```python
#!/usr/bin/env python3
"""The WebSocket test server for the maemo:ws and WebSocket tests.

    wsserver.py <port> <cert.pem> <key.pem>   wss on the port
    wsserver.py <port>                        ws, without TLS

Every path takes the first protocol that the client offers, except
/badproto, which answers with a protocol that the client did not offer.
"""
import ssl
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from wsproto import BINARY, CLOSE, PONG, TEXT, Closed, offered_protocols, upgrade


def echo(ws):
    while True:
        kind, data = ws.recv_message()
        if kind == TEXT:
            ws.send_text(data.decode())
        else:
            ws.send_binary(data)


def wait_for_close(ws):
    try:
        while True:
            ws.recv_message()
    except Closed:
        pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/reject':
            body = b'no'
            self.send_response(403)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == '/hang':
            time.sleep(10)  # the request is read; the answer never comes
            return
        offered = offered_protocols(self)
        protocol = 'nope' if path == '/badproto' else (offered[0] if offered else None)
        ws = upgrade(self, protocol)
        if ws is None:
            return
        try:
            self.serve(path, ws)
        except (Closed, ConnectionError, OSError):
            pass

    def serve(self, path, ws):
        if path == '/fragments':
            ws.send_text('abc', fin=False)
            ws.send_text('def', fin=False, cont=True)
            ws.send_ping(b'between')
            ws.send_text('ghi', fin=True, cont=True)
            block = bytes(range(256)) * 4  # 1024 bytes
            ws.send_binary(block, fin=False)
            ws.send_binary(block, fin=True, cont=True)
            ws.send_close(1000, 'done')
            wait_for_close(ws)
        elif path == '/big':
            ws.send_text('x' * (1024 * 1024))
            while True:
                kind, data = ws.recv_message()
                ws.send_text('len:%d' % len(data))
        elif path == '/many':
            for i in range(500):
                ws.send_text('n:%d' % i)
            ws.send_close(1000, 'done')
            wait_for_close(ws)
        elif path == '/close':
            ws.send_close(4000, 'bye')
            wait_for_close(ws)
        elif path == '/drop':
            ws.send_text('hi')
            self.connection.close()  # no close frame: the TCP connection ends
        elif path == '/ping':
            ws.send_ping(b'hi')
            self.connection.settimeout(3)
            try:
                while not ws.pongs:
                    fin, opcode, data = ws.read_frame()
                    if opcode == PONG:
                        ws.pongs.append(data)
                    elif opcode == CLOSE:
                        raise Closed()
            except (OSError, Closed):
                pass
            self.connection.settimeout(None)
            ws.send_text('pong ok' if ws.pongs == [b'hi'] else 'pong missing')
            echo(ws)
        elif path == '/slow-close':
            ws.answer_close = False
            try:
                echo(ws)
            except Closed:
                time.sleep(8)  # the client gives up after 5 s
        else:
            echo(ws)


def main():
    port = int(sys.argv[1])
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    if len(sys.argv) > 3:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(sys.argv[2], sys.argv[3])
        server.socket = tls.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


main()
```

`wsproto` is imported by its module name, so `run.sh` starts the server with `test/server` on `PYTHONPATH`, or from that folder. In `maemo-react/runtime/test/run.sh`, add after the line that starts `server.py`:

```bash
# The WebSocket test servers: wss on 8444, ws on 8445.
pgrep -f 'server/wsserver.py 8444' >/dev/null || { PYTHONPATH=test/server python3 test/server/wsserver.py 8444 "$CERT" "$KEY" >/tmp/mr-test-wsserver.log 2>&1 & sleep 1; }
pgrep -f 'server/wsserver.py 8445' >/dev/null || { PYTHONPATH=test/server python3 test/server/wsserver.py 8445 >/tmp/mr-test-wsserver-plain.log 2>&1 & sleep 1; }
```

Check the server by hand with the desktop curl 8.22 of Task 1:

```bash
devhost/run.sh 'cd runtime && (PYTHONPATH=test/server python3 test/server/wsserver.py 8445 &) ; sleep 1; printf "hello" | curl -s --no-buffer --max-time 2 ws://127.0.0.1:8445/echo -T - ; echo; pkill -f "wsserver.py 8445"'
```

Expected: `hello` comes back (curl's command-line WebSocket mode echoes the frame); the exit code of `curl` is 28 (the time limit), which is normal for this check.

- [ ] **Step 2: Write the failing test**

Create `maemo-react/runtime/test/ws.test.js`:

```js
import { test, assert, assertEqual, assertThrows, run } from './harness.js';
import { open, send, close, abort, bufferedAmount } from 'maemo:ws';

const WSS = 'wss://localhost:8444';
const WS = 'ws://localhost:8445';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Open a connection and record its events. `done` resolves at the close event.
function connect(url, options = {}) {
  const c = { events: [], messages: [], id: 0 };
  c.done = new Promise((resolve) => {
    c.id = open({ url, ...options }, (ev) => {
      c.events.push(ev.type);
      if (ev.type === 'open') c.open = ev;
      if (ev.type === 'message') c.messages.push(ev.data);
      if (ev.type === 'error') c.error = ev;
      if (ev.type === 'close') {
        c.close = ev;
        resolve(c);
      }
    });
  });
  // Resolves at the open event, or at the close event when there is no open.
  c.opened = new Promise((resolve) => {
    const check = () => {
      if (c.open || c.close) resolve(c);
      else setTimeout(check, 10);
    };
    check();
  });
  // Resolves when n messages are in.
  c.until = (n) =>
    new Promise((resolve) => {
      const check = () => {
        if (c.messages.length >= n || c.close) resolve(c);
        else setTimeout(check, 10);
      };
      check();
    });
  return c;
}

const bytes = (n) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = i & 0xff;
  return b;
};

test('open gives the protocol, echo gives the text back, and close is clean', async () => {
  const c = connect(WSS + '/echo', { protocols: ['ha', 'other'] });
  await c.opened;
  assertEqual(c.open.protocol, 'ha');
  send(c.id, 'hello', false);
  await c.until(1);
  assertEqual(c.messages, ['hello']);
  close(c.id, 1000, 'bye');
  await c.done;
  assertEqual([c.close.code, c.close.reason, c.close.wasClean], [1000, 'bye', true]);
  assertEqual(c.events, ['open', 'message', 'close']);
});

test('ws without TLS works too', async () => {
  const c = connect(WS + '/echo');
  await c.opened;
  assertEqual(c.open.protocol, '');
  send(c.id, 'plain', false);
  await c.until(1);
  assertEqual(c.messages, ['plain']);
  close(c.id, 1000, '');
  await c.done;
  assertEqual(c.close.code, 1000);
});

test('binary frames keep their bytes', async () => {
  const c = connect(WSS + '/echo');
  await c.opened;
  send(c.id, bytes(300).buffer, true);
  await c.until(1);
  assert(c.messages[0] instanceof ArrayBuffer, 'an ArrayBuffer');
  assertEqual(Array.from(new Uint8Array(c.messages[0])), Array.from(bytes(300)));
  close(c.id, 1000, '');
  await c.done;
});

test('UTF-8 text goes both ways', async () => {
  const c = connect(WSS + '/echo');
  await c.opened;
  const text = 'héllo 日本 🎉';
  send(c.id, text, false);
  await c.until(1);
  assertEqual(c.messages, [text]);
  close(c.id, 1000, '');
  await c.done;
});

test('fragments reassemble into one message, also with a ping between them', async () => {
  const c = connect(WSS + '/fragments');
  await c.done;
  assertEqual(c.messages.length, 2);
  assertEqual(c.messages[0], 'abcdefghi');
  assert(c.messages[1] instanceof ArrayBuffer, 'the second message is binary');
  assertEqual(c.messages[1].byteLength, 2048);
  assertEqual(new Uint8Array(c.messages[1])[1024 + 5], 5);
  assertEqual([c.close.code, c.close.reason, c.close.wasClean], [1000, 'done', true]);
});

test('a 1 MB message in both directions', async () => {
  const c = connect(WSS + '/big');
  await c.until(1);
  assertEqual(c.messages[0].length, 1024 * 1024);
  assert(c.messages[0].startsWith('xxxxxxxx') && c.messages[0].endsWith('xxxxxxxx'), 'all x');
  send(c.id, 'y'.repeat(1024 * 1024), false);
  assert(typeof bufferedAmount(c.id) === 'number', 'bufferedAmount is a number');
  await c.until(2);
  assertEqual(c.messages[1], 'len:1048576');
  assertEqual(bufferedAmount(c.id), 0);
  close(c.id, 1000, '');
  await c.done;
});

test('many small messages arrive in order', async () => {
  const c = connect(WSS + '/many');
  await c.done;
  assertEqual(c.messages.length, 500);
  assertEqual([c.messages[0], c.messages[499]], ['n:0', 'n:499']);
  assertEqual(c.close.code, 1000);
});

test('the server closes with a code and a reason', async () => {
  const c = connect(WSS + '/close');
  await c.done;
  assertEqual(c.events, ['open', 'close']);
  assertEqual([c.close.code, c.close.reason, c.close.wasClean], [4000, 'bye', true]);
});

test('the server drops the connection', async () => {
  const c = connect(WSS + '/drop');
  await c.done;
  assertEqual(c.events, ['open', 'message', 'error', 'close']);
  assertEqual([c.close.code, c.close.wasClean], [1006, false]);
  assert(c.error.message.length > 0, 'the error has a message');
});

test('a handshake that the server refuses', async () => {
  const c = connect(WSS + '/reject');
  await c.done;
  assertEqual(c.events, ['error', 'close']);
  assert(c.error.message.includes('403'), c.error.message);
  assertEqual([c.close.code, c.close.wasClean], [1006, false]);
});

test('a closed port and a host that does not resolve', async () => {
  const a = connect('wss://localhost:1/');
  await a.done;
  assertEqual(a.events, ['error', 'close']);
  const b = connect('wss://nonexistent.invalid/');
  await b.done;
  assertEqual(b.events, ['error', 'close']);
});

test('timeoutMs stops a handshake that hangs', async () => {
  const t0 = performance.now();
  const c = connect(WSS + '/hang', { timeoutMs: 500 });
  await c.done;
  assertEqual(c.events, ['error', 'close']);
  assert(performance.now() - t0 < 2500, 'fast');
});

test('timeoutMs covers the handshake only', async () => {
  const c = connect(WSS + '/echo', { timeoutMs: 1000 });
  await c.opened;
  await sleep(2500);
  send(c.id, 'still here', false);
  await c.until(1);
  assertEqual(c.messages, ['still here']);
  close(c.id, 1000, '');
  await c.done;
});

test('a server that does not answer our close frame', async () => {
  const c = connect(WSS + '/slow-close');
  await c.opened;
  const t0 = performance.now();
  close(c.id, 1000, 'going');
  await c.done;
  const ms = performance.now() - t0;
  assert(ms >= 4500 && ms < 7500, 'about 5 s: ' + ms);
  assertEqual([c.close.code, c.close.wasClean], [1006, false]);
});

test('curl answers a ping by itself', async () => {
  const c = connect(WSS + '/ping');
  await c.until(1);
  assertEqual(c.messages, ['pong ok']);
  close(c.id, 1000, '');
  await c.done;
});

test('send before open throws, and abort gives no more events', async () => {
  const c = connect(WSS + '/echo');
  assertThrows(() => send(c.id, 'early', false), /TypeError: .*not open/);
  abort(c.id);
  await sleep(500);
  assertEqual(c.events, []);
  assertEqual(bufferedAmount(c.id), 0);
});

test('abort from inside a message handler stops the events', async () => {
  const types = [];
  const id = open({ url: WSS + '/many' }, (ev) => {
    types.push(ev.type);
    if (ev.type === 'message') abort(id);
  });
  await sleep(1000);
  assertEqual(types, ['open', 'message']);
});

test('bad arguments', () => {
  assertThrows(() => open({ url: WSS + '/echo' }, null), /TypeError/);
  assertThrows(() => open({ url: 'https://localhost:8444/echo' }, () => {}), /TypeError: .*ws/);
  assertThrows(() => open({ url: WSS + '/echo', protocols: ['a\r\nX: y'] }, () => {}), /TypeError/);
  assertThrows(() => open({}, () => {}), /TypeError: .*url/);
  assertThrows(() => send(999999, 'x', false), /TypeError/);
});

await run();
```

- [ ] **Step 3: Run the test to see it fail**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/test/run.sh desktop test/ws.test.js' > /tmp/m3a-t2.log 2>&1; tail -20 /tmp/m3a-t2.log
```

Expected: `FAIL test/ws.test.js` with an error about the module `maemo:ws` (the loader does not know it).

- [ ] **Step 4: Write ws.c**

Create `maemo-react/runtime/src/ws.c`:

```c
/* maemo:ws -- WebSocket connections with libcurl on the GLib main loop.
   curl does the handshake through the shared multi handle (curlm.c) in
   CONNECT_ONLY=2 mode. After the handshake this module watches the socket
   itself and moves frames with curl_ws_recv and curl_ws_send. JavaScript
   gets the events open, message, error and close. The prelude builds the
   WebSocket class on top of it. */
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>
#include <curl/websockets.h>
#include "mr.h"

#define MAX_MESSAGE (16 * 1024 * 1024) /* bytes of one message */
#define CLOSE_WAIT_MS 5000             /* after our close frame, wait this long for the server's */

enum { CONNECTING, OPEN, CLOSING, CLOSED };

typedef struct {
    guint8 *data;
    gsize len;
    gsize off;      /* the bytes that curl took */
    unsigned flags; /* CURLWS_TEXT, CURLWS_BINARY or CURLWS_CLOSE */
} Frame;

typedef struct {
    MrCurlOwner owner; /* first: curlm.c finds the connection through it */
    int id;
    CURL *easy;
    JSValue cb;
    struct curl_slist *req_headers;
    gchar *protocol; /* Sec-WebSocket-Protocol of the response, or NULL */
    char error[CURL_ERROR_SIZE];
    int state;
    GIOChannel *channel; /* the socket, after the handshake */
    guint watch;
    GByteArray *message; /* the fragments of the message in progress */
    int message_binary;  /* the kind of that message; -1 when none */
    GQueue *outgoing;    /* Frame* */
    gsize buffered;      /* bytes of send data that curl did not take yet */
    gboolean close_sent;
    gboolean close_received;
    int close_code;
    gchar *close_reason;
    guint close_timer;
    GQueue *pending; /* events for JavaScript, as JSValue pointers */
    guint flush_source;
    gboolean finished; /* the close event is queued; free the connection after the flush */
    gboolean dead;     /* abort() ran: no more events */
} Conn;

static GHashTable *conns; /* id -> Conn */
static int next_id = 1;
static int in_emit; /* above zero while an event runs in JavaScript */

static void frame_free(Frame *f)
{
    g_free(f->data);
    g_free(f);
}

static void drop_pending(Conn *c)
{
    JSValue *ev;
    while ((ev = g_queue_pop_head(c->pending)) != NULL) {
        JS_FreeValue(mr_ctx, *ev);
        g_free(ev);
    }
}

static void clear_watch(Conn *c)
{
    if (c->watch) {
        g_source_remove(c->watch);
        c->watch = 0;
    }
}

static void conn_free(Conn *c)
{
    Frame *f;
    clear_watch(c);
    if (c->close_timer)
        g_source_remove(c->close_timer);
    if (c->flush_source)
        g_source_remove(c->flush_source);
    drop_pending(c);
    g_queue_free(c->pending);
    while ((f = g_queue_pop_head(c->outgoing)) != NULL)
        frame_free(f);
    g_queue_free(c->outgoing);
    g_hash_table_remove(conns, GINT_TO_POINTER(c->id));
    if (c->channel)
        g_io_channel_unref(c->channel);
    mr_curl_remove(c->easy);
    curl_easy_cleanup(c->easy); /* closes the socket */
    curl_slist_free_all(c->req_headers);
    g_byte_array_free(c->message, TRUE);
    g_free(c->protocol);
    g_free(c->close_reason);
    JS_FreeValue(mr_ctx, c->cb);
    g_free(c);
}

static JSValue new_event(const char *type)
{
    JSValue ev = JS_NewObject(mr_ctx);
    JS_SetPropertyStr(mr_ctx, ev, "type", JS_NewString(mr_ctx, type));
    return ev;
}

/* Give an event to JavaScript. Takes ownership of ev. */
static void emit(Conn *c, JSValue ev)
{
    JSValue res;
    in_emit++;
    res = mr_call(c->cb, JS_UNDEFINED, 1, (JSValueConst *)&ev);
    in_emit--;
    JS_FreeValue(mr_ctx, res);
    JS_FreeValue(mr_ctx, ev);
}

static void flush_conn(Conn *c)
{
    JSValue *ev;
    while (!c->dead && (ev = g_queue_pop_head(c->pending)) != NULL) {
        emit(c, *ev);
        g_free(ev);
    }
    if (c->dead)
        drop_pending(c);
}

static gboolean on_flush(gpointer data)
{
    Conn *c = g_hash_table_lookup(conns, data);
    if (!c)
        return FALSE;
    c->flush_source = 0;
    flush_conn(c);
    /* A dead connection is freed by free_dead. */
    if (c->finished && !c->dead)
        conn_free(c);
    return FALSE;
}

/* Queue an event for JavaScript. The frames are read from a GLib watch and
   the handshake ends in a curlm.c callback; both are outside curl callbacks.
   The queue still keeps JavaScript out of the read loop, so a handler that
   closes the connection cannot free it under the loop. Takes ownership. */
static void emit_later(Conn *c, JSValue ev)
{
    JSValue *copy = g_new(JSValue, 1);
    *copy = ev;
    g_queue_push_tail(c->pending, copy);
    if (!c->flush_source)
        c->flush_source = g_idle_add_full(G_PRIORITY_DEFAULT, on_flush, GINT_TO_POINTER(c->id), NULL);
}

/* Queue the close event. The connection is freed after the flush. */
static void finish(Conn *c, int code, const char *reason, gboolean clean)
{
    JSValue ev;
    if (c->finished)
        return;
    c->finished = TRUE;
    c->state = CLOSED;
    clear_watch(c);
    if (c->close_timer) {
        g_source_remove(c->close_timer);
        c->close_timer = 0;
    }
    ev = new_event("close");
    JS_SetPropertyStr(mr_ctx, ev, "code", JS_NewInt32(mr_ctx, code));
    JS_SetPropertyStr(mr_ctx, ev, "reason", JS_NewString(mr_ctx, reason ? reason : ""));
    JS_SetPropertyStr(mr_ctx, ev, "wasClean", JS_NewBool(mr_ctx, clean));
    emit_later(c, ev);
}

/* The transport failed. With the close frame of the server already in, the
   close is clean. Otherwise JavaScript gets error, then close with 1006. */
static void fail(Conn *c, const char *message)
{
    JSValue ev;
    if (c->finished)
        return;
    if (c->close_received) {
        finish(c, c->close_code, c->close_reason, TRUE);
        return;
    }
    ev = new_event("error");
    JS_SetPropertyStr(mr_ctx, ev, "message", JS_NewString(mr_ctx, message));
    emit_later(c, ev);
    finish(c, 1006, "", FALSE);
}

static gboolean on_io(GIOChannel *ch, GIOCondition cond, gpointer data);

/* Watch the socket for input, and for output when curl could not take a whole frame. */
static void set_watch(Conn *c, gboolean want_out)
{
    GIOCondition cond = G_IO_IN | G_IO_HUP | G_IO_ERR | (want_out ? G_IO_OUT : 0);
    clear_watch(c);
    c->watch = g_io_add_watch(c->channel, cond, on_io, GINT_TO_POINTER(c->id));
}

static void enqueue(Conn *c, const guint8 *data, gsize len, unsigned flags)
{
    Frame *f = g_new0(Frame, 1);
    f->data = len ? g_memdup(data, len) : NULL;
    f->len = len;
    f->flags = flags;
    g_queue_push_tail(c->outgoing, f);
    if (!(flags & CURLWS_CLOSE))
        c->buffered += len;
}

/* Give the queued frames to curl. curl_ws_send takes a part of a frame when
   the socket is full: then the next call continues the same frame (the
   curl_ws_send documentation, 8.22.0). CURLE_AGAIN means wait for G_IO_OUT. */
static void pump_send(Conn *c)
{
    while (!g_queue_is_empty(c->outgoing)) {
        Frame *f = g_queue_peek_head(c->outgoing);
        size_t sent = 0;
        CURLcode rc = curl_ws_send(c->easy, f->data + f->off, f->len - f->off, &sent, 0, f->flags);
        f->off += sent;
        if (!(f->flags & CURLWS_CLOSE))
            c->buffered -= sent;
        if (rc == CURLE_AGAIN) {
            set_watch(c, TRUE);
            return;
        }
        if (rc != CURLE_OK) {
            fail(c, c->error[0] ? c->error : curl_easy_strerror(rc));
            return;
        }
        if (f->off < f->len)
            continue; /* curl took a part; give it the rest now */
        g_queue_pop_head(c->outgoing);
        frame_free(f);
    }
    if (c->finished)
        return;
    set_watch(c, FALSE);
    if (c->close_sent && c->close_received)
        finish(c, c->close_code, c->close_reason, TRUE);
}

static void send_close_frame(Conn *c, int code, const char *reason)
{
    guint8 buf[125];
    gsize n = 0;
    if (code > 0) {
        gsize rlen = reason ? strlen(reason) : 0;
        if (rlen > 123)
            rlen = 123;
        buf[0] = (guint8)(code >> 8);
        buf[1] = (guint8)(code & 0xff);
        memcpy(buf + 2, reason, rlen);
        n = 2 + rlen;
    }
    enqueue(c, buf, n, CURLWS_CLOSE);
    c->close_sent = TRUE;
}

static gboolean on_close_timeout(gpointer data)
{
    Conn *c = g_hash_table_lookup(conns, data);
    if (c) {
        c->close_timer = 0;
        finish(c, 1006, "", FALSE); /* the server did not answer our close frame */
    }
    return FALSE;
}

static void emit_message(Conn *c)
{
    JSValue ev = new_event("message");
    const guint8 *data = c->message->data ? c->message->data : (const guint8 *)"";
    if (c->message_binary)
        JS_SetPropertyStr(mr_ctx, ev, "data", JS_NewArrayBufferCopy(mr_ctx, data, c->message->len));
    else
        JS_SetPropertyStr(mr_ctx, ev, "data", JS_NewStringLen(mr_ctx, (const char *)data, c->message->len));
    emit_later(c, ev);
    g_byte_array_set_size(c->message, 0);
    c->message_binary = -1;
}

/* Read every frame that curl has. Returns FALSE when the connection ended. */
static gboolean pump_recv(Conn *c)
{
    guint8 buf[16384];
    for (;;) {
        size_t n = 0;
        const struct curl_ws_frame *meta = NULL;
        CURLcode rc = curl_ws_recv(c->easy, buf, sizeof buf, &n, &meta);
        if (rc == CURLE_AGAIN)
            return TRUE;
        if (rc != CURLE_OK) {
            fail(c, rc == CURLE_GOT_NOTHING ? "the server closed the connection" : curl_easy_strerror(rc));
            return FALSE;
        }
        if (meta->flags & CURLWS_CLOSE) {
            /* A close frame has at most 125 bytes, so it arrives in one piece. */
            gboolean has_code = n >= 2;
            c->close_code = has_code ? (buf[0] << 8) | buf[1] : 1005;
            g_free(c->close_reason);
            c->close_reason = n > 2 ? g_strndup((const char *)buf + 2, n - 2) : g_strdup("");
            c->close_received = TRUE;
            if (!c->close_sent)
                send_close_frame(c, has_code ? c->close_code : 0, "");
            pump_send(c); /* finishes the connection when the frame is out */
            return FALSE;
        }
        if (!(meta->flags & (CURLWS_TEXT | CURLWS_BINARY)))
            continue; /* a pong; curl answers a ping itself and does not return it */
        if (c->message_binary < 0)
            c->message_binary = (meta->flags & CURLWS_BINARY) ? 1 : 0;
        if (c->message->len + n > MAX_MESSAGE) {
            fail(c, "a message is larger than 16 MB");
            return FALSE;
        }
        g_byte_array_append(c->message, buf, (guint)n);
        if (meta->bytesleft == 0 && !(meta->flags & CURLWS_CONT))
            emit_message(c);
    }
}

static gboolean on_io(GIOChannel *ch, GIOCondition cond, gpointer data)
{
    Conn *c = g_hash_table_lookup(conns, data);
    guint id;
    if (!c)
        return FALSE;
    id = c->watch;
    if ((cond & G_IO_OUT) && !c->finished)
        pump_send(c);
    if ((cond & (G_IO_IN | G_IO_HUP | G_IO_ERR)) && !c->finished)
        pump_recv(c);
    /* set_watch and finish remove this source themselves. */
    return c->watch == id;
}

/* curlm.c calls this when the handshake ends. */
static void on_done(CURL *easy, CURLcode result, MrCurlOwner *owner)
{
    Conn *c = (Conn *)owner;
    curl_socket_t s = CURL_SOCKET_BAD;
    JSValue ev;
    if (c->dead)
        return;
    if (result != CURLE_OK) {
        fail(c, c->error[0] ? c->error : curl_easy_strerror(result));
        return;
    }
    curl_easy_getinfo(easy, CURLINFO_ACTIVESOCKET, &s);
    if (s == CURL_SOCKET_BAD) {
        fail(c, "no socket after the handshake");
        return;
    }
    c->channel = g_io_channel_unix_new(s);
    c->state = OPEN;
    ev = new_event("open");
    JS_SetPropertyStr(mr_ctx, ev, "protocol", JS_NewString(mr_ctx, c->protocol ? c->protocol : ""));
    emit_later(c, ev);
    set_watch(c, FALSE);
    pump_recv(c); /* frames that came with the handshake are in curl's buffer already */
}

static size_t on_header(char *buf, size_t size, size_t n, void *data)
{
    Conn *c = data;
    size_t len = size * n;
    static const char name[] = "sec-websocket-protocol:";
    size_t nlen = sizeof name - 1;
    if (len > nlen && !g_ascii_strncasecmp(buf, name, nlen)) {
        gchar *v = g_strndup(buf + nlen, len - nlen);
        g_free(c->protocol);
        c->protocol = g_strdup(g_strstrip(v));
        g_free(v);
    }
    return len;
}

/* Read a string property of options; NULL if absent. Free with JS_FreeCString. */
static const char *opt_string(JSContext *ctx, JSValueConst opts, const char *name)
{
    JSValue v = JS_GetPropertyStr(ctx, opts, name);
    const char *s = (JS_IsUndefined(v) || JS_IsNull(v)) ? NULL : JS_ToCString(ctx, v);
    JS_FreeValue(ctx, v);
    return s;
}

/* The Sec-WebSocket-Protocol header from options.protocols. -1 after a TypeError. */
static int add_protocols(JSContext *ctx, Conn *c, JSValueConst opts)
{
    JSValue list = JS_GetPropertyStr(ctx, opts, "protocols");
    GString *line = g_string_new("Sec-WebSocket-Protocol: ");
    uint32_t i, n = 0;
    int rc = 0;
    if (JS_IsArray(ctx, list)) {
        JSValue lenv = JS_GetPropertyStr(ctx, list, "length");
        JS_ToUint32(ctx, &n, lenv);
        JS_FreeValue(ctx, lenv);
    }
    for (i = 0; i < n && rc == 0; i++) {
        JSValue item = JS_GetPropertyUint32(ctx, list, i);
        const char *s = JS_ToCString(ctx, item);
        if (!s || !*s || strpbrk(s, "\r\n,")) {
            JS_ThrowTypeError(ctx, "open: bad protocol name");
            rc = -1;
        } else {
            if (i)
                g_string_append(line, ", ");
            g_string_append(line, s);
        }
        if (s)
            JS_FreeCString(ctx, s);
        JS_FreeValue(ctx, item);
    }
    JS_FreeValue(ctx, list);
    if (rc == 0 && n > 0)
        c->req_headers = curl_slist_append(c->req_headers, line->str);
    g_string_free(line, TRUE);
    return rc;
}

static JSValue js_open(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JSValueConst opts = argv[0];
    const char *url;
    const char *ca = g_getenv("MR_CA_BUNDLE");
    JSValue v;
    double timeout = 30000;
    Conn *c;
    if (!JS_IsObject(opts) || !JS_IsFunction(ctx, argv[1]))
        return JS_ThrowTypeError(ctx, "open(options, onEvent): wrong arguments");
    if (!(url = opt_string(ctx, opts, "url")))
        return JS_ThrowTypeError(ctx, "open: options.url is missing");
    if (!g_str_has_prefix(url, "ws://") && !g_str_has_prefix(url, "wss://")) {
        JS_FreeCString(ctx, url);
        return JS_ThrowTypeError(ctx, "open: only ws and wss URLs are supported");
    }

    c = g_new0(Conn, 1);
    c->owner.done = on_done;
    c->id = next_id++;
    c->easy = curl_easy_init();
    c->cb = JS_DupValue(ctx, argv[1]);
    c->pending = g_queue_new();
    c->outgoing = g_queue_new();
    c->message = g_byte_array_new();
    c->message_binary = -1;
    c->state = CONNECTING;
    g_hash_table_insert(conns, GINT_TO_POINTER(c->id), c);
    curl_easy_setopt(c->easy, CURLOPT_URL, url); /* curl copies strings */
    JS_FreeCString(ctx, url);

    if (add_protocols(ctx, c, opts) < 0) {
        conn_free(c);
        return JS_EXCEPTION;
    }
    c->req_headers = curl_slist_append(c->req_headers, "User-Agent: maemo-react/" MR_VERSION);
    curl_easy_setopt(c->easy, CURLOPT_HTTPHEADER, c->req_headers);
    v = JS_GetPropertyStr(ctx, opts, "timeoutMs");
    if (JS_IsNumber(v))
        JS_ToFloat64(ctx, &timeout, v);
    JS_FreeValue(ctx, v);

    curl_easy_setopt(c->easy, CURLOPT_CONNECT_ONLY, 2L);
    /* The time limit covers the handshake only: curl is done after it. */
    curl_easy_setopt(c->easy, CURLOPT_TIMEOUT_MS, (long)(timeout > 0 ? timeout : 30000));
    curl_easy_setopt(c->easy, CURLOPT_CONNECTTIMEOUT_MS, 30000L);
    curl_easy_setopt(c->easy, CURLOPT_PROTOCOLS_STR, "ws,wss");
    curl_easy_setopt(c->easy, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(c->easy, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(c->easy, CURLOPT_ERRORBUFFER, c->error);
    curl_easy_setopt(c->easy, CURLOPT_HEADERFUNCTION, on_header);
    curl_easy_setopt(c->easy, CURLOPT_HEADERDATA, c);
    if (ca)
        curl_easy_setopt(c->easy, CURLOPT_CAINFO, ca);

    mr_curl_add(c->easy, &c->owner);
    return JS_NewInt32(ctx, c->id);
}

static Conn *arg_conn(JSContext *ctx, JSValueConst v)
{
    int32_t id;
    Conn *c;
    if (!JS_IsNumber(v) || JS_ToInt32(ctx, &id, v))
        return NULL;
    c = g_hash_table_lookup(conns, GINT_TO_POINTER(id));
    return (c && !c->dead) ? c : NULL;
}

static JSValue js_send(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    Conn *c = arg_conn(ctx, argv[0]);
    size_t len = 0;
    if (!c || c->state != OPEN)
        return JS_ThrowTypeError(ctx, "send: the connection is not open");
    if (JS_IsString(argv[1])) {
        const char *s = JS_ToCStringLen(ctx, &len, argv[1]);
        if (!s)
            return JS_EXCEPTION;
        enqueue(c, (const guint8 *)s, len, CURLWS_TEXT);
        JS_FreeCString(ctx, s);
    } else {
        uint8_t *buf = JS_GetArrayBuffer(ctx, &len, argv[1]); /* a TypeError if it is not one */
        if (!buf)
            return JS_EXCEPTION;
        enqueue(c, buf, len, JS_ToBool(ctx, argv[2]) ? CURLWS_BINARY : CURLWS_TEXT);
    }
    pump_send(c);
    return JS_UNDEFINED;
}

static JSValue js_close(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    Conn *c = arg_conn(ctx, argv[0]);
    int32_t code = 0;
    const char *reason = NULL;
    if (!c || c->state != OPEN)
        return JS_UNDEFINED; /* before open, the prelude uses abort */
    if (argc > 1 && JS_IsNumber(argv[1]))
        JS_ToInt32(ctx, &code, argv[1]);
    if (argc > 2 && JS_IsString(argv[2]))
        reason = JS_ToCString(ctx, argv[2]);
    c->state = CLOSING;
    send_close_frame(c, code, reason ? reason : "");
    if (reason)
        JS_FreeCString(ctx, reason);
    c->close_timer = g_timeout_add(CLOSE_WAIT_MS, on_close_timeout, GINT_TO_POINTER(c->id));
    pump_send(c);
    return JS_UNDEFINED;
}

static gboolean free_dead(gpointer data)
{
    Conn *c = g_hash_table_lookup(conns, data);
    if (c && c->dead)
        conn_free(c);
    return FALSE;
}

static JSValue js_abort(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    Conn *c = arg_conn(ctx, argv[0]);
    if (!c)
        return JS_UNDEFINED;
    c->dead = TRUE;
    drop_pending(c);
    if (in_emit)
        g_idle_add(free_dead, GINT_TO_POINTER(c->id));
    else
        conn_free(c);
    return JS_UNDEFINED;
}

static JSValue js_buffered(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    Conn *c = arg_conn(ctx, argv[0]);
    return JS_NewInt64(ctx, c ? (int64_t)c->buffered : 0);
}

static const JSCFunctionListEntry ws_funcs[] = {
    JS_CFUNC_DEF("open", 2, js_open),
    JS_CFUNC_DEF("send", 3, js_send),
    JS_CFUNC_DEF("close", 3, js_close),
    JS_CFUNC_DEF("abort", 1, js_abort),
    JS_CFUNC_DEF("bufferedAmount", 1, js_buffered),
};

static int ws_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, ws_funcs, G_N_ELEMENTS(ws_funcs));
}

JSModuleDef *mr_init_ws(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, ws_init);
    if (!m)
        return NULL;
    if (!conns)
        conns = g_hash_table_new(g_direct_hash, g_direct_equal);
    JS_AddModuleExportList(ctx, m, ws_funcs, G_N_ELEMENTS(ws_funcs));
    return m;
}
```

In `maemo-react/runtime/src/mr.h`, add after the `http.c` block:

```c
/* ws.c */
JSModuleDef *mr_init_ws(JSContext *ctx, const char *name);
```

In `maemo-react/runtime/src/main.c`, in `register_modules`, add after the `maemo:http` line:

```c
    mr_register_module("maemo:ws", mr_init_ws);
```

- [ ] **Step 5: Run the tests on both targets**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo' > /tmp/m3a-t2.log 2>&1; grep -n 'PASS\|FAIL\|not ok' /tmp/m3a-t2.log
```

Expected: every line is `PASS` on both targets, including `test/ws.test.js`. The `ws.test.js` run takes about 20 s because of the time-based tests. If "a server that does not answer our close frame" fails under qemu-user because the measured time is above 7.5 s, raise the upper bound of that test to 10 s and say so in the commit message: qemu-user is slow, the limit is not. If "curl answers a ping by itself" gives `pong missing`, curl's auto-pong did not run: set `CURLOPT_WS_OPTIONS` to `0L` explicitly in `js_open` and run again; if it still fails, read `/work/build/curl-8.22.0/lib/ws.c` around `auto_pong` and report the finding before you change the design.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/runtime/src/ws.c maemo-react/runtime/src/mr.h maemo-react/runtime/src/main.c maemo-react/runtime/test/server/wsproto.py maemo-react/runtime/test/server/wsserver.py maemo-react/runtime/test/run.sh maemo-react/runtime/test/ws.test.js
git commit -m "Add maemo:ws on libcurl's WebSocket API, with a stdlib test server"
```

---

### Task 3: The WebSocket global in the prelude, and its types

**Files:**
- Create: `maemo-react/prelude/src/websocket.js`
- Modify: `maemo-react/prelude/src/index.js`
- Create: `maemo-react/prelude/test/websocket.test.js`
- Create: `maemo-react/runtime/test/websocket.test.js`
- Modify: `maemo-react/packages/types/globals.d.ts`, `maemo-react/packages/types/modules.d.ts`, `maemo-react/packages/types/test/check.tsx`
- Modify: `maemo-react/README.md`

**Interfaces:**
- Consumes: `maemo:ws` (Task 2); `Event`, `EventTarget`, `DOMException` (events.js); `URL` (url.js); `TextEncoder` (encoding.js).
- Produces the globals `WebSocket`, `CloseEvent` and `MessageEvent` with the WHATWG shape: `new WebSocket(url, protocols?)`; `url`, `readyState` (`CONNECTING` 0, `OPEN` 1, `CLOSING` 2, `CLOSED` 3, on the class and on the instances), `protocol`, `extensions` (always `''`), `bufferedAmount`, `binaryType` (`'arraybuffer'` only; there is no `Blob`); `onopen`, `onmessage`, `onerror`, `onclose` and `addEventListener`; `send(string | ArrayBuffer | ArrayBufferView)`; `close(code?, reason?)`. A text message gives a string in `event.data`, a binary message an `ArrayBuffer`. The `error` event has a `message` property with the curl text (a maemo-react extension). `createWebSocket(ws)` takes the native module, so the tests can give a fake one. HA Remote (M3b) uses these globals.

- [ ] **Step 1: Write the failing prelude tests**

Create `maemo-react/prelude/test/websocket.test.js`:

```js
import { describe, expect, test } from 'vitest';
import { CloseEvent, MessageEvent, createWebSocket } from '../src/websocket.js';

// A fake maemo:ws. The test sends the events itself.
function fakeWs() {
  const ws = {
    calls: [],
    sent: [],
    closed: [],
    aborted: [],
    buffered: 0,
    open(opts, cb) {
      ws.calls.push({ opts, cb });
      return ws.calls.length;
    },
    send(id, data, binary) {
      ws.sent.push({ id, data, binary });
    },
    close(id, code, reason) {
      ws.closed.push({ id, code, reason });
    },
    abort(id) {
      ws.aborted.push(id);
    },
    bufferedAmount() {
      return ws.buffered;
    },
  };
  return ws;
}

function setup(url = 'wss://e.com/api/websocket', protocols) {
  const ws = fakeWs();
  const WebSocket = createWebSocket(ws);
  const s = new WebSocket(url, protocols);
  const events = [];
  for (const type of ['open', 'message', 'error', 'close']) s.addEventListener(type, (e) => events.push(e));
  const cb = ws.calls[0].cb;
  return { ws, WebSocket, s, events, cb, open: (protocol = '') => cb({ type: 'open', protocol }) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WebSocket', () => {
  test('the constructor opens the connection with the URL and the protocols', () => {
    const { ws, s } = setup('wss://e.com/api/websocket', ['a', 'b']);
    expect(ws.calls[0].opts).toEqual({ url: 'wss://e.com/api/websocket', protocols: ['a', 'b'] });
    expect([s.readyState, s.url, s.protocol, s.extensions, s.bufferedAmount]).toEqual([0, 'wss://e.com/api/websocket', '', '', 0]);
  });

  test('a string protocol is one protocol', () => {
    const { ws } = setup('ws://e.com/', 'one');
    expect(ws.calls[0].opts.protocols).toEqual(['one']);
  });

  test('an http or https URL becomes ws or wss', () => {
    expect(setup('http://h:8123/api/websocket').s.url).toBe('ws://h:8123/api/websocket');
    expect(setup('https://h/api/websocket').s.url).toBe('wss://h/api/websocket');
  });

  test('bad URLs and protocols throw SyntaxError', () => {
    const WebSocket = createWebSocket(fakeWs());
    for (const url of ['ftp://e.com/', 'not a url', 'ws://e.com/#frag']) {
      expect(() => new WebSocket(url)).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    }
    expect(() => new WebSocket('ws://e.com/', 'a b')).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(() => new WebSocket('ws://e.com/', ['a', 'A'])).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
  });

  test('open sets OPEN and the protocol, and fires onopen and the listeners', () => {
    const { s, events, open } = setup('wss://e.com/', ['a']);
    let n = 0;
    s.onopen = () => n++;
    open('a');
    expect([s.readyState, s.protocol, n, events.map((e) => e.type)]).toEqual([1, 'a', 1, ['open']]);
  });

  test('a protocol that the client did not request fails the connection', () => {
    const { ws, s, events, open } = setup('wss://e.com/', ['a']);
    open('zzz');
    expect(ws.aborted).toEqual([1]);
    expect(events.map((e) => e.type)).toEqual(['error', 'close']);
    expect([events[1].code, events[1].wasClean, s.readyState]).toEqual([1006, false, 3]);
  });

  test('send before open throws InvalidStateError', () => {
    const { s } = setup();
    expect(() => s.send('x')).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  test('send encodes strings, ArrayBuffers, views and other values', () => {
    const { ws, s, open } = setup();
    open();
    s.send('hi');
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer;
    s.send(buf);
    s.send(new Uint8Array(buf, 2, 3));
    s.send(42);
    expect(ws.sent[0]).toEqual({ id: 1, data: 'hi', binary: false });
    expect(ws.sent[1].binary).toBe(true);
    expect(ws.sent[1].data.byteLength).toBe(10);
    expect(ws.sent[3]).toEqual({ id: 1, data: '42', binary: false });
  });

  test('send of a view sends only the bytes of the view', () => {
    const { ws, s, open } = setup();
    open();
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer;
    s.send(new Uint8Array(buf, 2, 3));
    expect(ws.sent[0].binary).toBe(true);
    expect(Array.from(new Uint8Array(ws.sent[0].data))).toEqual([3, 4, 5]);
  });

  test('messages arrive as MessageEvent with data and origin', () => {
    const { s, cb, events, open } = setup('wss://e.com:8443/api');
    open();
    let seen = null;
    s.onmessage = (e) => (seen = e);
    cb({ type: 'message', data: 'text' });
    const bin = new Uint8Array([7]).buffer;
    cb({ type: 'message', data: bin });
    expect(seen).toBeInstanceOf(MessageEvent);
    expect(events.map((e) => e.data)).toEqual(['text', bin]);
    expect(events[0].origin).toBe('wss://e.com:8443');
  });

  test('close validates the code and the reason', () => {
    const { ws, s, open } = setup();
    open();
    expect(() => s.close(1001)).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    expect(() => s.close(1000, 'x'.repeat(124))).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    s.close(3000, 'ok');
    expect(ws.closed).toEqual([{ id: 1, code: 3000, reason: 'ok' }]);
    expect(s.readyState).toBe(2);
    s.close();
    expect(ws.closed).toHaveLength(1);
  });

  test('close without a code sends 0 and no reason', () => {
    const { ws, s, open } = setup();
    open();
    s.close();
    expect(ws.closed).toEqual([{ id: 1, code: 0, reason: '' }]);
  });

  test('close before open aborts, then fires error and close 1006', async () => {
    const { ws, s, events } = setup();
    s.close();
    expect([ws.aborted, s.readyState]).toEqual([[1], 2]);
    await tick();
    expect(events.map((e) => e.type)).toEqual(['error', 'close']);
    expect(events[1]).toBeInstanceOf(CloseEvent);
    expect([events[1].code, events[1].wasClean, events[1].reason, s.readyState]).toEqual([1006, false, '', 3]);
  });

  test('no message after close()', () => {
    const { s, cb, events, open } = setup();
    open();
    s.close();
    cb({ type: 'message', data: 'late' });
    expect(events.map((e) => e.type)).toEqual(['open']);
  });

  test('the close event carries code, reason and wasClean; a second one is ignored', () => {
    const { s, cb, events, open } = setup();
    open();
    cb({ type: 'close', code: 4000, reason: 'bye', wasClean: true });
    cb({ type: 'close', code: 1006, reason: '', wasClean: false });
    expect(events.map((e) => e.type)).toEqual(['open', 'close']);
    expect([events[1].code, events[1].reason, events[1].wasClean, s.readyState]).toEqual([4000, 'bye', true, 3]);
  });

  test('an error event has the curl message, then close 1006', () => {
    const { s, cb, events } = setup();
    let seen = null;
    s.onerror = (e) => (seen = e);
    cb({ type: 'error', message: 'Could not resolve host: e.com' });
    cb({ type: 'close', code: 1006, reason: '', wasClean: false });
    expect(seen.message).toMatch(/resolve/);
    expect([events.map((e) => e.type), s.readyState]).toEqual([['error', 'close'], 3]);
  });

  test('send after close is dropped without an error', () => {
    const { ws, s, open } = setup();
    open();
    s.close();
    s.send('x');
    expect(ws.sent).toEqual([]);
  });

  test('binaryType is arraybuffer only', () => {
    const { s } = setup();
    expect(s.binaryType).toBe('arraybuffer');
    expect(() => (s.binaryType = 'blob')).toThrow(TypeError);
  });

  test('bufferedAmount reads the module while the connection is open', () => {
    const { ws, s, open } = setup();
    ws.buffered = 5;
    expect(s.bufferedAmount).toBe(0);
    open();
    expect(s.bufferedAmount).toBe(5);
  });

  test('the constants are on the class and on the instances', () => {
    const { WebSocket, s } = setup();
    expect([WebSocket.CONNECTING, WebSocket.OPEN, WebSocket.CLOSING, WebSocket.CLOSED]).toEqual([0, 1, 2, 3]);
    expect([s.CONNECTING, s.OPEN, s.CLOSING, s.CLOSED]).toEqual([0, 1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run prelude/test/websocket.test.js
```

Expected: the file fails to load: `Cannot find module '../src/websocket.js'`.

- [ ] **Step 3: Write websocket.js and add the globals**

Create `maemo-react/prelude/src/websocket.js`:

```js
// WebSocket, CloseEvent and MessageEvent on top of the native maemo:ws
// module (curl). createWebSocket takes that module as an argument, so the
// tests can give a fake one.
import { TextEncoder } from './encoding.js';
import { DOMException, Event, EventTarget } from './events.js';
import { URL } from './url.js';

export class CloseEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.wasClean = Boolean(init.wasClean);
    this.code = init.code === undefined ? 0 : Number(init.code);
    this.reason = init.reason === undefined ? '' : String(init.reason);
  }
}

export class MessageEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.data = init.data === undefined ? null : init.data;
    this.origin = init.origin === undefined ? '' : String(init.origin);
    this.lastEventId = '';
    this.source = null;
    this.ports = [];
  }
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const encoder = new TextEncoder();

function syntaxError(message) {
  return new DOMException('WebSocket: ' + message, 'SyntaxError');
}

/** The href of the URL, with http and https turned into ws and wss. */
function parseUrl(input) {
  let u;
  try {
    u = new URL(String(input));
  } catch (e) {
    throw syntaxError('invalid URL: ' + String(input));
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    u = new URL((u.protocol === 'http:' ? 'ws:' : 'wss:') + u.href.slice(u.protocol.length));
  }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw syntaxError('only ws and wss URLs are supported, not ' + u.protocol);
  if (u.hash) throw syntaxError('the URL must not have a fragment');
  return u.href;
}

function parseProtocols(protocols) {
  if (protocols === undefined) return [];
  const list = typeof protocols === 'string' ? [protocols] : Array.from(protocols, String);
  const seen = new Set();
  for (const p of list) {
    if (!TOKEN.test(p)) throw syntaxError('invalid protocol: ' + p);
    const k = p.toLowerCase();
    if (seen.has(k)) throw syntaxError('duplicate protocol: ' + p);
    seen.add(k);
  }
  return list;
}

function originOf(href) {
  const u = new URL(href);
  return u.protocol + '//' + u.host;
}

export function createWebSocket(ws) {
  class WebSocket extends EventTarget {
    #id;
    #state = CONNECTING;
    #url;
    #protocols;
    #protocol = '';
    #binaryType = 'arraybuffer';

    constructor(url, protocols) {
      super();
      this.#url = parseUrl(url);
      this.#protocols = parseProtocols(protocols);
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.#id = ws.open({ url: this.#url, protocols: this.#protocols }, (ev) => this.#onEvent(ev));
    }

    get url() {
      return this.#url;
    }

    get readyState() {
      return this.#state;
    }

    get protocol() {
      return this.#protocol;
    }

    get extensions() {
      return '';
    }

    get bufferedAmount() {
      return this.#state === OPEN || this.#state === CLOSING ? ws.bufferedAmount(this.#id) : 0;
    }

    get binaryType() {
      return this.#binaryType;
    }

    set binaryType(value) {
      if (value !== 'arraybuffer') throw new TypeError("WebSocket: binaryType supports only 'arraybuffer'; the tablet has no Blob");
      this.#binaryType = value;
    }

    send(data) {
      if (this.#state === CONNECTING) throw new DOMException('WebSocket: the connection is not open yet', 'InvalidStateError');
      if (this.#state !== OPEN) return; // closing or closed: browsers drop the data too
      if (typeof data === 'string') ws.send(this.#id, data, false);
      else if (data instanceof ArrayBuffer) ws.send(this.#id, data, true);
      else if (ArrayBuffer.isView(data)) ws.send(this.#id, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), true);
      else ws.send(this.#id, String(data), false);
    }

    close(code, reason) {
      if (code !== undefined) {
        code = Number(code);
        if (code !== 1000 && !(code >= 3000 && code <= 4999)) {
          throw new DOMException('WebSocket: the close code must be 1000 or 3000 to 4999', 'InvalidAccessError');
        }
      }
      if (reason !== undefined) {
        reason = String(reason);
        if (encoder.encode(reason).length > 123) throw syntaxError('the close reason is longer than 123 bytes');
      }
      if (this.#state === CLOSING || this.#state === CLOSED) return;
      if (this.#state === CONNECTING) {
        // The standard: fail the connection. The module gives no more events after abort.
        this.#state = CLOSING;
        ws.abort(this.#id);
        queueMicrotask(() => this.#fail());
        return;
      }
      this.#state = CLOSING;
      ws.close(this.#id, code === undefined ? 0 : code, reason === undefined ? '' : reason);
    }

    #fail() {
      if (this.#state === CLOSED) return;
      this.#state = CLOSED;
      this.dispatchEvent(new Event('error'));
      this.dispatchEvent(new CloseEvent('close', { wasClean: false, code: 1006, reason: '' }));
    }

    #onEvent(ev) {
      if (ev.type === 'open') {
        if (this.#state !== CONNECTING) return;
        if (ev.protocol && !this.#protocols.includes(ev.protocol)) {
          ws.abort(this.#id);
          this.#fail();
          return;
        }
        this.#protocol = ev.protocol || '';
        this.#state = OPEN;
        this.dispatchEvent(new Event('open'));
      } else if (ev.type === 'message') {
        if (this.#state !== OPEN) return;
        this.dispatchEvent(new MessageEvent('message', { data: ev.data, origin: originOf(this.#url) }));
      } else if (ev.type === 'error') {
        if (this.#state === CLOSED) return;
        const e = new Event('error');
        e.message = ev.message;
        this.dispatchEvent(e);
      } else if (ev.type === 'close') {
        if (this.#state === CLOSED) return;
        this.#state = CLOSED;
        this.dispatchEvent(new CloseEvent('close', { wasClean: ev.wasClean, code: ev.code, reason: ev.reason }));
      }
    }
  }

  for (const [name, value] of Object.entries({ CONNECTING, OPEN, CLOSING, CLOSED })) {
    Object.defineProperty(WebSocket, name, { value, enumerable: true });
    Object.defineProperty(WebSocket.prototype, name, { value, enumerable: true });
  }
  return WebSocket;
}
```

In `maemo-react/prelude/src/index.js`, add the imports:

```js
import * as ws from 'maemo:ws';
import { CloseEvent, MessageEvent, createWebSocket } from './websocket.js';
```

and after `define('fetch', createFetch(http));`:

```js
define('WebSocket', createWebSocket(ws));
define('CloseEvent', CloseEvent);
define('MessageEvent', MessageEvent);
```

Check that `prelude/src/url.js` treats `ws:` and `wss:` as special schemes with the default ports 80 and 443 (the WHATWG list). If it does not, `new URL('ws://h:80/')` keeps `:80` in `href`; add the two schemes to the special-scheme table of `url.js` with their ports, and add a line to `prelude/test/url.test.js` that expects `new URL('ws://h:80/x').href` to be `'ws://h/x'`.

- [ ] **Step 4: Run the prelude tests**

```bash
npx vitest run prelude/test/websocket.test.js prelude/test/url.test.js
```

Expected: every test passes.

- [ ] **Step 5: Write the runtime test of the global, and run it on both targets**

Create `maemo-react/runtime/test/websocket.test.js`:

```js
import { test, assert, assertEqual, assertThrows, run } from './harness.js';

const WSS = 'wss://localhost:8444';

// Open a socket and collect its events until close.
function watch(url, protocols) {
  const s = new WebSocket(url, protocols);
  const r = { s, types: [], messages: [] };
  r.done = new Promise((resolve) => {
    s.onopen = () => r.types.push('open');
    s.onmessage = (e) => {
      r.types.push('message');
      r.messages.push(e.data);
    };
    s.onerror = (e) => {
      r.types.push('error');
      r.error = e;
    };
    s.onclose = (e) => {
      r.types.push('close');
      r.close = e;
      resolve(r);
    };
  });
  r.opened = new Promise((resolve) => {
    s.addEventListener('open', () => resolve(r));
    s.addEventListener('close', () => resolve(r));
  });
  return r;
}

test('echo over the WebSocket global, and a clean close', async () => {
  const r = watch(WSS + '/echo', ['ha']);
  assertEqual(r.s.readyState, WebSocket.CONNECTING);
  await r.opened;
  assertEqual([r.s.readyState, r.s.protocol, r.s.url], [WebSocket.OPEN, 'ha', WSS + '/echo']);
  r.s.send('hello');
  r.s.send(new Uint8Array([1, 2, 3, 4]).subarray(1, 3));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assertEqual(r.messages[0], 'hello');
  assert(r.messages[1] instanceof ArrayBuffer, 'binary gives an ArrayBuffer');
  assertEqual(Array.from(new Uint8Array(r.messages[1])), [2, 3]);
  r.s.close(1000, 'done');
  assertEqual(r.s.readyState, WebSocket.CLOSING);
  await r.done;
  assertEqual([r.close.code, r.close.reason, r.close.wasClean, r.s.readyState], [1000, 'done', true, WebSocket.CLOSED]);
  assert(r.close instanceof CloseEvent, 'a CloseEvent');
});

test('an https URL becomes wss', async () => {
  const r = watch('https://localhost:8444/echo');
  assertEqual(r.s.url, WSS + '/echo');
  await r.opened;
  r.s.close();
  await r.done;
  assertEqual(r.close.wasClean, true);
});

test('close before open gives error and close 1006, and no server events', async () => {
  const r = watch(WSS + '/echo');
  r.s.close();
  await r.done;
  assertEqual(r.types, ['error', 'close']);
  assertEqual([r.close.code, r.close.wasClean], [1006, false]);
});

test('a refused handshake gives error with a message, then close', async () => {
  const r = watch(WSS + '/reject');
  await r.done;
  assertEqual(r.types, ['error', 'close']);
  assert(String(r.error.message).includes('403'), String(r.error.message));
});

test('a protocol that the client did not ask for fails the connection', async () => {
  const r = watch(WSS + '/badproto', ['ha']);
  await r.done;
  assertEqual(r.types, ['error', 'close']);
  assertEqual(r.s.readyState, WebSocket.CLOSED);
});

test('send before open throws InvalidStateError', () => {
  const s = new WebSocket(WSS + '/echo');
  assertThrows(() => s.send('x'), /InvalidStateError/);
  s.close();
});

await run();
```

Run on both targets:

```bash
npm run build:prelude
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop test/websocket.test.js test/prelude.test.js && runtime/test/run.sh diablo test/websocket.test.js test/prelude.test.js' > /tmp/m3a-t3.log 2>&1; grep -n 'PASS\|FAIL\|not ok' /tmp/m3a-t3.log
```

Expected: `PASS test/websocket.test.js` and `PASS test/prelude.test.js` on both targets. The Makefile copies `prelude/dist/prelude.js` into the build, so the prelude build must run first.

- [ ] **Step 6: The types**

In `maemo-react/packages/types/globals.d.ts`, add before the closing `}` of `declare global`:

```ts
  class CloseEvent extends Event {
    constructor(type: string, init?: { wasClean?: boolean; code?: number; reason?: string });
    readonly wasClean: boolean;
    readonly code: number;
    readonly reason: string;
  }

  class MessageEvent<T = unknown> extends Event {
    constructor(type: string, init?: { data?: T; origin?: string });
    readonly data: T;
    readonly origin: string;
    readonly lastEventId: string;
  }

  /** The error event of a WebSocket. message is a maemo-react extension: the curl error text. */
  interface WebSocketErrorEvent extends Event {
    readonly message?: string;
  }

  /**
   * A WebSocket on libcurl. ws and wss only (an http or https URL is
   * converted). A text message gives a string, a binary message an
   * ArrayBuffer. TLS checks the certificate against the n810-modern CA store.
   */
  class WebSocket extends EventTarget {
    constructor(url: string | URL, protocols?: string | string[]);
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;
    readonly CONNECTING: 0;
    readonly OPEN: 1;
    readonly CLOSING: 2;
    readonly CLOSED: 3;
    readonly url: string;
    readonly readyState: 0 | 1 | 2 | 3;
    readonly protocol: string;
    readonly extensions: string;
    readonly bufferedAmount: number;
    /** Only 'arraybuffer': the tablet has no Blob. */
    binaryType: 'arraybuffer';
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent<string | ArrayBuffer>) => void) | null;
    onerror: ((event: WebSocketErrorEvent) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    send(data: string | ArrayBuffer | ArrayBufferView): void;
    /** code: 1000 or 3000 to 4999. reason: at most 123 bytes of UTF-8. */
    close(code?: number, reason?: string): void;
  }
```

In `maemo-react/packages/types/modules.d.ts`, add after the `maemo:http` module:

```ts
declare module 'maemo:ws' {
  export interface OpenOptions {
    /** A ws or wss URL. */
    url: string;
    /** Sec-WebSocket-Protocol. */
    protocols?: string[];
    /** The handshake limit. Default 30000. */
    timeoutMs?: number;
  }
  export type WsEvent =
    | { type: 'open'; protocol: string }
    | { type: 'message'; data: string | ArrayBuffer }
    | { type: 'error'; message: string }
    | { type: 'close'; code: number; reason: string; wasClean: boolean };
  export function open(options: OpenOptions, onEvent: (event: WsEvent) => void): number;
  /** Throws a TypeError when the connection is not open. */
  export function send(id: number, data: string | ArrayBuffer, binary: boolean): void;
  /** code 0 sends a close frame without a payload. */
  export function close(id: number, code: number, reason: string): void;
  /** Drop the connection. No more events. */
  export function abort(id: number): void;
  export function bufferedAmount(id: number): number;
}
```

In `maemo-react/packages/types/test/check.tsx`, add after the `request({ url: u.href }, ...)` call:

```tsx
const sock = new WebSocket('wss://example.com/api/websocket', ['ha']);
sock.onmessage = (e) => console.log(typeof e.data === 'string' ? e.data : e.data.byteLength);
sock.onclose = (e) => console.log(e.code, e.reason, e.wasClean);
sock.addEventListener('open', () => sock.send(JSON.stringify({ type: 'auth' })));
sock.send(new Uint8Array(2));
sock.close(1000, 'bye');
// @ts-expect-error: there is no Blob on the tablet
sock.binaryType = 'blob';
```

Run `npm run typecheck`. Expected: no output.

- [ ] **Step 7: The README**

In `maemo-react/README.md`, add a section before "## Make an application":

```
## Web globals

The prelude gives `fetch`, `Headers`, `Request`, `Response`, `URL`,
`URLSearchParams`, `TextEncoder`, `TextDecoder`, `AbortController`,
`WebSocket` (`ws` and `wss`; `binaryType` is `'arraybuffer'` only) and
`localStorage` (a JSON file in `/home/user/.maemo-react/<app-id>/`, mode
0600, written during idle time). `packages/types/globals.d.ts` lists the exact
shape. TLS always checks the certificate against the n810-modern CA store.
```

- [ ] **Step 8: Commit**

```bash
git add maemo-react/prelude/src/websocket.js maemo-react/prelude/src/index.js maemo-react/prelude/src/url.js maemo-react/prelude/test/websocket.test.js maemo-react/prelude/test/url.test.js maemo-react/runtime/test/websocket.test.js maemo-react/packages/types/globals.d.ts maemo-react/packages/types/modules.d.ts maemo-react/packages/types/test/check.tsx maemo-react/README.md
git commit -m "Add the WebSocket global to the prelude, with its types"
```

---

### Task 4: localStorage on a JSON file in the application data folder

**Files:**
- Modify: `maemo-react/runtime/src/app.c` (`mr_app_id`, `mr_app_data_dir`, the exports `id` and `dataDir`)
- Create: `maemo-react/runtime/src/storage.c`
- Modify: `maemo-react/runtime/src/mr.h` (`MR_APPS_DIR`, the `app.c` and `storage.c` blocks)
- Modify: `maemo-react/runtime/src/main.c` (`register_modules`; the flush after `gtk_main`)
- Modify: `maemo-react/runtime/test/run.sh` (`MR_DATA_DIR`)
- Create: `maemo-react/prelude/src/storage.js`; modify `maemo-react/prelude/src/index.js`
- Create: `maemo-react/prelude/test/storage.test.js`
- Create: `maemo-react/runtime/test/storage.test.js`, `maemo-react/runtime/test/storage.sh`, `maemo-react/runtime/test/storage/{write,read,empty}.js`
- Modify: `maemo-react/packages/types/globals.d.ts`, `maemo-react/packages/types/modules.d.ts`, `maemo-react/packages/types/test/check.tsx`

**Interfaces:**
- Consumes: `mr_call` (loop.c), `mr_app_set_args` (app.c), `DOMException` (events.js).
- Produces:
  - `const char *mr_app_id(void)` (app.c): `$MR_APP_ID` when set; else the `<id>` of a module at `/opt/n810-modern/share/maemo-react/apps/<id>/app.js`; else the base name of the module file without `.js` or `.mjs`. The desktop dev host runs a path, so a desktop run sets `MR_APP_ID` by hand (the M3b plan does).
  - `gchar *mr_app_data_dir(void)` (app.c): `$MR_DATA_DIR/<id>` when `MR_DATA_DIR` is set (the tests), else `<home>/.maemo-react/<id>` (`/home/user/.maemo-react/<id>` on the tablet, spec section 7). The caller frees it. `maemo:fs` (M4) gives the same value as `appDataDir`.
  - `maemo:app` exports `id: string` and `dataDir: string`.
  - The native module `maemo:storage`: `load(): string | null` (the text of `<dataDir>/localStorage.json`, or `null` when there is none; repairs the mode to `0600`); `schedule(fn)` (calls `fn` during idle time, at `G_PRIORITY_LOW`, after the paint, and writes its result to the file with a temporary file and `rename`; one pending function at a time, the last one wins); `markBad()` (renames the file to `localStorage.json.bad`); `flush()` (writes now); `path(): string`. `void mr_storage_flush(void)` runs at exit.
  - The global `localStorage` with `length`, `key(n)`, `getItem`, `setItem`, `removeItem`, `clear`. The file is a JSON object of string values. A corrupt file is kept as `.bad` and the storage starts empty. The keys and values together are at most 1,048,576 characters; `setItem` above that throws a `DOMException` `QuotaExceededError`. The global is made on first use, so an application that does not use it reads no file.

- [ ] **Step 1: Write the failing prelude tests**

Create `maemo-react/prelude/test/storage.test.js`:

```js
import { describe, expect, test } from 'vitest';
import { LIMIT, createStorage } from '../src/storage.js';

// A fake maemo:storage. `saves` holds the functions that schedule() got.
function fakeBackend(text = null) {
  const b = {
    saves: [],
    bad: 0,
    load: () => text,
    schedule(fn) {
      b.saves.push(fn);
    },
    markBad() {
      b.bad++;
    },
  };
  return b;
}

const last = (b) => b.saves[b.saves.length - 1]();

describe('localStorage', () => {
  test('starts empty without a file', () => {
    const s = createStorage(fakeBackend());
    expect([s.length, s.getItem('x'), s.key(0)]).toEqual([0, null, null]);
  });

  test('loads the file', () => {
    const s = createStorage(fakeBackend('{"a":"1","b":"2"}'));
    expect([s.length, s.key(0), s.key(1), s.getItem('b')]).toEqual([2, 'a', 'b', '2']);
  });

  test('setItem, removeItem and clear schedule one write each, with the JSON', () => {
    const b = fakeBackend();
    const s = createStorage(b);
    s.setItem('k', 'v');
    expect(b.saves).toHaveLength(1);
    expect(last(b)).toBe('{"k":"v"}');
    s.setItem('k', 'v');
    expect(b.saves).toHaveLength(1);
    s.removeItem('k');
    expect(last(b)).toBe('{}');
    s.removeItem('k');
    s.clear();
    expect(b.saves).toHaveLength(2);
    s.setItem('a', '1');
    s.clear();
    expect([b.saves.length, last(b), s.length]).toEqual([4, '{}', 0]);
  });

  test('values become strings and a missing key is null', () => {
    const s = createStorage(fakeBackend());
    s.setItem('n', 42);
    s.setItem('o', { a: 1 });
    s.setItem(7, 'seven');
    expect([s.getItem('n'), s.getItem('o'), s.getItem('7'), s.getItem('missing'), s.key(9)]).toEqual(['42', '[object Object]', 'seven', null, null]);
  });

  test('a corrupt file is kept as .bad and the storage starts empty', () => {
    for (const text of ['not json', '[1]', '{"a":1}', 'null']) {
      const b = fakeBackend(text);
      const s = createStorage(b);
      expect([b.bad, s.length]).toEqual([1, 0]);
    }
  });

  test('the limit counts the keys and the values together', () => {
    const b = fakeBackend();
    const s = createStorage(b);
    expect(() => s.setItem('big', 'x'.repeat(LIMIT))).toThrow(expect.objectContaining({ name: 'QuotaExceededError' }));
    s.setItem('big', 'x'.repeat(LIMIT - 3));
    expect(() => s.setItem('more', 'y')).toThrow(expect.objectContaining({ name: 'QuotaExceededError' }));
    s.setItem('big', 'short');
    s.setItem('more', 'y');
    expect(s.length).toBe(2);
  });

  test('length and key follow the insertion order', () => {
    const s = createStorage(fakeBackend());
    s.setItem('b', '1');
    s.setItem('a', '2');
    s.setItem('b', '3');
    expect([s.length, s.key(0), s.key(1), s.key(2), s.key(-1), s.key('x')]).toEqual([2, 'b', 'a', null, null, null]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run prelude/test/storage.test.js
```

Expected: the file fails to load: `Cannot find module '../src/storage.js'`.

- [ ] **Step 3: Write storage.js and the lazy global**

Create `maemo-react/prelude/src/storage.js`:

```js
// localStorage on top of the native maemo:storage module. The items live in
// memory; the module writes the JSON file during idle time after a change.
// createStorage takes the module as an argument, so the tests can give a
// fake one.
import { DOMException } from './events.js';

/** The limit on the characters of all keys and values together. */
export const LIMIT = 1024 * 1024;

function parse(text) {
  const obj = JSON.parse(text);
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new TypeError('not an object');
  const map = new Map();
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] !== 'string') throw new TypeError('the value of ' + k + ' is not a string');
    map.set(k, obj[k]);
  }
  return map;
}

export function createStorage(backend) {
  let map = new Map();
  let size = 0;
  const text = backend.load();
  if (text !== null) {
    try {
      map = parse(text);
      for (const [k, v] of map) size += k.length + v.length;
    } catch (e) {
      console.error('localStorage: the file is not valid; it is kept as localStorage.json.bad:', e instanceof Error ? e.message : e);
      backend.markBad();
      map = new Map();
      size = 0;
    }
  }
  const save = () => backend.schedule(() => JSON.stringify(Object.fromEntries(map)));

  class Storage {
    get length() {
      return map.size;
    }

    key(n) {
      n = Math.floor(Number(n));
      if (!(n >= 0) || n >= map.size) return null;
      let i = 0;
      for (const k of map.keys()) if (i++ === n) return k;
      return null;
    }

    getItem(key) {
      key = String(key);
      return map.has(key) ? map.get(key) : null;
    }

    setItem(key, value) {
      key = String(key);
      value = String(value);
      const old = map.get(key);
      const next = size - (old === undefined ? 0 : key.length + old.length) + key.length + value.length;
      if (next > LIMIT) throw new DOMException('localStorage: the limit of ' + LIMIT + ' characters is reached', 'QuotaExceededError');
      if (old === value) return;
      map.set(key, value);
      size = next;
      save();
    }

    removeItem(key) {
      key = String(key);
      const old = map.get(key);
      if (old === undefined) return;
      size -= key.length + old.length;
      map.delete(key);
      save();
    }

    clear() {
      if (map.size === 0) return;
      map = new Map();
      size = 0;
      save();
    }
  }
  return new Storage();
}
```

In `maemo-react/prelude/src/index.js`, add the imports:

```js
import * as storage from 'maemo:storage';
import { createStorage } from './storage.js';
```

and at the end of the file:

```js
// localStorage reads its file on the first use, so an application that does
// not use it pays nothing.
let localStorage = null;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  enumerable: false,
  get() {
    if (!localStorage) localStorage = createStorage(storage);
    return localStorage;
  },
});
```

Run `npx vitest run prelude/test/storage.test.js`. Expected: every test passes.

- [ ] **Step 4: Write the runtime tests**

Create `maemo-react/runtime/test/storage.test.js`:

```js
import { test, assert, assertEqual, assertThrows, run } from './harness.js';
import { flush, load, path } from 'maemo:storage';
import { dataDir, id } from 'maemo:app';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the id comes from the module name, and the data dir from MR_DATA_DIR', () => {
  assertEqual(id, 'storage.test');
  assert(dataDir.endsWith('/storage.test'), dataDir);
  assert(path().startsWith(dataDir + '/'), path());
});

test('setItem reaches the file after a flush, and the file is JSON', () => {
  localStorage.clear();
  localStorage.setItem('ha.server', 'http://h:8123');
  localStorage.setItem('n', 1);
  assertEqual([localStorage.length, localStorage.getItem('n'), localStorage.key(0)], [2, '1', 'ha.server']);
  flush();
  assertEqual(JSON.parse(load()), { 'ha.server': 'http://h:8123', n: '1' });
});

test('the write happens during idle time without a flush', async () => {
  localStorage.setItem('idle', 'yes');
  await sleep(200);
  assertEqual(JSON.parse(load()).idle, 'yes');
});

test('removeItem and clear reach the file', () => {
  localStorage.removeItem('idle');
  flush();
  assertEqual(JSON.parse(load()).idle, undefined);
  localStorage.clear();
  flush();
  assertEqual(load(), '{}');
});

test('the quota', () => {
  assertThrows(() => localStorage.setItem('big', 'x'.repeat(1024 * 1024)), /QuotaExceededError/);
  assertEqual(localStorage.length, 0);
});

await run();
```

Create `maemo-react/runtime/test/storage/write.js`:

```js
// storage.sh, run 1: write two items. The host writes the file at exit.
import { quit } from 'maemo:app';

localStorage.setItem('token', 'secret');
localStorage.setItem('count', '1');
console.log('written');
quit(0);
```

Create `maemo-react/runtime/test/storage/read.js`:

```js
// storage.sh, runs 2 and 4: the items of write.js are there.
import { quit } from 'maemo:app';

if (localStorage.getItem('token') !== 'secret' || localStorage.length !== 2) {
  console.log('read: wrong contents, length ' + localStorage.length);
  quit(1);
} else {
  console.log('read ok');
  quit(0);
}
```

Create `maemo-react/runtime/test/storage/empty.js`:

```js
// storage.sh, run 3: the file is corrupt, so the storage starts empty.
import { quit } from 'maemo:app';

if (localStorage.length !== 0) {
  console.log('expected an empty storage, got ' + localStorage.length + ' items');
  quit(1);
}
localStorage.setItem('token', 'secret');
localStorage.setItem('count', '1');
quit(0);
```

Create `maemo-react/runtime/test/storage.sh`:

```bash
#!/usr/bin/env bash
# localStorage over several runs: the file persists, has mode 0600, and a
# corrupt file is kept as .bad. HOST_RUN comes from test/run.sh.
set -uo pipefail
D=$(mktemp -d /tmp/mr-storage.XXXXXX)
export MR_DATA_DIR=$D MR_APP_ID=storage-sh
F=$D/storage-sh/localStorage.json
out=$($HOST_RUN --test test/storage/write.js 2>&1) || { echo "write failed: $out"; exit 1; }
[ -f "$F" ] || { echo "no $F after write.js"; exit 1; }
mode=$(stat -c %a "$F")
[ "$mode" = 600 ] || { echo "mode is $mode, not 600"; exit 1; }
grep -q '"token":"secret"' "$F" || { echo "the file has no token: $(cat "$F")"; exit 1; }
out=$($HOST_RUN --test test/storage/read.js 2>&1) || { echo "read failed: $out"; exit 1; }
echo 'not json' > "$F"
out=$($HOST_RUN --test test/storage/empty.js 2>&1) || { echo "empty failed: $out"; exit 1; }
[ -f "$F.bad" ] || { echo "no $F.bad"; exit 1; }
[ "$(cat "$F.bad")" = 'not json' ] || { echo "wrong contents in $F.bad"; exit 1; }
chmod 644 "$F"
out=$($HOST_RUN --test test/storage/read.js 2>&1) || { echo "read after chmod failed: $out"; exit 1; }
[ "$(stat -c %a "$F")" = 600 ] || { echo "the mode was not repaired to 600"; exit 1; }
rm -rf "$D"
```

In `maemo-react/runtime/test/run.sh`, add after `export HOST_RUN`:

```bash
# localStorage of the tests goes to a fresh folder, not to $HOME.
export MR_DATA_DIR=$(mktemp -d /tmp/mr-test-data.XXXXXX)
```

- [ ] **Step 5: Run the tests to see them fail**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/test/run.sh desktop test/storage.test.js test/storage.sh' > /tmp/m3a-t4.log 2>&1; tail -20 /tmp/m3a-t4.log
```

Expected: `FAIL test/storage.test.js` (the module `maemo:storage` is unknown) and `FAIL test/storage.sh`.

- [ ] **Step 6: Write app.c, storage.c and main.c**

In `maemo-react/runtime/src/mr.h`, add after `#define MR_VERSION "0.3.0"`:

```c
#define MR_APPS_DIR "/opt/n810-modern/share/maemo-react/apps"
```

add to the `app.c` block:

```c
const char *mr_app_id(void);
gchar *mr_app_data_dir(void);
```

and after the `ws.c` block:

```c
/* storage.c */
JSModuleDef *mr_init_storage(JSContext *ctx, const char *name);
void mr_storage_flush(void);
```

In `maemo-react/runtime/src/app.c`, add `#include <string.h>` at the top, and add after `mr_app_set_args`:

```c
/* The application id: $MR_APP_ID, else the <id> of
   MR_APPS_DIR/<id>/app.js, else the base name of the module file without
   its extension. */
const char *mr_app_id(void)
{
    static gchar *id;
    const char *env = g_getenv("MR_APP_ID");
    gchar *base;
    if (id)
        return id;
    if (env && *env)
        return id = g_strdup(env);
    if (app_argc > 0 && g_str_has_prefix(app_argv[0], MR_APPS_DIR "/")) {
        const char *rest = app_argv[0] + strlen(MR_APPS_DIR) + 1;
        const char *slash = strchr(rest, '/');
        if (slash && slash > rest)
            return id = g_strndup(rest, slash - rest);
    }
    base = app_argc > 0 ? g_path_get_basename(app_argv[0]) : g_strdup("app");
    if (g_str_has_suffix(base, ".js"))
        base[strlen(base) - 3] = '\0';
    else if (g_str_has_suffix(base, ".mjs"))
        base[strlen(base) - 4] = '\0';
    return id = base;
}

/* $MR_DATA_DIR/<id>, else <home>/.maemo-react/<id> (spec section 7). Free it. */
gchar *mr_app_data_dir(void)
{
    const char *base = g_getenv("MR_DATA_DIR");
    if (base && *base)
        return g_build_filename(base, mr_app_id(), NULL);
    return g_build_filename(g_get_home_dir(), ".maemo-react", mr_app_id(), NULL);
}
```

In `app_init`, add before the `return`:

```c
    {
        gchar *dir = mr_app_data_dir();
        JS_SetModuleExport(ctx, m, "id", JS_NewString(ctx, mr_app_id()));
        JS_SetModuleExport(ctx, m, "dataDir", JS_NewString(ctx, dir));
        g_free(dir);
    }
```

In `mr_init_app`, add after `JS_AddModuleExport(ctx, m, "args");`:

```c
    JS_AddModuleExport(ctx, m, "id");
    JS_AddModuleExport(ctx, m, "dataDir");
```

Create `maemo-react/runtime/src/storage.c`:

```c
/* maemo:storage -- the file behind localStorage. The prelude keeps the items
   in memory and gives this module a function that makes the JSON text. The
   module calls it during idle time after a change, and writes the file with
   a temporary file and rename, mode 0600 (HA spec section 5). */
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "mr.h"

#define FILE_NAME "localStorage.json"

static JSValue make_text; /* the pending function, or undefined */
static guint save_source;

static gchar *file_path(void)
{
    gchar *dir = mr_app_data_dir();
    gchar *path = g_build_filename(dir, FILE_NAME, NULL);
    g_free(dir);
    return path;
}

static void complain(const char *what, const char *path)
{
    fprintf(stderr, "localStorage: cannot %s %s: %s\n", what, path, g_strerror(errno));
}

/* Write text to path through path.tmp and rename, so a reader sees the old
   file or the new one, never a part. */
static int write_file(const char *path, const char *text, size_t len)
{
    gchar *dir = g_path_get_dirname(path);
    gchar *tmp = g_strconcat(path, ".tmp", NULL);
    size_t off = 0;
    int fd, rc = -1;
    if (g_mkdir_with_parents(dir, 0700) < 0) {
        complain("make the folder", dir);
        goto out;
    }
    fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) {
        complain("open", tmp);
        goto out;
    }
    fchmod(fd, 0600); /* an old temporary file keeps its mode through O_CREAT */
    while (off < len) {
        ssize_t n = write(fd, text + off, len - off);
        if (n < 0 && errno == EINTR)
            continue;
        if (n < 0) {
            complain("write", tmp);
            close(fd);
            unlink(tmp);
            goto out;
        }
        off += (size_t)n;
    }
    if (close(fd) < 0) {
        complain("close", tmp);
        unlink(tmp);
        goto out;
    }
    if (rename(tmp, path) < 0) {
        complain("rename", tmp);
        unlink(tmp);
        goto out;
    }
    rc = 0;
out:
    g_free(dir);
    g_free(tmp);
    return rc;
}

/* Call the pending function and write its result. */
static void save_now(void)
{
    JSValue fn, text;
    const char *s;
    size_t len = 0;
    if (JS_IsUndefined(make_text))
        return;
    fn = make_text;
    make_text = JS_UNDEFINED;
    text = mr_call(fn, JS_UNDEFINED, 0, NULL);
    JS_FreeValue(mr_ctx, fn);
    s = JS_IsString(text) ? JS_ToCStringLen(mr_ctx, &len, text) : NULL;
    if (s) {
        gchar *path = file_path();
        write_file(path, s, len);
        g_free(path);
        JS_FreeCString(mr_ctx, s);
    }
    JS_FreeValue(mr_ctx, text);
}

static gboolean on_idle(gpointer data)
{
    save_source = 0;
    save_now();
    return FALSE;
}

void mr_storage_flush(void)
{
    if (save_source) {
        g_source_remove(save_source);
        save_source = 0;
    }
    save_now();
}

/* schedule(fn): call fn during idle time, after the paint, and write its
   result. The last function wins when several come before the idle. */
static JSValue js_schedule(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    if (argc < 1 || !JS_IsFunction(ctx, argv[0]))
        return JS_ThrowTypeError(ctx, "schedule: the argument must be a function");
    JS_FreeValue(ctx, make_text);
    make_text = JS_DupValue(ctx, argv[0]);
    /* G_PRIORITY_LOW runs after the GTK redraw (G_PRIORITY_HIGH_IDLE + 20). */
    if (!save_source)
        save_source = g_idle_add_full(G_PRIORITY_LOW, on_idle, NULL, NULL);
    return JS_UNDEFINED;
}

/* load(): the text of the file, or null when there is none. Repairs the mode. */
static JSValue js_load(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gchar *path = file_path();
    gchar *text = NULL;
    gsize len = 0;
    GError *err = NULL;
    struct stat st;
    JSValue r;
    if (stat(path, &st) == 0 && (st.st_mode & 077))
        chmod(path, 0600);
    if (g_file_get_contents(path, &text, &len, &err)) {
        r = JS_NewStringLen(ctx, text, len);
        g_free(text);
    } else {
        if (err->code != G_FILE_ERROR_NOENT)
            fprintf(stderr, "localStorage: cannot read %s: %s\n", path, err->message);
        g_error_free(err);
        r = JS_NULL;
    }
    g_free(path);
    return r;
}

/* markBad(): keep a file that cannot be read as localStorage.json.bad. */
static JSValue js_mark_bad(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gchar *path = file_path();
    gchar *bad = g_strconcat(path, ".bad", NULL);
    if (rename(path, bad) < 0 && errno != ENOENT)
        complain("rename", path);
    g_free(bad);
    g_free(path);
    return JS_UNDEFINED;
}

/* flush(): write now. For tests, and for an application that is about to quit. */
static JSValue js_flush(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    mr_storage_flush();
    return JS_UNDEFINED;
}

/* path(): the file path. For tests. */
static JSValue js_path(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gchar *path = file_path();
    JSValue r = JS_NewString(ctx, path);
    g_free(path);
    return r;
}

static const JSCFunctionListEntry storage_funcs[] = {
    JS_CFUNC_DEF("load", 0, js_load),
    JS_CFUNC_DEF("schedule", 1, js_schedule),
    JS_CFUNC_DEF("markBad", 0, js_mark_bad),
    JS_CFUNC_DEF("flush", 0, js_flush),
    JS_CFUNC_DEF("path", 0, js_path),
};

static int storage_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, storage_funcs, G_N_ELEMENTS(storage_funcs));
}

JSModuleDef *mr_init_storage(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, storage_init);
    if (!m)
        return NULL;
    make_text = JS_UNDEFINED;
    JS_AddModuleExportList(ctx, m, storage_funcs, G_N_ELEMENTS(storage_funcs));
    return m;
}
```

In `maemo-react/runtime/src/main.c`, in `register_modules`, add after the `maemo:ws` line:

```c
    mr_register_module("maemo:storage", mr_init_storage);
```

and change the end of `main` from:

```c
    if (!mr_quit_requested())
        gtk_main();
```

to:

```c
    if (!mr_quit_requested())
        gtk_main();
    mr_storage_flush(); /* a change that waits for idle time must reach the file */
```

A process that ends by a signal (the task navigator kills an application with `SIGTERM`) does not reach this line. GLib 2.12 has no `g_unix_signal_add`. The window of loss is the idle wait, which is a few milliseconds on an idle loop. HA Remote (M3b) also calls `flush()` of `maemo:storage` before it quits.

- [ ] **Step 7: Run the tests on both targets**

```bash
npm run build:prelude
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo' > /tmp/m3a-t4.log 2>&1; grep -n 'PASS\|FAIL\|not ok' /tmp/m3a-t4.log
```

Expected: every line is `PASS` on both targets, including `test/storage.test.js` and `test/storage.sh`. `check-glibc.sh` prints no error.

- [ ] **Step 8: The types**

In `maemo-react/packages/types/globals.d.ts`, add before the closing `}` of `declare global`:

```ts
  /**
   * localStorage: a JSON file in /home/user/.maemo-react/<app-id>/, mode
   * 0600, written during idle time after a change. The keys and values
   * together are at most 1,048,576 characters; setItem above that throws a
   * DOMException QuotaExceededError. There is no sessionStorage and no
   * storage event.
   */
  interface Storage {
    readonly length: number;
    key(index: number): string | null;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
  }
  var localStorage: Storage;
```

In `maemo-react/packages/types/modules.d.ts`, add to `maemo:app`:

```ts
  /** The application id: $MR_APP_ID, else the <id> of the install path, else the module file name. */
  export const id: string;
  /** /home/user/.maemo-react/<id> on the tablet; $MR_DATA_DIR/<id> when that is set. */
  export const dataDir: string;
```

and after `maemo:ws`:

```ts
declare module 'maemo:storage' {
  /** The text of <dataDir>/localStorage.json, or null when there is none. */
  export function load(): string | null;
  /** Call fn during idle time and write its result to the file. */
  export function schedule(fn: () => string): void;
  /** Rename the file to localStorage.json.bad. */
  export function markBad(): void;
  /** Write a pending change now. */
  export function flush(): void;
  export function path(): string;
}
```

In `maemo-react/packages/types/test/check.tsx`, add after the `WebSocket` lines:

```tsx
localStorage.setItem('ha.server', 'http://h:8123');
const server: string | null = localStorage.getItem('ha.server');
console.log(server, localStorage.length, localStorage.key(0));
// @ts-expect-error: there is no sessionStorage on the tablet
sessionStorage.setItem('x', 'y');
```

Run `npm run typecheck`. Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add maemo-react/runtime/src/app.c maemo-react/runtime/src/storage.c maemo-react/runtime/src/mr.h maemo-react/runtime/src/main.c maemo-react/runtime/test/run.sh maemo-react/runtime/test/storage.test.js maemo-react/runtime/test/storage.sh maemo-react/runtime/test/storage maemo-react/prelude/src/storage.js maemo-react/prelude/src/index.js maemo-react/prelude/test/storage.test.js maemo-react/packages/types/globals.d.ts maemo-react/packages/types/modules.d.ts maemo-react/packages/types/test/check.tsx
git commit -m "Add localStorage on a JSON file in the application data folder"
```

---

### Task 5: The runtime package, and the full run on both targets

**Files:**
- Modify: `maemo-react/runtime/pkg/control` (the description)
- No other file: this task checks the whole milestone half.

**Interfaces:**
- Consumes: everything above.
- Produces: `runtime/dist/maemo-react-runtime_0.3.0_armel.deb`, which the M3b plan installs in the emulator and on the tablet.

- [ ] **Step 1: Update the package description**

In `maemo-react/runtime/pkg/control`, change the last description line to:

```
 contains QuickJS, a GObject bridge, fetch() and WebSocket over the TLS stack
 of n810-modern-tls, and localStorage.
```

- [ ] **Step 2: Build the package and run everything**

```bash
npm test
npm run typecheck
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo deb && runtime/test/run.sh desktop && runtime/test/run.sh diablo' > /tmp/m3a-t5.log 2>&1; grep -n 'PASS\|FAIL\|not ok\|dpkg-deb' /tmp/m3a-t5.log
devhost/run.sh 'dpkg-deb -I runtime/dist/maemo-react-runtime_0.3.0_armel.deb | grep -i "version\|depends"'
```

Expected: every Vitest file passes; `tsc` prints nothing; every runtime line is `PASS` on both targets; `dpkg-deb` prints `Version: 0.3.0` and `Depends: n810-modern-tls (>= 1.1), libgtk2.0-0, libhildon1`.

- [ ] **Step 3: Commit**

```bash
git add maemo-react/runtime/pkg/control
git commit -m "Describe WebSocket and localStorage in the runtime package"
```

---

## Defaults in this plan

These values are choices, not spec requirements. Change them with a one-line edit:

| Value | Where | Why |
| --- | --- | --- |
| One message is at most 16 MB | `ws.c`, `MAX_MESSAGE` | the full states of 2,000 entities are a few MB |
| 5 s wait for the close frame of the server | `ws.c`, `CLOSE_WAIT_MS` | browsers wait a similar time |
| 30 s for the handshake | `ws.c`, `js_open` | the same as the connect limit of `http.c` |
| 16 KB receive buffer for each `curl_ws_recv` call | `ws.c`, `pump_recv` | small stack use on the tablet |
| `localStorage` holds at most 1,048,576 characters | `storage.js`, `LIMIT` | the snapshot of HA Remote is a few hundred KB |
| The file is `fsync`ed before the rename | `storage.c`, `write_file` | `fsync` keeps a power loss from leaving an empty file; the token must not be lost |
| `binaryType` accepts only `'arraybuffer'` | `websocket.js` | there is no `Blob` |
| The application id comes from `MR_APP_ID`, the install path, or the module file name | `app.c`, `mr_app_id` | the host gets no `app.json` |
| `MR_DATA_DIR` moves the data folder | `app.c`, `mr_app_data_dir` | the tests must not write to `$HOME` |

## Open items for M3b

1. `maemo:app` exports `id` and `dataDir`. M4 (`maemo:fs`) gives `appDataDir` with the same value.
2. The desktop dev host needs `MR_APP_ID=<id>` in its environment, or the data folder gets the name of the module file. The M3b plan sets it in its desktop run.
3. The `error` event of `WebSocket` has a non-standard `message`. HA Remote may show it in its status line.
