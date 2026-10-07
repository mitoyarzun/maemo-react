# M1 deferred findings

The reviews of M0 and M1 found these items and deferred them. They are small
or theoretical. Fix an item when you work on the file that it names. The
final whole-branch review gives each item a reason (the last column).

## From the task reviews

| Task | Deferred minor | Verdict | Reason |
| --- | --- | --- | --- |
| T1 | manifest header example command not runnable on the host | defer | the plan's own command at line 319 works inside `devhost/run.sh`; fix the comment with Important 2 |
| T1 | mk-sysroot.sh header does not mention MANIFEST | defer | the variable has a comment at its definition |
| T1 | run.sh builds the image only when missing | defer | a Dockerfile change is rare; document `docker rmi maemo-react-dev` |
| T1 | run.sh with no arguments exits 0 | defer | cosmetic |
| T1 | container runs as root | defer | macOS host (the user's); Linux users can add `--user` |
| T1 | check-env does not check OpenSSL in /work/out | defer | libcurl's presence implies the TLS build |
| T2 | print_error leaves a pending exception when JS_ToCString fails | defer | needs a thrown Symbol; the next call clears it |
| T2 | module index computed before gtk_init_check strips GTK options | defer | `--test` first is the documented order |
| T2 | mr_quit quits only the innermost gtk_main | defer | no nested loops in M1 |
| T2 | JS_NewRuntime/JS_NewContext unchecked | defer | out of memory at start; a crash is the realistic outcome either way |
| T2 | expect-fail with no `// expect:` passes on any failure | defer | one file uses it, and it has the line |
| T2 | check-glibc.sh silent when no GLIBC_ string | defer | every binary that links libc has one |
| T2 | Makefile objects do not depend on vendor headers; build.sh accepts any target | defer | `make clean` covers a QuickJS update |
| T2 | fetch-quickjs.sh needs GNU tools | defer | it runs in the container; add one line to its header when touched |
| T3 | PPM parse does not check P6/maxval | defer | QEMU always writes P6 8-bit |
| T3 | output without a final newline hides MR-END | defer | the suite script prints MR-END itself |
| T3 | SHOT kill stops only the subshell | defer | poweroff follows |
| T3 | dpkg -i failures ignored | defer | Task 16 read the dpkg output by hand; add `|| echo DPKG-FAIL` when the script is next touched |
| T3 | ambiguous failure exits | defer | cosmetic |
| T4 | "a shorter delay fires first" can flake | defer (Minor 10, trivial) | widen the margins when next in the file |
| T4 | elapsed >= 20 across clocks | defer | same clock (CLOCK_MONOTONIC) on both sides in practice |
| T4 | clearTimeout truncates non-integer ids | defer | browser-like |
| T4 | next_timer_id overflow | defer | unreachable |
| T4 | delays above 2^31-1 ms clamp | defer | browser-like |
| T5 | mr_bc_write stats the source after compiling | defer | needs a write to app.js during start; the next start detects the size/mtime change |
| T5 | no integrity check on the cache body | defer | JS_ReadObject rejects a damaged body in practice; a CRC is an M2+ nicety |
| T5 | --compile keeps the 256 KB default stack | defer | hello and bench compiled on the tablet; raise it with the next runtime change |
| T5 | bytecode.sh does not run the --compile output | defer | the tablet runs it at every start |
| T5 | "cannot write" also printed for a serialisation failure | defer | cosmetic |
| T5 | only the entry module is cached | defer | application bundles are one module |
| T5 | tests write .qbc beside the sources | defer | git-ignored |
| T6 | extra ref only for GtkWindow | defer | no other toplevel is created in M1; use the `!floating` test when M2 adds dialogs |
| T6 | interface-typed properties cannot be converted | defer | plan-mandated for M2 `List` |
| T6 | leniencies beyond "strict" | defer | documented behaviour |
| T6 | handle validation via JS_ToInt32 | defer | the renderer passes integers |
| T6 | unchecked JS_ToCString NULL on OOM | defer | out of memory |
| T6 | 64-bit desktop UB at 2^63 | defer | not on ARM |
| T6 | mr_type_from_name breaks for acronym types; init not idempotent | defer | no such type in M1/M2 lists; note it in the M2 typegen task |
| T6 | no test for release_tree | done | Task 7 added it |
| T6 | js_get not timed | defer | intended |
| T7 | mr.h declarations added twice | defer (Minor 1) | harmless |
| T7 | mr_bridge_ms double-counts handlers in non-"emits" helpers | defer | affects only `bridgeTime()` if a handler is connected to show/hide; note it in benchmarks.md |
| T7 | scrolled.add/box.reorder/container.add lack guards | defer | the renderer enforces the single-child model; a GTK critical is the fallback |
| T7 | childSet/childGet ignore read-only flags | defer | GTK checks and prints a warning |
| T7 | closure_invalidate uses mr_ctx at shutdown | defer | the runtime is never freed (main.c comment) |
| T7 | flushPaint not tried without a display | defer | the host exits before any JS runs without a display |
| T7 | self-destroy tests pass without the fix (no sanitizer) | defer | recommend an ASan desktop build in M2 (Recommendations) |
| T8 | Makefile copies prelude/dist without a dependency | defer | plan-mandated; the README order builds the prelude first; make `build.sh` run `npm run build:prelude` when npm exists (M2) |
| T8 | main.c leaks the prelude path on early returns | defer | the process exits |
| T8 | `??a=1` searchParams | defer | edge case |
| T8 | url.js exposes _setQuery etc. | defer | underscore names |
| T8 | console inspect differs from Node | defer | documented subset |
| T8 | pathname setter keeps backslashes | defer | documented |
| T9 | test certificate never regenerated | defer | 30 days; add `-newer` check when it bites |
| T9 | test HTTPS server never killed | defer | container is throwaway |
| T9 | server.py tracebacks on aborts | defer | noise only |
| T9 | pending JS exceptions in add_headers/opt_string | defer | the request is rejected on the main paths; the Symbol case is theoretical |
| T9 | unchecked curl_easy_init etc. | defer | out of memory |
| T9 | (long)timeout UB for Infinity | defer | fetch passes 0; clamp when next touched |
| T9 | GET with a body becomes POST | defer | fetch.js rejects GET/HEAD with a body before the native call |
| T9 | protocols not restricted | done | security fix round (`CURLOPT_PROTOCOLS_STR`) |
| T9 | Content-Encoding kept; statusText empty on HTTP/2 | defer | browser-like |
| T9 | http test gaps | defer | the nested-request test was added; the rest are M2 |
| T9 | server.py lacks PATCH/OPTIONS | defer | not used |
| T9 | embedded NUL truncates before the token check | defer | no injection possible |
| T9 | a throwing toString leaves a pending exception | defer | theoretical |
| T9 | guard tests pass on old code too | defer | they still pin the behaviour |
| T10 | idle priority | done | security fix round (`G_PRIORITY_DEFAULT`) |
| T10 | stale in_callback comment | defer (Minor 3) | comment only |
| T10 | check_done goto/declaration style | defer | style |
| T10 | nested main loop inside emit | defer | no nested loops in M1 |
| T10 | no direct regression test for a nested request | done | security fix round added it |
| T10 | http.c fix inside the Task 10 commit | defer | history only |
| T11 | packType 'end' index agreement | defer | `container.indexOf` and `box.reorder` both use the GtkBox child list, so they agree; only the visual order of end-packed children differs, as in GTK |
| T11 | window descendants lose handles before passive cleanups | defer | only on window removal; a cleanup that reads a widget in a removed window is rare; document it with Minor 4 |
| T11 | fake bridge destroy does not cascade; set does not emit | defer | my probe (see Declined) covered the emit case on the fake; the real bridge test covers typing |
| T11 | onError receives caught errors | done | fix round separated them |
| T11 | unhideInstance ignores visible=false | defer | Suspense with a hidden widget is an edge |
| T11 | explicit visible={true} shows a window early | defer | document "do not pass visible on Window" |
| T11 | child props ignored under a non-box parent | defer | the types allow it; a warning is an M2 nicety |
| T11 | no Fragment ref hooks | defer | React 19.3 feature flag off |
| T11 | test gaps | defer | M2 |
| T11 | lazy/Suspense test waits 700 ms | defer | time-based but stable |
| T11 | non-box move test calls the host config directly | defer | documented in the test |
| T12 | no automated ELEMENTS check | defer (Minor 11) | add it in the first M2 task that adds an element |
| T12 | run.sh leaves gtk.json.tmp; Xvfb left running | defer | container |
| T12 | invalid TS for an enum with no values | defer | none in GTK 2.10 |
| T12 | no guard against on<Name> collisions | defer | tsc would report a duplicate member |
| T12 | typegen.c leaks on early return; childProperties unused | defer | exits; M2 may use child properties |
| T12 | boxed signal params typed as unknown | defer | correct until converters exist |
| T13 | Box remounts when `vertical` changes | defer | document it in the widgets JSDoc (one line) |
| T13 | Entry is weakly controlled | defer | known; the fix needs a re-set when GTK differs after the handler |
| T13 | BoxProps spreads vbox props into gtk-hbox | defer | identical in GTK 2.10 |
| T13 | console.table/time/group not declared | defer | intended |
| T13 | widgets' public types need @maemo-react/types as a devDependency | defer | the template lists it; revisit with Important 1 |
| T14 | self-removing button test asserts less than it could | defer | the handle count is asserted |
| T14 | typing test does not prove the controlled path | defer | M2 |
| T14 | tests share one tree | defer | add a comment when touched |
| T14 | "made of GTK widgets" checks two properties | defer | enough |
| T15 | icon path can escape the folder | defer | app.json is the developer's own file |
| T15 | directory entries over 100 bytes | defer | ids are short |
| T15 | Installed-Size after Description; directories not counted | defer | dpkg accepts any order |
| T15 | --port NaN; .deb from a flag value; create message | defer | `checkPort` rejects NaN with a clear message; Minor 9 for the .deb pick |
| T15 | bin dist/cli.js absent at install | defer | README runs `build:cli` first |
| T15 | scp source with ':' | defer | the path comes from the tool |
| T15 | host regex: bracket balance, zone ids; user "." | defer | no injection |
| T16 | list p95 equals max with n=10 | defer | say "n=10" in the table |
| T16 | overlapping runs on a second press; no warm-up | defer | `--auto` is the recorded path |
| T16 | Makefile deb: no MR_VERSION check, no Installed-Size, umask modes, check-glibc not on the packaged binary | defer | strip does not change symbol versions; `--root-owner-group` fixes owners; add `umask 022` when touched |
| T16 | runtime postrm removes only prelude.qbc | defer | the runtime's own file; app .qbc belongs to the app's postrm |
| T16 | hello: redundant setState; smoke timer not cleaned | defer | example code |

## From the scoped re-review of the final fix wave

### Minor

**N2. The CLI postinst continuation uses a single backslash.**
`packages/cli/src/package.ts:29` ends with `|| \` in a JavaScript template
literal. JavaScript removes the backslash and the newline, so the output is
one line, `... app.js || <TAB>echo "..." >&2`. That line is valid sh, so the
behavior is correct. But the source suggests a shell continuation, and the
next line uses `\\` for a real one. Write `\\` to keep the two equal.

**N3. The 165 MHz estimate is "about 72 ms", but 29.8 x 2.5 = 74.5 ms.**
The error is at `docs/benchmarks.md:50-51`. The number comes from
final-review.md and the brief. The conclusion does not change: the estimate
is over the 50 ms target. Write "about 75 ms".

**N4. The probe's list column says "400 MHz", but the spec does not give
the clock for that run.** The column header is "Probe, 400 MHz", and the
spec appendix table (spec line 347) labels the list column "200-row list"
with no clock. Under load, `ondemand` probably held 400 MHz. Say "probably
400 MHz (ondemand)", or move the list rows to a column without a clock.

**N5. js_set runs the conversion twice on failure.** In
`runtime/src/bridge.c:129-136`, the second `mr_js_to_gvalue` call reads
`argv[2]` again. For a flags array, `to_flags` reads the elements with
`JS_GetPropertyUint32`, so a getter or a Proxy runs twice. If the second run
succeeds, the property is set and the first error is lost. This is
theoretical, because React props are plain values. An alternative with one
pass passes `G_OBJECT_TYPE_NAME(o)` and `name` as two arguments and formats
them only in the throw paths.

### Nits

- `devhost/emulator-run.sh:81,113-114`: after the normal `kill` and `wait`,
  the EXIT trap still runs `kill $QPID` on a reaped PID. Add `trap - EXIT`
  after `wait` so a reused PID cannot be killed. The 10 s screenshot wait
  also does not count against `TIMEOUT`.
- When the script runs through `devhost/run.sh`, it is the container's main
  process. When it exits, `docker run --rm` stops QEMU anyway. The trap
  matters when the script runs in other ways. It is correct and harmless.
- README:20: `| tail -6` inside `devhost/run.sh 'bash -c ...'` hides a
  `mk-sysroot.sh` failure, because the inner `bash -c` has no `pipefail`.
  The plan gives this form. The user sees the last lines and does not see
  the exit status.
- `packages/core/src/renderer.ts:23-28`: "Default: nothing" is correct for
  `createRenderer`, but the public `render` in `core/src/index.ts:11` quits.
  The phrase "keep the default behaviour safe" mixes the two. Also, the hook
  runs only when the last window of a container closes
  (`hostConfig.ts:220`).

