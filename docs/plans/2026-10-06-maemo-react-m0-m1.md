# maemo-react M0 + M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the maemo-react skeleton (M0) and the first vertical slice (M1): a C host that runs a React 19 application from bytecode, draws native GTK 2 and Hildon widgets through a generic GObject bridge, has `fetch` over HTTPS, and installs as a `.deb` made by a CLI.

**Architecture:** One C99 binary, `maemo-react-host`, embeds QuickJS on the GLib main loop. A private native module, `maemo:gobject`, creates GObjects and sets properties, child properties and signals through `GParamSpec` and `g_signal_query` metadata. A JavaScript prelude gives web-standard globals on top of small native modules. The React renderer (`@maemo-react/core`) is a `react-reconciler` host config over the bridge. Each application is an ES module bundle with React inside it.

**Tech Stack:** C99, QuickJS 2025-09-13, GLib 2.12, GTK 2.10, Hildon 2.0, libcurl 8.22 (from n810-modern), React 19.3.0, react-reconciler 0.34.0, TypeScript 5.9.3, esbuild 0.28.2, Vitest 5.0.3, Docker (Ubuntu 24.04 dev image), qemu-user, the n810-modern Diablo emulator.

**Spec:** `maemo-react/docs/specs/2026-10-06-maemo-react-design.md`. Read it before you start. This plan implements its milestones M0 and M1 (section 13).

## Global Constraints

- The runtime is C99 only. Do not add C++ to the runtime (spec section 2).
- Diablo binaries must need no glibc symbol newer than `GLIBC_2.5`, and must have the ABI tag `2.6.8`. `runtime/check-glibc.sh` checks both.
- Use only APIs that exist in GLib 2.12, GTK 2.10 and Hildon 2.0. Examples of newer APIs that you must not use: `g_timeout_add_seconds` (2.14), `g_strcmp0` (2.16), `gtk_widget_get_window` (2.14), `gdk_color_to_string` (2.12 GDK is fine, but this function is from GTK 2.12), `GSocket` (2.22).
- The install prefix is `/opt/n810-modern`. The runtime binary is `/opt/n810-modern/bin/maemo-react-host`.
- Packages use gzip compression. Diablo's dpkg 1.14 cannot read xz or zstd.
- QuickJS 2025-09-13 with `CONFIG_ATOMICS` off. ARMv6 has no 64-bit `ldrexd`/`strexd`.
- React 19.3.0 with `react-reconciler` 0.34.0, in mutation mode.
- Application bundles: ES modules, target ES2020, `maemo:*` imports kept external.
- Bytecode is compiled on the tablet (spec section 9). The development computer needs no ARM compiler for JavaScript.
- Application `tsconfig`: `"lib": ["es2023"]`, no `dom`.
- Take time measurements on the tablet only. The emulator is about 10 times faster than the N810 (spec appendix A).
- Write all English prose, code comments and commit messages in ASD-STE100 Simplified Technical English. Commit messages follow the repository style: an imperative summary line, for example `Add the maemo:gobject bridge`. No `feat:` prefixes.
- Run one QEMU at a time. Several instances starve the emulated DMA controller.

## Review Focus

These five conditions are implied by the spec but no task's main tests exercise them. Each one has a test in the task that owns the code:

1. **Starting an application without a display** (for example from SSH without `DISPLAY`). Expected: a clear message and exit code 1, not a crash. Test: Task 2, `test/no-display.sh`.
2. **Non-ASCII text through the bridge** (Spanish text, the euro sign, emoji). Expected: the text reads back unchanged from GTK. Test: Task 6, `bridge-props.test.js` "UTF-8 text".
3. **An application folder that the user cannot write** (an installed application runs as `user`, but root owns its folder). Expected: no bytecode cache is written and the application still runs. Test: Task 5, `test/bytecode.sh`.
4. **No network, or a name that does not resolve.** Expected: `fetch` rejects with `TypeError("Failed to fetch")` and a `cause`, and does not hang. Test: Task 10, `fetch.test.js` "DNS failure".
5. **A widget that is removed while its own signal runs** (a button whose click handler makes React remove that button). Expected: no crash, and the handle is released. Test: Task 14, `react-gtk.test.js` "button removes itself".

## File Structure

```
tools/mk-sysroot.sh                      MODIFY: accept MANIFEST from the environment
maemo-react/
  README.md                              how to build and test
  .gitignore
  package.json                           npm workspaces, scripts, pinned dev tools
  tsconfig.base.json
  vitest.config.ts
  devhost/
    Dockerfile                           the dev image: both toolchains, qemu, Xvfb
    run.sh                               runs a command in the dev container
    check-env.sh                         checks that the volume and tools are ready
    sysroot-gtk.manifest                 GTK, GLib, Pango, Hildon packages for the sysroot
    emulator-run.sh                      boots the Diablo emulator once and runs a command
  runtime/
    build.sh                             builds one target (desktop or diablo)
    Makefile
    check-glibc.sh
    vendor/fetch-quickjs.sh
    vendor/quickjs/...                   vendored QuickJS sources
    src/mr.h                             shared declarations
    src/main.c                           command line, start-up order
    src/loop.c                           calls into JS, jobs, rejections, timers, quit
    src/console.c                        console.*, performance.now()
    src/loader.c                         module loader, bytecode cache use
    src/bytecode.c                       .qbc files with a version header
    src/app.c                            maemo:app
    src/gtype.c                          GType lookup by name
    src/convert.c                        GValue <-> JSValue
    src/bridge.c                         maemo:gobject
    src/closure.c                        JS signal closures
    src/helpers.c                        call() helpers
    src/debug.c                          maemo:debug
    src/http.c                           maemo:http (curl multi on GLib)
    pkg/control, pkg/postinst, pkg/postrm runtime package files
    test/run.sh                          runs runtime tests for one target
    test/harness.js                      tiny test API for runtime tests
    test/*.test.js, test/*.sh            runtime tests
    test/expect-fail/*.js                programs that must fail with a given message
    test/server/server.py                local HTTPS test server
    test/bundles/*.jsx                   tests that need bundling (React)
    test/build-bundles.mjs
  prelude/
    package.json
    src/index.js                         installs the globals
    src/console.js, encoding.js, url.js, events.js, fetch.js
    test/*.test.js                       Vitest, with Node as the oracle where possible
  packages/
    core/      src/{bridge.ts,elements.ts,hostConfig.ts,renderer.ts,index.ts}, test/
    widgets/   src/index.tsx, test/
    types/     index.d.ts, globals.d.ts, modules.d.ts, jsx.d.ts, generated/, test/
    cli/       src/{index.ts,ar.ts,tar.ts,deb.ts,png.ts,app.ts,create.ts,build.ts,package.ts,deploy.ts,templates.ts}, test/
  typegen/
    typegen.c                            dumps GTK/Hildon class metadata as JSON
    run.sh                               builds and runs it under qemu-user
    emit.mjs                             JSON -> generated/intrinsics.d.ts
  examples/
    hello/                               fetches JSON over HTTPS and shows it
    bench/                               frame benchmark (spec section 11)
  docs/benchmarks.md                     recorded tablet results
```

---

### Task 1: Development environment

**Files:**
- Modify: `tools/mk-sysroot.sh:14` (the `MANIFEST=` line)
- Create: `maemo-react/devhost/sysroot-gtk.manifest`
- Create: `maemo-react/devhost/Dockerfile`
- Create: `maemo-react/devhost/run.sh`
- Create: `maemo-react/devhost/check-env.sh`
- Create: `maemo-react/.gitignore`
- Create: `maemo-react/README.md`

**Interfaces:**
- Consumes: the `n810-build` Docker volume, made by `tools/build-in-docker.sh`. It must contain `/work/sysroot-diablo`, `/work/out/opt/n810-modern` (curl and OpenSSL) and `/work/emulator` (made by `tools/mk-diablo-emulator.sh` and `STOCK=1 tools/emulator-gui-build.sh`).
- Produces: `devhost/run.sh '<command>'`. It runs `<command>` with bash in the `maemo-react-dev` image. The repository is at `/repo`, the volume at `/work`, and the working folder is `/repo/maemo-react`. Every later task uses it.

- [ ] **Step 1: Let mk-sysroot.sh take another manifest**

In `tools/mk-sysroot.sh`, change the line `MANIFEST="$HERE/diablo-sysroot.manifest"` to:

```bash
# MANIFEST can name another manifest, for example maemo-react's GTK packages.
MANIFEST="${MANIFEST:-$HERE/diablo-sysroot.manifest}"
```

- [ ] **Step 2: Write the GTK sysroot manifest**

Create `maemo-react/devhost/sysroot-gtk.manifest` with exactly this content. Fields are separated by one TAB character (not spaces). Each pool path was checked on the mirror on 2026-10-06, and each MD5 is from a downloaded package. These are the packages that the probes' sysroot had and that `tools/diablo-sysroot.manifest` does not list.

```
# GTK 2.10, GLib 2.12, Pango, Cairo, Hildon 2.0 and their X11 dependencies,
# for building maemo-react against the Diablo sysroot. Use it together with
# tools/diablo-sysroot.manifest:
#   MANIFEST=maemo-react/devhost/sysroot-gtk.manifest tools/mk-sysroot.sh
# Fields: package<TAB>version<TAB>md5<TAB>pool-path
dbus	1.0.2-0osso14	a738c9746da84516b1979c328639c996	pool/maemo4.1.2/free/d/dbus/dbus_1.0.2-0osso14_armel.deb
debconf	1.4.70.osso2	133186eac7d58d8b206c45eba48bf1fc	pool/maemo4.1.2/free/d/debconf/debconf_1.4.70.osso2_all.deb
fontconfig	2.4.1-1osso5	470d85625e3f9919cc4f0c671c249198	pool/maemo4.1.2/free/f/fontconfig/fontconfig_2.4.1-1osso5_armel.deb
gconf2	2.16.0-1osso14	c4d3955d9329974f0d8de282385abef4	pool/maemo4.1.2/free/g/gconf2/gconf2_2.16.0-1osso14_armel.deb
gtk20-l10n	4.2	bb1b94bb96626d91a4defbc0142d0971	pool/maemo4.1.2/free/g/gtk20-l10n/gtk20-l10n_4.2_all.deb
libatk1.0-0	1.18.0-1osso5	fb47a4a8131c471e1cead65d961a481f	pool/maemo4.1.2/free/a/atk1.0/libatk1.0-0_1.18.0-1osso5_armel.deb
libatk1.0-dev	1.18.0-1osso5	64709147180cacb8fbe77d49f3309ced	pool/maemo4.1.2/free/a/atk1.0/libatk1.0-dev_1.18.0-1osso5_armel.deb
libaudiofile-dev	0.2.6-3osso6	44be250ecce468be4e522c23a1642f04	pool/maemo4.1.2/free/a/audiofile/libaudiofile-dev_0.2.6-3osso6_armel.deb
libaudiofile0	0.2.6-3osso6	dead022bc028bcfb7a37e929c1ef59f8	pool/maemo4.1.2/free/a/audiofile/libaudiofile0_0.2.6-3osso6_armel.deb
libcairo2	1.4.10-0osso3	2ed65fa82c8fbba14dee7786b4eeb5f8	pool/maemo4.1.2/free/libc/libcairo/libcairo2_1.4.10-0osso3_armel.deb
libcairo2-dev	1.4.10-0osso3	1bf36ece52622a41b7ed75d6a6e05d9b	pool/maemo4.1.2/free/libc/libcairo/libcairo2-dev_1.4.10-0osso3_armel.deb
libdbus-1-3	1.0.2-0osso14	80c32b78ccebca736b03802080695e32	pool/maemo4.1.2/free/d/dbus/libdbus-1-3_1.0.2-0osso14_armel.deb
libdbus-1-dev	1.0.2-0osso14	50ea542a6243850bdbe87e1ab51b0000	pool/maemo4.1.2/free/d/dbus/libdbus-1-dev_1.0.2-0osso14_armel.deb
libdbus-glib-1-2	0.74-0osso7	acd4649376acc0ed9b391a04d2ebe189	pool/maemo4.1.2/free/d/dbus-glib/libdbus-glib-1-2_0.74-0osso7_armel.deb
libdbus-glib-1-dev	0.74-0osso7	b58d9c303616b72a7e188d391f4496ff	pool/maemo4.1.2/free/d/dbus-glib/libdbus-glib-1-dev_0.74-0osso7_armel.deb
libesd0	0.52-14	d37a042220c98d22c257dc9da82fdc30	pool/maemo4.1.2/free/o/osso-esd/libesd0_0.52-14_armel.deb
libesd0-dev	0.52-14	e1f11ada15bd52292636900f0a6a596b	pool/maemo4.1.2/free/o/osso-esd/libesd0-dev_0.52-14_armel.deb
libfontconfig1	2.4.1-1osso5	7233cc9170632c7b36bebc683fef4c9c	pool/maemo4.1.2/free/f/fontconfig/libfontconfig1_2.4.1-1osso5_armel.deb
libfontconfig1-dev	2.4.1-1osso5	cae119389ac53d8346e50b1bd56d0476	pool/maemo4.1.2/free/f/fontconfig/libfontconfig1-dev_2.4.1-1osso5_all.deb
libfreetype6	2.3.5-1osso1	f3eef33d3bf39478ac9117075b705d48	pool/maemo4.1.2/free/f/freetype/libfreetype6_2.3.5-1osso1_armel.deb
libfreetype6-dev	2.3.5-1osso1	6dbbcc31bff79a67cc7e65de7a60cfbd	pool/maemo4.1.2/free/f/freetype/libfreetype6-dev_2.3.5-1osso1_armel.deb
libgconf2-6	2.16.0-1osso14	7146398d1a81ed20cd19c5c54df20b1b	pool/maemo4.1.2/free/g/gconf2/libgconf2-6_2.16.0-1osso14_armel.deb
libgconf2-dev	2.16.0-1osso14	5afb0cffafb551ec6992f522acc5688e	pool/maemo4.1.2/free/g/gconf2/libgconf2-dev_2.16.0-1osso14_armel.deb
libglib2.0-0	2.12.12-1osso13	9c75b8089bbdfe69ef075459c3d0ba79	pool/maemo4.1.2/free/g/glib2.0/libglib2.0-0_2.12.12-1osso13_armel.deb
libglib2.0-dev	2.12.12-1osso13	c12fa483d03edb7d84c8b72b50ae4fce	pool/maemo4.1.2/free/g/glib2.0/libglib2.0-dev_2.12.12-1osso13_armel.deb
libgtk2.0-0	2:2.10.12-0osso36	b35b89245f1f63857a2e5a1370e65158	pool/maemo4.1.2/free/g/gtk+2.0/libgtk2.0-0_2.10.12-0osso36_armel.deb
libgtk2.0-bin	2:2.10.12-0osso36	8e1b4eba2514574666b656bc215ee64f	pool/maemo4.1.2/free/g/gtk+2.0/libgtk2.0-bin_2.10.12-0osso36_armel.deb
libgtk2.0-common	2:2.10.12-0osso36	3b5299a0945b8f3f4641bffca93b2623	pool/maemo4.1.2/free/g/gtk+2.0/libgtk2.0-common_2.10.12-0osso36_all.deb
libgtk2.0-dev	2:2.10.12-0osso36	74d2296a96285b01a9eca9605f321246	pool/maemo4.1.2/free/g/gtk+2.0/libgtk2.0-dev_2.10.12-0osso36_armel.deb
libhal-storage1	0.5.11~git20080402-1osso1	aca12cecf492110fa71152131010a965	pool/maemo4.1.2/free/h/hal/libhal-storage1_0.5.11~git20080402-1osso1_armel.deb
libhal1	0.5.11~git20080402-1osso1	871ec9b8647f26321026215d7c0f77b9	pool/maemo4.1.2/free/h/hal/libhal1_0.5.11~git20080402-1osso1_armel.deb
libhildon1	2.0.6-1	8c88d59aec30da259b73e27b95ac887b	pool/maemo4.1.2/free/libh/libhildon/libhildon1_2.0.6-1_armel.deb
libhildon1-dev	2.0.6-1	4369e974116ed1d88713f40812a3a95d	pool/maemo4.1.2/free/libh/libhildon/libhildon1-dev_2.0.6-1_armel.deb
libhildondesktop-dev	1:2.0.18-1fix1	39263d393d742c7b59528aaa1cf45966	pool/maemo4.1.2/free/h/hildon-desktop/libhildondesktop-dev_2.0.18-1fix1_all.deb
libhildondesktop0	1:2.0.18-1fix1	4e97a54ac76461336a51a467f2321e92	pool/maemo4.1.2/free/h/hildon-desktop/libhildondesktop0_2.0.18-1fix1_armel.deb
libhildonwm0	1:2.0.18-1fix1	6de7aaaef7bdd34ecdb2726bcb0cecb3	pool/maemo4.1.2/free/h/hildon-desktop/libhildonwm0_2.0.18-1fix1_armel.deb
libice-dev	1:1.0.0-3	07bcf30828d2fe658b73b5d612d0b060	pool/maemo4.1.2/free/libi/libice/libice-dev_1.0.0-3_armel.deb
libice6	1:1.0.0-3	8260095db85571e21290dba58003f746	pool/maemo4.1.2/free/libi/libice/libice6_1.0.0-3_armel.deb
libosso-dbus-conf	2.16-1	9fba32701aa416bd86e7ffe9ef5abfe4	pool/maemo4.1.2/free/libo/libosso/libosso-dbus-conf_2.16-1_all.deb
libosso-dev	2.16-1	c87a3bac88266b5f248c4cadae13025b	pool/maemo4.1.2/free/libo/libosso/libosso-dev_2.16-1_armel.deb
libosso-gnomevfs2-0	2.16.3-1osso39	10ddd0c6b449f0df517e2316a015d291	pool/maemo4.1.2/free/o/osso-gnome-vfs2/libosso-gnomevfs2-0_2.16.3-1osso39_armel.deb
libosso-gnomevfs2-common	2.16.3-1osso39	afd52396b9ba85547633468565a8b2cd	pool/maemo4.1.2/free/o/osso-gnome-vfs2/libosso-gnomevfs2-common_2.16.3-1osso39_armel.deb
libosso1	2.16-1	9c2d5a081e32748bc9ad163377cb10bf	pool/maemo4.1.2/free/libo/libosso/libosso1_2.16-1_armel.deb
libpango1.0-0	1.16.4-1osso5	1647c92c3101dda0b039ebccf68aa0e9	pool/maemo4.1.2/free/p/pango1.0/libpango1.0-0_1.16.4-1osso5_armel.deb
libpango1.0-common	1.16.4-1osso5	7ced33b0135b791fc7e01708ab0343c9	pool/maemo4.1.2/free/p/pango1.0/libpango1.0-common_1.16.4-1osso5_armel.deb
libpango1.0-dev	1.16.4-1osso5	f38d486c8b055b0110479ebb6a511810	pool/maemo4.1.2/free/p/pango1.0/libpango1.0-dev_1.16.4-1osso5_armel.deb
libpng12-0	1.2.8rel-1osso5	e37ecc9ecfa9f3d3a435fc0dae896a31	pool/maemo4.1.2/free/libp/libpng3/libpng12-0_1.2.8rel-1osso5_armel.deb
libpng12-dev	1.2.8rel-1osso5	3436f7495a377082c0066c772e072bbe	pool/maemo4.1.2/free/libp/libpng3/libpng12-dev_1.2.8rel-1osso5_armel.deb
libpopt-dev	1.7-6	d75a5e331865d4023d684af0b0017957	pool/maemo4.1.2/free/p/popt/libpopt-dev_1.7-6_armel.deb
libpopt0	1.7-6	f824600c0ae21f39810a215055f258ef	pool/maemo4.1.2/free/p/popt/libpopt0_1.7-6_armel.deb
libsm-dev	2:1.0.2-2osso2	ffc58b8a4120a56ec57762fa17a94275	pool/maemo4.1.2/free/libs/libsm/libsm-dev_1.0.2-2osso2_armel.deb
libsm6	2:1.0.2-2osso2	f1fb737f6647c06cf16e7b83d9a8a365	pool/maemo4.1.2/free/libs/libsm/libsm6_1.0.2-2osso2_armel.deb
libtiff4	1:3.6.1-4osso8	2b6868365b9acbe731651720c1b8c96d	pool/maemo4.1.2/free/t/tiff/libtiff4_3.6.1-4osso8_armel.deb
libusb-0.1-4	2:0.1.12-5osso1	092815741ad63776eb3ace610e833728	pool/maemo4.1.2/free/libu/libusb/libusb-0.1-4_0.1.12-5osso1_armel.deb
libx11-data	2:1.1.1-1osso3	264b459bb9a709e91a97ae5f791d217c	pool/maemo4.1.2/free/libx/libx11/libx11-data_1.1.1-1osso3_all.deb
libx11-dev	2:1.1.1-1osso3	a718853620a17c1c8e64528012c8a18b	pool/maemo4.1.2/free/libx/libx11/libx11-dev_1.1.1-1osso3_armel.deb
libxau-dev	1:1.0.3-2osso1	a3da2e4cb3dd0d72074b881750eadc15	pool/maemo4.1.2/free/libx/libxau/libxau-dev_1.0.3-2osso1_armel.deb
libxcomposite1	1:0.3.1-2	5deb257fec014cc9e7a44d78165dc19a	pool/maemo4.1.2/free/libx/libxcomposite/libxcomposite1_0.3.1-2_armel.deb
libxcursor1	1:1.1.8-2osso1	b5d772f94da0cc07be1ce236f2c2c1cb	pool/maemo4.1.2/free/libx/libxcursor/libxcursor1_1.1.8-2osso1_armel.deb
libxdamage1	1:1.1.1-3osso1	f5ffa3e4124dc59efb5ef24224c26d52	pool/maemo4.1.2/free/libx/libxdamage/libxdamage1_1.1.1-3osso1_armel.deb
libxdmcp-dev	1:1.0.2-2osso1	652bbfe976e986e172b165241484e215	pool/maemo4.1.2/free/libx/libxdmcp/libxdmcp-dev_1.0.2-2osso1_armel.deb
libxext-dev	1:1.0.3-2osso1	a84acaa3d5c59f0a16d5d583db366b6b	pool/maemo4.1.2/free/libx/libxext/libxext-dev_1.0.3-2osso1_armel.deb
libxfixes3	1:4.0.3-2osso1	e8486aeaa4c1efb2697cad5b124807b2	pool/maemo4.1.2/free/libx/libxfixes/libxfixes3_4.0.3-2osso1_armel.deb
libxft-dev	2.1.12-2osso1	b6198e3156e7159a6f58a65792b8f7cf	pool/maemo4.1.2/free/x/xft/libxft-dev_2.1.12-2osso1_armel.deb
libxft2	2.1.12-2osso1	d21c37a18fd866d07ff7a5e3341b22d1	pool/maemo4.1.2/free/x/xft/libxft2_2.1.12-2osso1_armel.deb
libxi6	2:1.1.0-2osso1	fe3fc44e92b46c03515bcfa38d73f7aa	pool/maemo4.1.2/free/libx/libxi/libxi6_1.1.0-2osso1_armel.deb
libxml2	2.6.27.dfsg-1osso4	9045ca711d1f2ea4ed6ba7866af1a080	pool/maemo4.1.2/free/libx/libxml2/libxml2_2.6.27.dfsg-1osso4_armel.deb
libxml2-dev	2.6.27.dfsg-1osso4	e8ddf4caa8048ea26f894625ff89dfde	pool/maemo4.1.2/free/libx/libxml2/libxml2-dev_2.6.27.dfsg-1osso4_armel.deb
libxrandr2	2:1.2.1-1	2f534d81ceb1bf51e78cf6ffad26a1ef	pool/maemo4.1.2/free/libx/libxrandr/libxrandr2_1.2.1-1_armel.deb
libxrender-dev	1:0.9.2-1osso1	e3d090e98f39bbefff64d6b1de6fd823	pool/maemo4.1.2/free/libx/libxrender/libxrender-dev_0.9.2-1osso1_armel.deb
libxrender1	1:0.9.2-1osso1	5f6ec3183e7acd45c0b9442f3b350af4	pool/maemo4.1.2/free/libx/libxrender/libxrender1_0.9.2-1osso1_armel.deb
libxtst6	1:1.0.1-5osso1	bbdf774cc7407e2cf683979eb8d57764	pool/maemo4.1.2/free/libx/libxtst/libxtst6_1.0.1-5osso1_armel.deb
osso-esd	0.52-14	d6d5564fa559cee09df4ac8289fed45a	pool/maemo4.1.2/free/o/osso-esd/osso-esd_0.52-14_armel.deb
pkg-config	0.21-1	1d45a8daa963f0af72680a446b22f037	pool/maemo4.1.2/free/p/pkg-config/pkg-config_0.21-1_armel.deb
shared-mime-info	0.19-1	0cad57515e3f0c376cc4879659aef958	pool/maemo4.1.2/free/s/shared-mime-info/shared-mime-info_0.19-1_armel.deb
x11-common	1:7.0.14osso1	ab890c893c34a09d82ab114bf512b6d6	pool/maemo4.1.2/free/x/xorg/x11-common_7.0.14osso1_armel.deb
x11proto-core-dev	7.0.10-2osso1	06a63adbfedc111ab8d1835133885cd7	pool/maemo4.1.2/free/x/x11proto-core/x11proto-core-dev_7.0.10-2osso1_all.deb
x11proto-input-dev	1.4.1-2osso1	1fb6e80a162386a7032caaf0ab63ae3b	pool/maemo4.1.2/free/x/x11proto-input/x11proto-input-dev_1.4.1-2osso1_all.deb
x11proto-kb-dev	1.0.3-2	cab45375759c2065eec06029c0bf68d2	pool/maemo4.1.2/free/x/x11proto-kb/x11proto-kb-dev_1.0.3-2_all.deb
x11proto-render-dev	2:0.9.2-4	66b6841d53756e5b842bcf1e5a1a5806	pool/maemo4.1.2/free/x/x11proto-render/x11proto-render-dev_0.9.2-4_all.deb
x11proto-xext-dev	7.0.2-5	4e34cd7968efb6bcb3b744acd901313b	pool/maemo4.1.2/free/x/x11proto-xext/x11proto-xext-dev_7.0.2-5_all.deb
xtrans-dev	1.0.3-2osso1	cf41e0874c108f6464146e8776b4614e	pool/maemo4.1.2/free/x/xtrans/xtrans-dev_1.0.3-2osso1_all.deb
```

Check the file: `grep -vc '^#' devhost/sysroot-gtk.manifest` must print `82`, and `awk -F'\t' '!/^#/ && NF != 4' devhost/sysroot-gtk.manifest` must print nothing.

- [ ] **Step 3: Write the dev image**

Create `maemo-react/devhost/Dockerfile`:

```dockerfile
# The maemo-react dev image: the desktop toolchain (GTK 2.24, curl), the Diablo
# cross toolchain, qemu-user and qemu-system-arm, and a virtual X server.
# Ubuntu 24.04 is pinned: it still ships libgtk2.0-dev, and qemu 8.2 still
# has the n810 machine (removed in qemu 9.2).
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      build-essential pkg-config libgtk2.0-dev libcurl4-openssl-dev \
      gcc-arm-linux-gnueabi binutils-arm-linux-gnueabi \
      qemu-user qemu-system-arm mtd-utils socat \
      xvfb x11vnc xauth procps \
      dpkg-dev python3 openssl curl ca-certificates file perl \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 4: Write run.sh**

Create `maemo-react/devhost/run.sh` and make it executable (`chmod +x`):

```bash
#!/usr/bin/env bash
# Run a command in the maemo-react dev container.
#
#   devhost/run.sh 'runtime/build.sh desktop'
#
# The container sees the repository at /repo and the n810-build volume at
# /work (the Diablo sysroot, the n810-modern curl build, the emulator). It
# starts in /repo/maemo-react. The image is built once from devhost/Dockerfile.
# Set PORTS, for example PORTS='-p 127.0.0.1:5902:5902', to publish a port.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
IMAGE="${IMAGE:-maemo-react-dev}"
VOLUME="${VOLUME:-n810-build}"
PORTS="${PORTS:-}"

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
docker volume inspect "$VOLUME" >/dev/null 2>&1 ||
  { echo "no '$VOLUME' volume -- run tools/build-in-docker.sh first"; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
  docker build -q -t "$IMAGE" "$HERE" >/dev/null

TTY=""
[ -t 0 ] && [ -t 1 ] && TTY="-t"
# shellcheck disable=SC2086  # PORTS and TTY are empty or whole options
exec docker run --rm -i $TTY $PORTS \
  -v "$VOLUME:/work" -v "$REPO:/repo" -w /repo/maemo-react \
  "$IMAGE" bash -c "$*"
```

- [ ] **Step 5: Write check-env.sh**

Create `maemo-react/devhost/check-env.sh` and make it executable:

```bash
#!/usr/bin/env bash
# Check that the dev container has what the maemo-react build needs.
# Run it inside the container: devhost/run.sh devhost/check-env.sh
set -uo pipefail
fail=0
need() { # description, then a command that must succeed
  local what="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "ok    $what"; else echo "MISSING $what"; fail=1; fi
}
S=/work/sysroot-diablo
need "cross compiler"            command -v arm-linux-gnueabi-gcc
need "qemu-user"                 command -v qemu-arm
need "qemu-system-arm with n810" sh -c 'qemu-system-arm -M help | grep -q "^n810"'
need "Xvfb"                      command -v Xvfb
need "desktop GTK 2"             pkg-config --exists gtk+-2.0
need "desktop libcurl"           pkg-config --exists libcurl
need "Diablo glibc"              test -f $S/lib/libc.so.6
need "Diablo GTK headers"        test -f $S/usr/include/gtk-2.0/gtk/gtk.h
need "Diablo Hildon headers"     test -f $S/usr/include/hildon-1/hildon/hildon-window.h
need "Diablo GTK library"        test -e $S/usr/lib/libgtk-x11-2.0.so
need "Diablo Hildon library"     test -e $S/usr/lib/libhildon-1.so
need "n810-modern curl headers"  test -f /work/out/opt/n810-modern/include/curl/curl.h
need "n810-modern libcurl"       test -e /work/out/opt/n810-modern/lib/libcurl.so
need "emulator kernel"           sh -c 'ls /work/emulator/unpacked/kernel_* >/dev/null'
need "emulator stock root fs"    test -d /work/emulator/rootfs.clean
need "emulator stock initfs"     test -f /work/emulator/stock-initfs.jffs2
exit $fail
```

- [ ] **Step 6: Add the GTK packages to the sysroot and run the check**

Run on the development computer, from `maemo-react/`:

```bash
devhost/run.sh 'cd /work && MANIFEST=/repo/maemo-react/devhost/sysroot-gtk.manifest /repo/tools/mk-sysroot.sh /work/sysroot-diablo | tail -6'
devhost/run.sh devhost/check-env.sh
```

Expected: `mk-sysroot.sh` prints `cached` for each package (the volume has them) and ends with `==> Ready.` The check prints `ok` for every line and exits 0. If a line says `MISSING`, fix that item before you continue. The emulator items need `tools/mk-diablo-emulator.sh` and `STOCK=1 tools/emulator-gui-build.sh` in the volume.

- [ ] **Step 7: Write .gitignore and README.md**

Create `maemo-react/.gitignore`:

```
node_modules/
dist/
runtime/build/
runtime/test/generated/
typegen/build/
*.qbc
```

Create `maemo-react/README.md`:

````markdown
# maemo-react

React applications for Maemo 4.1 (Diablo) on the Nokia N800 and N810. The
applications draw native GTK 2 and Hildon widgets. See
`docs/specs/2026-10-06-maemo-react-design.md` for the design.

## Prerequisites

- Docker, and the `n810-build` volume from `tools/build-in-docker.sh`, with
  the emulator from `tools/mk-diablo-emulator.sh` and
  `STOCK=1 tools/emulator-gui-build.sh`.
- Node.js 22 or later on the development computer.

## Build and test

```sh
devhost/run.sh devhost/check-env.sh        # the environment is ready
npm install
npm run build:prelude
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo'
npm test                                    # JavaScript tests (Node)
devhost/run.sh 'runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

`devhost/run.sh` runs a command in the dev container. `diablo` builds for the
tablet and runs the tests under qemu-user with the Diablo libraries.
````

- [ ] **Step 8: Commit**

```bash
git add tools/mk-sysroot.sh maemo-react/devhost maemo-react/.gitignore maemo-react/README.md
git commit -m "Add the maemo-react dev environment

A dev image with both toolchains, qemu and Xvfb, a script that runs
commands in it, an environment check, and the GTK packages for the
Diablo sysroot."
```

---

### Task 2: QuickJS, the host skeleton and the test runner

**Files:**
- Create: `maemo-react/runtime/vendor/fetch-quickjs.sh`, `maemo-react/runtime/vendor/quickjs/` (generated, committed)
- Create: `maemo-react/runtime/build.sh`, `maemo-react/runtime/Makefile`, `maemo-react/runtime/check-glibc.sh`
- Create: `maemo-react/runtime/src/mr.h`, `src/main.c`, `src/loop.c`, `src/console.c`, `src/loader.c`, `src/app.c`
- Create: `maemo-react/runtime/test/run.sh`, `test/harness.js`, `test/app.test.js`, `test/no-display.sh`, `test/expect-fail/unhandled.js`

**Interfaces:**
- Consumes: `devhost/run.sh` (Task 1).
- Produces:
  - `runtime/build.sh desktop|diablo` → `runtime/build/<target>/bin/maemo-react-host`.
  - `maemo-react-host <module.js> [args...]` runs an ES module; `--test <module.js>` does the same and adds a 120 s timeout and fatal GTK criticals.
  - C API in `mr.h`: `JSValue mr_call(JSValueConst fn, JSValueConst this_val, int argc, JSValueConst *argv)` (returns an owned value, or `JS_UNDEFINED` after it reports an exception); `void mr_drain_jobs(void)`; `void mr_report_exception(JSContext *ctx)`; `void mr_quit(int code)`; `int mr_quit_requested(void)`; `int mr_exit_code(void)`; `double mr_now_ms(void)`; `void mr_register_module(const char *name, mr_module_init_fn init)` with `typedef JSModuleDef *(*mr_module_init_fn)(JSContext *ctx, const char *name)`; `int mr_run_module_file(JSContext *ctx, const char *path)`.
  - JS module `maemo:app`: `quit(code?: number): void`, `args: string[]` (the module path first), `version: string`, `platform: 'hildon' | 'desktop'`.
  - Test API in `runtime/test/harness.js`: `test(name, fn)`, `assert(cond, msg?)`, `assertEqual(actual, expected, msg?)` (compares `JSON.stringify` output), `assertThrows(fn, pattern, msg?)`, `assertRejects(promise, pattern, msg?)`, `async run()` (prints `ok`/`not ok` lines, then `quit(0|1)`).
  - `runtime/test/run.sh <target> [files...]` runs `test/*.test.js`, `test/generated/*.test.js`, `test/*.sh` and `test/expect-fail/*.js`.

- [ ] **Step 1: Vendor QuickJS**

Create `maemo-react/runtime/vendor/fetch-quickjs.sh` and make it executable:

```bash
#!/usr/bin/env bash
# Fetch QuickJS 2025-09-13, check it, and copy the files maemo-react needs
# into vendor/quickjs. Run it again only to move to a new QuickJS release.
set -euo pipefail
cd "$(dirname "$0")"
URL=https://bellard.org/quickjs/quickjs-2025-09-13-2.tar.xz
SHA256=996c6b5018fc955ad4d06426d0e9cb713685a00c825aa5c0418bd53f7df8b0b4
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/q.tar.xz" "$URL"
echo "$SHA256  $TMP/q.tar.xz" | sha256sum -c - >/dev/null
tar xJf "$TMP/q.tar.xz" -C "$TMP"
SRC="$TMP/quickjs-2025-09-13"
rm -rf quickjs && mkdir quickjs
for f in quickjs.c quickjs.h quickjs-atom.h quickjs-opcode.h libregexp.c \
         libregexp.h libregexp-opcode.h libunicode.c libunicode.h \
         libunicode-table.h cutils.c cutils.h dtoa.c dtoa.h list.h LICENSE VERSION; do
  cp "$SRC/$f" quickjs/
done
# Atomics need 64-bit ldrexd/strexd, which ARMv6 (the N810's ARM1136) lacks.
sed -i 's|^#define CONFIG_ATOMICS$|/* CONFIG_ATOMICS: off for ARMv6, see maemo-react/runtime/vendor/fetch-quickjs.sh */|' quickjs/quickjs.c
grep -q 'CONFIG_ATOMICS: off for ARMv6' quickjs/quickjs.c
echo "vendored QuickJS $(cat quickjs/VERSION)"
```

Run it in the container:

```bash
devhost/run.sh runtime/vendor/fetch-quickjs.sh
```

Expected: `vendored QuickJS 2025-09-13`.

- [ ] **Step 2: Write the build script, the Makefile and the glibc check**

Create `maemo-react/runtime/build.sh` (executable):

```bash
#!/usr/bin/env bash
# Build maemo-react-host for one target. Run it in the dev container.
#   runtime/build.sh desktop   native, GTK 2.24, for development and tests
#   runtime/build.sh diablo    Maemo 4.1 on ARMv6, glibc 2.5
set -euo pipefail
TARGET="${1:-desktop}"
shift || true
cd "$(dirname "$0")"
if [ "$TARGET" = diablo ]; then
  # tools/env.sh sets CC, CFLAGS and LDFLAGS for the sysroot, glibc 2.5 and
  # ARMv6. Its comments explain each flag.
  . ../../tools/env.sh /work/sysroot-diablo >/dev/null
  export PKG_CONFIG_LIBDIR=/work/sysroot-diablo/usr/lib/pkgconfig:/work/sysroot-diablo/usr/share/pkgconfig
  export PKG_CONFIG_SYSROOT_DIR=/work/sysroot-diablo
fi
exec make -j"$(nproc)" TARGET="$TARGET" "$@"
```

Create `maemo-react/runtime/Makefile`:

```make
# maemo-react-host. Use build.sh, which sets the compiler for the target.
TARGET ?= desktop
BUILD  := build/$(TARGET)
CC     ?= cc
CFLAGS ?= -O2

QJS         := vendor/quickjs
QJS_VERSION := $(shell cat $(QJS)/VERSION)
QJS_OBJ     := $(addprefix $(BUILD)/qjs/,quickjs.o libregexp.o libunicode.o cutils.o dtoa.o)
SRC         := $(wildcard src/*.c)
OBJ         := $(patsubst src/%.c,$(BUILD)/obj/%.o,$(SRC))
HOST        := $(BUILD)/bin/maemo-react-host

PKGS := gtk+-2.0
ifeq ($(TARGET),diablo)
PKGS        += hildon-1
DEFS        := -DMR_HILDON
CURL_CFLAGS := -I/work/out/opt/n810-modern/include
CURL_LIBS   := -L/work/out/opt/n810-modern/lib -lcurl \
               -Wl,-rpath-link,/work/out/opt/n810-modern/lib \
               -Wl,-rpath-link,/work/sysroot-diablo/usr/lib
else
DEFS        :=
CURL_CFLAGS := $(shell pkg-config --cflags libcurl)
CURL_LIBS   := $(shell pkg-config --libs libcurl)
endif
GTK_CFLAGS := $(shell pkg-config --cflags $(PKGS))
GTK_LIBS   := $(shell pkg-config --libs $(PKGS))

QJS_CFLAGS  := $(CFLAGS) -std=gnu11 -fwrapv -funsigned-char -D_GNU_SOURCE \
               -DCONFIG_VERSION=\"$(QJS_VERSION)\" -w
HOST_CFLAGS := $(CFLAGS) -std=gnu99 -Wall -Wno-unused-parameter -Wno-deprecated-declarations -D_GNU_SOURCE \
               -I$(QJS) -Isrc $(GTK_CFLAGS) $(CURL_CFLAGS) $(DEFS) \
               -DMR_QJS_VERSION=\"$(QJS_VERSION)\"

all: $(HOST)

$(BUILD)/qjs/%.o: $(QJS)/%.c
	@mkdir -p $(@D)
	$(CC) $(QJS_CFLAGS) -c $< -o $@

$(BUILD)/obj/%.o: src/%.c src/mr.h
	@mkdir -p $(@D)
	$(CC) $(HOST_CFLAGS) -c $< -o $@

$(HOST): $(OBJ) $(QJS_OBJ)
	@mkdir -p $(@D)
	$(CC) $(LDFLAGS) -o $@ $^ $(GTK_LIBS) $(CURL_LIBS) -lm -ldl -lpthread -lrt
ifeq ($(TARGET),diablo)
	./check-glibc.sh $@
endif

clean:
	rm -rf build

.PHONY: all clean
```

Create `maemo-react/runtime/check-glibc.sh` (executable):

```bash
#!/usr/bin/env bash
# Fail if a Diablo binary needs a glibc symbol newer than 2.5, or if its ABI
# tag is not 2.6.8. The tablet's loader refuses both (see tools/env.sh).
set -euo pipefail
BIN="$1"
vers=$(arm-linux-gnueabi-readelf -V "$BIN" | grep -o 'GLIBC_[0-9.]*' | sort -uV)
bad=$(echo "$vers" | awk -F_ '{ split($2, v, "."); if (v[1] > 2 || (v[1] == 2 && v[2] > 5)) print }')
[ -z "$bad" ] || { echo "$BIN needs $bad; the tablet has glibc 2.5"; exit 1; }
abi=$(arm-linux-gnueabi-readelf -n "$BIN" | awk '/OS: Linux, ABI:/ { print $NF }')
[ "$abi" = "2.6.8" ] || { echo "$BIN has ABI tag $abi; it must be 2.6.8"; exit 1; }
echo "$BIN: $(echo $vers | tr ' ' ','), ABI $abi: ok"
```

- [ ] **Step 3: Write the test harness, the first test and the runner**

Create `maemo-react/runtime/test/harness.js`:

```js
// A small test API for runtime tests. They run inside maemo-react-host.
import { quit } from 'maemo:app';

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed' + (msg ? ': ' + msg : ''));
}

export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

export function assertThrows(fn, pattern, msg) {
  try {
    fn();
  } catch (e) {
    const text = String(e && e.name) + ': ' + String(e && e.message);
    if (pattern && !pattern.test(text)) {
      throw new Error((msg ? msg + ': ' : '') + 'wrong error: ' + text);
    }
    return e;
  }
  throw new Error((msg ? msg + ': ' : '') + 'expected an exception');
}

export async function assertRejects(promise, pattern, msg) {
  try {
    await promise;
  } catch (e) {
    const text = String(e && e.name) + ': ' + String(e && e.message);
    if (pattern && !pattern.test(text)) {
      throw new Error((msg ? msg + ': ' : '') + 'wrong rejection: ' + text);
    }
    return e;
  }
  throw new Error((msg ? msg + ': ' : '') + 'expected a rejection');
}

export async function run() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('ok - ' + t.name);
    } catch (e) {
      failed++;
      console.log('not ok - ' + t.name + ': ' + ((e && e.stack) || e));
    }
  }
  console.log(failed ? 'FAIL ' + failed + ' of ' + tests.length : 'PASS ' + tests.length);
  quit(failed ? 1 : 0);
}
```

Create `maemo-react/runtime/test/app.test.js`:

```js
import { test, assert, assertEqual, run } from './harness.js';
import { args, version, platform } from 'maemo:app';

test('console.log prints a line', () => {
  console.log('hello from QuickJS');
});

test('maemo:app exports the version, the platform and the arguments', () => {
  assertEqual(version, '0.1.0');
  assert(platform === 'hildon' || platform === 'desktop', platform);
  assert(args[0].endsWith('app.test.js'), args[0]);
});

test('performance.now() does not go back', () => {
  const a = performance.now();
  let x = 0;
  for (let i = 0; i < 100000; i++) x += i;
  assert(performance.now() >= a && x > 0);
});

await run();
```

Create `maemo-react/runtime/test/no-display.sh` (executable). It covers Review Focus item 1:

```bash
#!/usr/bin/env bash
# The host must explain a missing display, and exit with code 1.
# HOST_RUN is set by test/run.sh: the command that starts the host.
set -uo pipefail
out=$(env -u DISPLAY $HOST_RUN test/app.test.js 2>&1); rc=$?
[ $rc -eq 1 ] || { echo "expected exit 1, got $rc: $out"; exit 1; }
echo "$out" | grep -q 'cannot open the display' || { echo "no message: $out"; exit 1; }
```

Create `maemo-react/runtime/test/expect-fail/unhandled.js`. Files in `expect-fail/` must exit with a non-zero code, and their output must contain the text after `// expect:` on the first line:

```js
// expect: Unhandled promise rejection: Error: nobody catches this
Promise.reject(new Error('nobody catches this'));
```

Create `maemo-react/runtime/test/run.sh` (executable):

```bash
#!/usr/bin/env bash
# Run the runtime tests for one target. Run it in the dev container.
#   runtime/test/run.sh desktop|diablo [file...]
# A *.test.js file passes when the host exits with 0 (harness.js does that).
# A *.sh file passes when it exits with 0; it gets HOST_RUN in its environment.
# An expect-fail/*.js file passes when the host exits non-zero and prints the
# text after "// expect:" on its first line.
set -uo pipefail
TARGET="${1:-desktop}"
shift || true
cd "$(dirname "$0")/.."
HOST=build/$TARGET/bin/maemo-react-host
[ -x "$HOST" ] || { echo "no $HOST -- run runtime/build.sh $TARGET"; exit 1; }

export DISPLAY=:99
pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 800x480x16 >/dev/null 2>&1 & sleep 1; }

if [ "$TARGET" = diablo ]; then
  HOST_RUN="qemu-arm -L /work/sysroot-diablo -E LD_LIBRARY_PATH=/work/out/opt/n810-modern/lib $PWD/$HOST"
else
  HOST_RUN="$PWD/$HOST"
fi
export HOST_RUN

FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then
  FILES=(test/*.test.js test/generated/*.test.js test/*.sh test/expect-fail/*.js)
fi

fail=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    *.sh)            out=$(timeout 300 bash "$f" 2>&1); rc=$? ;;
    */expect-fail/*) out=$(timeout 180 $HOST_RUN --test "$f" 2>&1); rc=$? ;;
    *)               out=$(timeout 180 $HOST_RUN --test "$f" 2>&1); rc=$? ;;
  esac
  case "$f" in
    */expect-fail/*)
      want=$(head -1 "$f" | sed -n 's|^// expect: ||p')
      if [ $rc -ne 0 ] && echo "$out" | grep -qF "$want"; then ok=1; else ok=0; fi ;;
    *) [ $rc -eq 0 ] && ok=1 || ok=0 ;;
  esac
  if [ $ok -eq 1 ]; then
    echo "PASS $f"
  else
    echo "FAIL $f (exit $rc)"
    echo "$out" | sed 's/^/    /'
    fail=1
  fi
done
exit $fail
```

- [ ] **Step 4: Run the tests and see them fail**

```bash
devhost/run.sh 'runtime/test/run.sh desktop'
```

Expected: `no build/desktop/bin/maemo-react-host -- run runtime/build.sh desktop`, exit code 1.

- [ ] **Step 5: Write mr.h**

Create `maemo-react/runtime/src/mr.h`:

```c
/* Shared declarations for maemo-react-host. */
#ifndef MR_H
#define MR_H

#include <glib.h>
#include "quickjs.h"

#define MR_VERSION "0.1.0"

#ifdef MR_HILDON
#define MR_PLATFORM "hildon"
#else
#define MR_PLATFORM "desktop"
#endif

extern JSRuntime *mr_rt;
extern JSContext *mr_ctx;
extern int mr_test_mode;

/* loop.c */
void mr_loop_init(JSRuntime *rt);
JSValue mr_call(JSValueConst fn, JSValueConst this_val, int argc, JSValueConst *argv);
void mr_drain_jobs(void);
void mr_report_exception(JSContext *ctx);
void mr_quit(int code);
int mr_quit_requested(void);
int mr_exit_code(void);

/* console.c */
void mr_console_init(JSContext *ctx);
double mr_now_ms(void);

/* loader.c */
typedef JSModuleDef *(*mr_module_init_fn)(JSContext *ctx, const char *name);
void mr_register_module(const char *name, mr_module_init_fn init);
void mr_loader_init(JSRuntime *rt);
int mr_run_module_file(JSContext *ctx, const char *path);

/* app.c */
void mr_app_set_args(int argc, char **argv);
JSModuleDef *mr_init_app(JSContext *ctx, const char *name);

#endif
```

- [ ] **Step 6: Write loop.c**

Create `maemo-react/runtime/src/loop.c`:

```c
/* Calls into JavaScript, the promise job queue, unhandled rejections and
   the exit code. */
#include <stdio.h>
#include <stdlib.h>
#include <gtk/gtk.h>
#include "mr.h"

static int call_depth;
static int exit_code;
static int quit_requested;

/* Rejections without a handler. A handler can still come later in the same
   job run, so we report only after the job queue is empty. */
typedef struct {
    JSValue promise;
    JSValue reason;
} Rejection;
static GPtrArray *rejections;

static void print_error(JSContext *ctx, const char *prefix, JSValueConst err)
{
    const char *msg = JS_ToCString(ctx, err);
    JSValue stack = JS_IsObject(err) ? JS_GetPropertyStr(ctx, err, "stack") : JS_UNDEFINED;
    const char *st = JS_IsString(stack) ? JS_ToCString(ctx, stack) : NULL;
    fprintf(stderr, "%s%s\n%s", prefix, msg ? msg : "(no message)", st ? st : "");
    fflush(stderr);
    if (st)
        JS_FreeCString(ctx, st);
    if (msg)
        JS_FreeCString(ctx, msg);
    JS_FreeValue(ctx, stack);
}

void mr_report_exception(JSContext *ctx)
{
    JSValue e = JS_GetException(ctx);
    print_error(ctx, "Uncaught ", e);
    JS_FreeValue(ctx, e);
    if (mr_test_mode)
        mr_quit(1);
}

static void on_rejection(JSContext *ctx, JSValueConst promise, JSValueConst reason,
                         JS_BOOL is_handled, void *opaque)
{
    guint i;
    if (!is_handled) {
        Rejection *r = g_new(Rejection, 1);
        r->promise = JS_DupValue(ctx, promise);
        r->reason = JS_DupValue(ctx, reason);
        g_ptr_array_add(rejections, r);
        return;
    }
    for (i = 0; i < rejections->len; i++) {
        Rejection *r = g_ptr_array_index(rejections, i);
        if (JS_VALUE_GET_PTR(r->promise) == JS_VALUE_GET_PTR(promise)) {
            JS_FreeValue(ctx, r->promise);
            JS_FreeValue(ctx, r->reason);
            g_free(r);
            g_ptr_array_remove_index(rejections, i);
            return;
        }
    }
}

static void report_rejections(void)
{
    while (rejections->len > 0) {
        Rejection *r = g_ptr_array_index(rejections, 0);
        g_ptr_array_remove_index(rejections, 0);
        print_error(mr_ctx, "Unhandled promise rejection: ", r->reason);
        JS_FreeValue(mr_ctx, r->promise);
        JS_FreeValue(mr_ctx, r->reason);
        g_free(r);
        if (mr_test_mode)
            mr_quit(1);
    }
}

void mr_loop_init(JSRuntime *rt)
{
    rejections = g_ptr_array_new();
    JS_SetHostPromiseRejectionTracker(rt, on_rejection, NULL);
}

/* Run the queued promise jobs, but only when no JavaScript is on the stack:
   a job must not run inside another call. */
void mr_drain_jobs(void)
{
    JSContext *c;
    int r;
    if (call_depth > 0)
        return;
    call_depth++;
    while ((r = JS_ExecutePendingJob(mr_rt, &c)) != 0)
        if (r < 0)
            mr_report_exception(c);
    call_depth--;
    report_rejections();
}

JSValue mr_call(JSValueConst fn, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JSValue r;
    call_depth++;
    r = JS_Call(mr_ctx, fn, this_val, argc, argv);
    call_depth--;
    if (JS_IsException(r)) {
        mr_report_exception(mr_ctx);
        r = JS_UNDEFINED;
    }
    mr_drain_jobs();
    return r;
}

void mr_quit(int code)
{
    if (!quit_requested)
        exit_code = code;
    quit_requested = 1;
    if (gtk_main_level() > 0)
        gtk_main_quit();
}

int mr_quit_requested(void) { return quit_requested; }
int mr_exit_code(void) { return exit_code; }
```

- [ ] **Step 7: Write console.c and app.c**

Create `maemo-react/runtime/src/console.c`:

```c
/* console.* and performance.now(). These print strings only. The prelude
   (Task 8) replaces console.* with versions that format objects. */
#include <stdio.h>
#include <time.h>
#include "mr.h"

static double start_ms;

double mr_now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

static JSValue print_to(FILE *f, JSContext *ctx, int argc, JSValueConst *argv)
{
    int i;
    for (i = 0; i < argc; i++) {
        const char *s = JS_ToCString(ctx, argv[i]);
        fprintf(f, "%s%s", i ? " " : "", s ? s : "");
        if (s)
            JS_FreeCString(ctx, s);
    }
    fputc('\n', f);
    fflush(f);
    return JS_UNDEFINED;
}

static JSValue js_out(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return print_to(stdout, ctx, argc, argv);
}

static JSValue js_err(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return print_to(stderr, ctx, argc, argv);
}

static JSValue js_now(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return JS_NewFloat64(ctx, mr_now_ms() - start_ms);
}

void mr_console_init(JSContext *ctx)
{
    JSValue g = JS_GetGlobalObject(ctx);
    JSValue con = JS_NewObject(ctx);
    JSValue perf = JS_NewObject(ctx);
    start_ms = mr_now_ms();
    JS_SetPropertyStr(ctx, con, "log", JS_NewCFunction(ctx, js_out, "log", 1));
    JS_SetPropertyStr(ctx, con, "info", JS_NewCFunction(ctx, js_out, "info", 1));
    JS_SetPropertyStr(ctx, con, "debug", JS_NewCFunction(ctx, js_out, "debug", 1));
    JS_SetPropertyStr(ctx, con, "warn", JS_NewCFunction(ctx, js_err, "warn", 1));
    JS_SetPropertyStr(ctx, con, "error", JS_NewCFunction(ctx, js_err, "error", 1));
    JS_SetPropertyStr(ctx, g, "console", con);
    JS_SetPropertyStr(ctx, perf, "now", JS_NewCFunction(ctx, js_now, "now", 0));
    JS_SetPropertyStr(ctx, g, "performance", perf);
    JS_FreeValue(ctx, g);
}
```

Create `maemo-react/runtime/src/app.c`:

```c
/* maemo:app -- quit(code), args, version, platform. */
#include "mr.h"

static int app_argc;
static char **app_argv;

void mr_app_set_args(int argc, char **argv)
{
    app_argc = argc;
    app_argv = argv;
}

static JSValue js_quit(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    int32_t code = 0;
    if (argc > 0 && !JS_IsUndefined(argv[0]) && JS_ToInt32(ctx, &code, argv[0]))
        return JS_EXCEPTION;
    mr_quit(code);
    return JS_UNDEFINED;
}

static const JSCFunctionListEntry app_funcs[] = {
    JS_CFUNC_DEF("quit", 1, js_quit),
    JS_PROP_STRING_DEF("version", MR_VERSION, 0),
    JS_PROP_STRING_DEF("platform", MR_PLATFORM, 0),
};

static int app_init(JSContext *ctx, JSModuleDef *m)
{
    JSValue args = JS_NewArray(ctx);
    int i;
    for (i = 0; i < app_argc; i++)
        JS_SetPropertyUint32(ctx, args, i, JS_NewString(ctx, app_argv[i]));
    JS_SetModuleExport(ctx, m, "args", args);
    return JS_SetModuleExportList(ctx, m, app_funcs, G_N_ELEMENTS(app_funcs));
}

JSModuleDef *mr_init_app(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, app_init);
    if (!m)
        return NULL;
    JS_AddModuleExportList(ctx, m, app_funcs, G_N_ELEMENTS(app_funcs));
    JS_AddModuleExport(ctx, m, "args");
    return m;
}
```

- [ ] **Step 8: Write loader.c**

Create `maemo-react/runtime/src/loader.c`:

```c
/* ES module loading: maemo:* native modules, and modules from files.
   QuickJS's default normalizer keeps "maemo:http" as it is and resolves
   "./x.js" against the importing module. */
#include <string.h>
#include "mr.h"

#define MAX_MODULES 32

static struct {
    const char *name;
    mr_module_init_fn init;
} registry[MAX_MODULES];
static int n_registry;

void mr_register_module(const char *name, mr_module_init_fn init)
{
    g_assert(n_registry < MAX_MODULES);
    registry[n_registry].name = name;
    registry[n_registry].init = init;
    n_registry++;
}

/* Compile a file as a module. Returns the module function, or JS_EXCEPTION. */
static JSValue compile_file(JSContext *ctx, const char *path)
{
    gchar *src;
    gsize len;
    GError *err = NULL;
    JSValue fn;
    if (!g_file_get_contents(path, &src, &len, &err)) {
        JS_ThrowReferenceError(ctx, "could not load module '%s': %s", path, err->message);
        g_error_free(err);
        return JS_EXCEPTION;
    }
    fn = JS_Eval(ctx, src, len, path, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    g_free(src);
    return fn;
}

static JSModuleDef *load_module(JSContext *ctx, const char *name, void *opaque)
{
    JSValue fn;
    JSModuleDef *m;
    int i;
    for (i = 0; i < n_registry; i++)
        if (!strcmp(registry[i].name, name))
            return registry[i].init(ctx, name);
    if (!strncmp(name, "maemo:", 6)) {
        JS_ThrowReferenceError(ctx, "unknown native module '%s'", name);
        return NULL;
    }
    fn = compile_file(ctx, name);
    if (JS_IsException(fn))
        return NULL;
    /* The runtime keeps the module definition; the function value can go. */
    m = JS_VALUE_GET_PTR(fn);
    JS_FreeValue(ctx, fn);
    return m;
}

void mr_loader_init(JSRuntime *rt)
{
    JS_SetModuleLoaderFunc(rt, NULL, load_module, NULL);
}

/* Link and evaluate a compiled module. Takes ownership of fn. Returns 0, or
   -1 if evaluation threw or its promise was rejected. */
static int eval_module(JSContext *ctx, JSValue fn)
{
    JSValue ret;
    int state;
    if (JS_ResolveModule(ctx, fn) < 0) {
        JS_FreeValue(ctx, fn);
        mr_report_exception(ctx);
        return -1;
    }
    ret = JS_EvalFunction(ctx, fn);
    if (JS_IsException(ret)) {
        mr_report_exception(ctx);
        return -1;
    }
    mr_drain_jobs();
    /* A module returns a promise (top-level await). If it is rejected, the
       rejection tracker in loop.c has reported it already. */
    state = JS_PromiseState(ctx, ret);
    JS_FreeValue(ctx, ret);
    return state == JS_PROMISE_REJECTED ? -1 : 0;
}

int mr_run_module_file(JSContext *ctx, const char *path)
{
    JSValue fn = compile_file(ctx, path);
    if (JS_IsException(fn)) {
        mr_report_exception(ctx);
        return -1;
    }
    return eval_module(ctx, fn);
}
```

- [ ] **Step 9: Write main.c**

Create `maemo-react/runtime/src/main.c`:

```c
/* maemo-react-host: runs a React application module on GTK. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <gtk/gtk.h>
#include "mr.h"

JSRuntime *mr_rt;
JSContext *mr_ctx;
int mr_test_mode;

static void usage(void)
{
    fprintf(stderr,
            "usage: maemo-react-host <module.js> [args...]\n"
            "       maemo-react-host --test <module.js> [args...]\n");
    exit(2);
}

static gboolean test_timeout(gpointer data)
{
    fprintf(stderr, "TIMEOUT: the test did not call quit() in 120 s\n");
    exit(124);
    return FALSE;
}

int main(int argc, char **argv)
{
    int first = 1;

    if (argc < 2)
        usage();
    if (!strcmp(argv[1], "--test")) {
        mr_test_mode = 1;
        first = 2;
    }
    if (first >= argc)
        usage();

    if (!gtk_init_check(&argc, &argv)) {
        fprintf(stderr, "maemo-react-host: cannot open the display. "
                        "Set DISPLAY=:0, or start the application on the tablet.\n");
        return 1;
    }
    if (mr_test_mode) {
        /* In tests, a GTK critical warning is a failure. */
        g_log_set_always_fatal(G_LOG_LEVEL_CRITICAL);
        g_timeout_add(120000, test_timeout, NULL);
    }

    mr_rt = JS_NewRuntime();
    JS_SetMaxStackSize(mr_rt, 1024 * 1024);
    mr_ctx = JS_NewContext(mr_rt);
    mr_loop_init(mr_rt);
    mr_console_init(mr_ctx);
    mr_loader_init(mr_rt);
    mr_register_module("maemo:app", mr_init_app);
    mr_app_set_args(argc - first, argv + first);

    if (mr_run_module_file(mr_ctx, argv[first]) < 0)
        return 1;
    if (!mr_quit_requested())
        gtk_main();
    /* Do not free the runtime: closures that GTK still holds keep JS
       objects, and JS_FreeRuntime asserts that none are left. */
    return mr_exit_code();
}
```

- [ ] **Step 10: Build both targets and run the tests**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: the diablo build prints `build/diablo/bin/maemo-react-host: GLIBC_2.4,...: ok` (only versions up to 2.5), then for each target:

```
PASS test/app.test.js
PASS test/no-display.sh
PASS test/expect-fail/unhandled.js
```

If `test/app.test.js` fails under diablo with `cannot open the display`, Xvfb did not start: run `devhost/run.sh 'Xvfb :99 & sleep 1; DISPLAY=:99 xdpyinfo'` to see why.

- [ ] **Step 11: Commit**

```bash
git add maemo-react/runtime
git commit -m "Add the maemo-react host skeleton

QuickJS 2025-09-13 with Atomics off, a host that runs an ES module on
the GTK main loop, maemo:app, rejection tracking, and a test runner for
the desktop and Diablo targets."
```

---

### Task 3: The emulator runner

**Files:**
- Create: `maemo-react/devhost/emulator-run.sh`
- Create: `maemo-react/runtime/test/emulator/hello.js`

**Interfaces:**
- Consumes: `/work/emulator` in the volume (rootfs.clean, the stock kernel, stock-initfs.jffs2); `runtime/build/diablo/bin/maemo-react-host` (Task 2).
- Produces: `devhost/emulator-run.sh <dir> '<command>'`. Environment: `MR_DEBS` (space-separated `.deb` paths inside the container, installed with `dpkg -i` before the command), `SHOT=<file.png>` (takes a screenshot 20 s after the command starts, then stops the command), `TIMEOUT` (seconds, default 1500). It prints the command output between `MR-BEGIN` and `MR-END rc=<n>`, and exits with the command's exit code. Task 16 uses it.

- [ ] **Step 1: Write the test program**

Create `maemo-react/runtime/test/emulator/hello.js`:

```js
import { quit, platform } from 'maemo:app';
console.log('hello from the tablet, platform ' + platform);
quit(0);
```

- [ ] **Step 2: Write emulator-run.sh**

Create `maemo-react/devhost/emulator-run.sh` (executable):

```bash
#!/usr/bin/env bash
# Boot the stock Diablo emulator once, run a command on its desktop, print
# the output, and stop.
#
#   devhost/emulator-run.sh <dir> '<command>'
#
# <dir> is copied to /home/user/mr in a throwaway copy of the stock root file
# system. <command> runs there as root, with DISPLAY=:0 and HOME=/home/user,
# 120 s after hildon-desktop starts. The n810-modern libraries (curl,
# OpenSSL) go to /opt/n810-modern/lib, as n810-modern-tls installs them.
#
#   MR_DEBS="a.deb b.deb"   install these with dpkg -i first, in this order
#   SHOT=out.png            screenshot 20 s after the command starts; the
#                           command runs in the background and is stopped
#   TIMEOUT=1500            seconds before the script gives up
#
# Run one QEMU at a time: several starve the emulated DMA controller.
set -euo pipefail
SRC="$(cd "$1" && pwd)"
CMD="$2"
TIMEOUT="${TIMEOUT:-1500}"
W=/work/emulator
T=$W/rootfs.mr
LOG=$W/mr-serial.log
MON=$W/mr-monitor.sock

rm -rf "$T" && cp -a "$W/rootfs.clean" "$T"
mkdir -p "$T/home/user/mr" "$T/opt/n810-modern" "$T/var/cache/mr-debs"
cp -a "$SRC/." "$T/home/user/mr/"
cp -a /work/out/opt/n810-modern/lib "$T/opt/n810-modern/"
# A number in front of each name keeps the order of MR_DEBS: dpkg -i installs
# them one by one, so a dependency must come first.
i=0
for d in ${MR_DEBS:-}; do i=$((i + 1)); cp "$d" "$T/var/cache/mr-debs/$(printf %02d $i)-$(basename "$d")"; done

BG=0; [ -n "${SHOT:-}" ] && BG=1
cat > "$T/home/user/mr/.suite.sh" <<SUITE
#!/bin/sh
exec >/dev/console 2>&1
i=0
while ! pidof hildon-desktop >/dev/null 2>&1; do sleep 5; i=\$((i+1)); [ \$i -gt 200 ] && break; done
sleep 120
. /etc/osso-af-init/af-defines.sh 2>/dev/null
export DISPLAY=:0 HOME=/home/user
echo MR-BEGIN
for d in /var/cache/mr-debs/*.deb; do [ -f "\$d" ] && dpkg -i "\$d"; done
cd /home/user/mr
if [ $BG -eq 1 ]; then
  ( $CMD ) & p=\$!
  sleep 20; echo MR-SHOT; sleep 10
  kill \$p 2>/dev/null; rc=0
else
  ( $CMD ); rc=\$?
fi
echo "MR-END rc=\$rc"
sync
poweroff -f
SUITE
chmod 755 "$T/home/user/mr/.suite.sh"
printf '/home/user/mr/.suite.sh &\nexit 0\n' > "$T/etc/rc2.d/S99zzzmr"
chmod 755 "$T/etc/rc2.d/S99zzzmr"

mkfs.jffs2 -r "$T" -o "$W/mr-rootfs.jffs2" -e 0x20000 -l -n -p
KERNEL=$(ls $W/unpacked/kernel_* | head -1)
MAIN=$((256 * 1024 * 1024)); TOTAL=$((MAIN + MAIN / 32))
head -c "$TOTAL" /dev/zero | tr '\000' '\377' > "$W/mr.img"
for spec in "$KERNEL:$((0x80000))" "$W/stock-initfs.jffs2:$((0x2a0000))" "$W/mr-rootfs.jffs2:$((0x6a0000))"; do
  f=${spec%:*}; off=${spec##*:}
  dd if="$f" of="$W/mr.img" bs=1M oflag=seek_bytes seek="$off" conv=notrunc status=none
done
rm -rf "$T"
rm -f "$LOG" "$MON"

qemu-system-arm -M n810 -m 128 -kernel "$KERNEL" \
  -drive "file=$W/mr.img,format=raw,if=mtd" \
  -append "console=ttyS0,115200n8 root=/dev/mtdblock3 rootfstype=jffs2 rw init=/linuxrc" \
  -serial "file:$LOG" -display none \
  -monitor "unix:$MON,server,nowait" -no-reboot &
QPID=$!

shot_done=0
for _ in $(seq 1 "$TIMEOUT"); do
  sleep 1
  if [ -n "${SHOT:-}" ] && [ $shot_done -eq 0 ] && grep -q '^MR-SHOT' "$LOG" 2>/dev/null; then
    echo "screendump /tmp/mr-shot.ppm" | socat - "UNIX-CONNECT:$MON" >/dev/null
    sleep 2
    python3 - "$SHOT" <<'PY'
import sys, struct, zlib
data = open('/tmp/mr-shot.ppm', 'rb').read()
parts = data.split(b'\n', 3)
w, h = map(int, parts[1].split())
pix = parts[3]
rows = b''.join(b'\x00' + pix[y * w * 3:(y + 1) * w * 3] for y in range(h))
def chunk(t, b): return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b))
open(sys.argv[1], 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
PY
    shot_done=1
  fi
  grep -q '^MR-END' "$LOG" 2>/dev/null && break
  kill -0 $QPID 2>/dev/null || break
done
sleep 2
kill $QPID 2>/dev/null || true
wait $QPID 2>/dev/null || true

sed -n '/^MR-BEGIN/,/^MR-END/p' "$LOG"
rc=$(sed -n 's/^MR-END rc=//p' "$LOG")
[ -n "$rc" ] || { echo "the emulator did not reach MR-END in $TIMEOUT s"; exit 1; }
exit "$rc"
```

- [ ] **Step 3: Run hello.js in the emulator**

```bash
devhost/run.sh 'mkdir -p /tmp/em && cp runtime/build/diablo/bin/maemo-react-host runtime/test/emulator/hello.js /tmp/em/ && devhost/emulator-run.sh /tmp/em "./maemo-react-host hello.js"'
```

Expected, after about 5 minutes:

```
MR-BEGIN
hello from the tablet, platform hildon
MR-END rc=0
```

This meets the M0 condition "in the emulator" (spec section 13).

- [ ] **Step 4: Commit**

```bash
git add maemo-react/devhost/emulator-run.sh maemo-react/runtime/test/emulator
git commit -m "Add a runner that boots the Diablo emulator for one command"
```

---

### Task 4: Timers

**Files:**
- Modify: `maemo-react/runtime/src/mr.h` (add one declaration)
- Modify: `maemo-react/runtime/src/loop.c` (add the timer code at the end)
- Modify: `maemo-react/runtime/src/main.c` (call `mr_timers_init`)
- Test: `maemo-react/runtime/test/timers.test.js`

**Interfaces:**
- Consumes: `mr_call`, `mr_ctx` (Task 2).
- Produces: globals `setTimeout(fn, ms?, ...args): number`, `setInterval(fn, ms?, ...args): number`, `clearTimeout(id)`, `clearInterval(id)`. A timer callback runs through `mr_call`, so promise jobs run after it. `void mr_timers_init(JSContext *ctx)` in `mr.h`.

- [ ] **Step 1: Write the failing test**

Create `maemo-react/runtime/test/timers.test.js`:

```js
import { test, assert, assertEqual, assertThrows, run } from './harness.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('setTimeout runs once after the delay', async () => {
  const t0 = performance.now();
  let n = 0;
  setTimeout(() => n++, 20);
  await sleep(80);
  assertEqual(n, 1);
  assert(performance.now() - t0 >= 20);
});

test('setTimeout gives the extra arguments to the callback', async () => {
  let got;
  setTimeout((a, b) => { got = [a, b]; }, 0, 'x', 2);
  await sleep(20);
  assertEqual(got, ['x', 2]);
});

test('clearTimeout stops a timer', async () => {
  let n = 0;
  const id = setTimeout(() => n++, 10);
  clearTimeout(id);
  await sleep(40);
  assertEqual(n, 0);
});

test('setInterval repeats until clearInterval in its own callback', async () => {
  let n = 0;
  const id = setInterval(() => { if (++n === 3) clearInterval(id); }, 5);
  await sleep(150);
  assertEqual(n, 3);
});

test('a shorter delay fires first', async () => {
  const seen = [];
  setTimeout(() => seen.push(30), 30);
  setTimeout(() => seen.push(10), 10);
  await sleep(80);
  assertEqual(seen, [10, 30]);
});

test('promise jobs run before the next timer', async () => {
  const seen = [];
  setTimeout(() => seen.push('timer'), 0);
  Promise.resolve().then(() => seen.push('job'));
  await sleep(30);
  assertEqual(seen, ['job', 'timer']);
});

test('the clear functions ignore unknown ids', () => {
  clearTimeout(123456);
  clearInterval(undefined);
  clearTimeout('x');
});

test('setTimeout needs a function', () => {
  assertThrows(() => setTimeout('code', 1), /TypeError: setTimeout/);
});

await run();
```

- [ ] **Step 2: Run it to see it fail**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/test/run.sh desktop test/timers.test.js'
```

Expected: `FAIL test/timers.test.js` with `ReferenceError: setTimeout is not defined`.

- [ ] **Step 3: Add the timers**

Add this declaration to `mr.h`, after `int mr_exit_code(void);`:

```c
void mr_timers_init(JSContext *ctx);
```

Append to `maemo-react/runtime/src/loop.c`:

```c
/* ---- setTimeout, setInterval, clearTimeout, clearInterval ---- */

typedef struct {
    int id;
    guint source;
    JSValue fn;
    JSValue *args;
    int argc;
    gboolean repeat;
    gboolean firing;    /* the callback runs now */
    gboolean cancelled; /* cleared during its own callback */
} Timer;

static GHashTable *timers; /* id -> Timer */
static int next_timer_id = 1;

/* GLib calls this when the source goes away; it is the only place that
   frees a timer. */
static void timer_destroy(gpointer data)
{
    Timer *t = data;
    int i;
    g_hash_table_remove(timers, GINT_TO_POINTER(t->id));
    JS_FreeValue(mr_ctx, t->fn);
    for (i = 0; i < t->argc; i++)
        JS_FreeValue(mr_ctx, t->args[i]);
    g_free(t->args);
    g_free(t);
}

static gboolean timer_fire(gpointer data)
{
    Timer *t = data;
    JSValue r;
    t->firing = TRUE;
    r = mr_call(t->fn, JS_UNDEFINED, t->argc, (JSValueConst *)t->args);
    JS_FreeValue(mr_ctx, r);
    t->firing = FALSE;
    return t->repeat && !t->cancelled;
}

static JSValue add_timer(JSContext *ctx, int argc, JSValueConst *argv, gboolean repeat)
{
    Timer *t;
    double ms = 0;
    int i;
    if (argc < 1 || !JS_IsFunction(ctx, argv[0]))
        return JS_ThrowTypeError(ctx, "%s: the first argument must be a function",
                                 repeat ? "setInterval" : "setTimeout");
    if (argc > 1 && JS_ToFloat64(ctx, &ms, argv[1]))
        return JS_EXCEPTION;
    if (!(ms >= 0))
        ms = 0; /* negative or NaN */
    if (ms > G_MAXINT)
        ms = G_MAXINT;
    if (repeat && ms < 1)
        ms = 1; /* an interval of 0 would keep the CPU busy */
    t = g_new0(Timer, 1);
    t->id = next_timer_id++;
    t->fn = JS_DupValue(ctx, argv[0]);
    t->repeat = repeat;
    t->argc = argc > 2 ? argc - 2 : 0;
    t->args = g_new(JSValue, t->argc ? t->argc : 1);
    for (i = 0; i < t->argc; i++)
        t->args[i] = JS_DupValue(ctx, argv[i + 2]);
    g_hash_table_insert(timers, GINT_TO_POINTER(t->id), t);
    t->source = g_timeout_add_full(G_PRIORITY_DEFAULT, (guint)ms, timer_fire, t, timer_destroy);
    return JS_NewInt32(ctx, t->id);
}

static JSValue js_set_timeout(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return add_timer(ctx, argc, argv, FALSE);
}

static JSValue js_set_interval(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return add_timer(ctx, argc, argv, TRUE);
}

static JSValue js_clear_timer(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    int32_t id;
    Timer *t;
    /* Like browsers: an id that is not a known timer does nothing. */
    if (argc < 1 || !JS_IsNumber(argv[0]) || JS_ToInt32(ctx, &id, argv[0]))
        return JS_UNDEFINED;
    t = g_hash_table_lookup(timers, GINT_TO_POINTER(id));
    if (!t)
        return JS_UNDEFINED;
    if (t->firing)
        t->cancelled = TRUE; /* timer_fire returns FALSE; GLib then frees it */
    else
        g_source_remove(t->source);
    return JS_UNDEFINED;
}

void mr_timers_init(JSContext *ctx)
{
    JSValue g = JS_GetGlobalObject(ctx);
    timers = g_hash_table_new(g_direct_hash, g_direct_equal);
    JS_SetPropertyStr(ctx, g, "setTimeout", JS_NewCFunction(ctx, js_set_timeout, "setTimeout", 2));
    JS_SetPropertyStr(ctx, g, "setInterval", JS_NewCFunction(ctx, js_set_interval, "setInterval", 2));
    JS_SetPropertyStr(ctx, g, "clearTimeout", JS_NewCFunction(ctx, js_clear_timer, "clearTimeout", 1));
    JS_SetPropertyStr(ctx, g, "clearInterval", JS_NewCFunction(ctx, js_clear_timer, "clearInterval", 1));
    JS_FreeValue(ctx, g);
}
```

In `main.c`, after `mr_console_init(mr_ctx);`, add:

```c
    mr_timers_init(mr_ctx);
```

- [ ] **Step 4: Run all runtime tests on both targets**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: every line is `PASS`, including `PASS test/timers.test.js` for both targets.

- [ ] **Step 5: Commit**

```bash
git add maemo-react/runtime/src maemo-react/runtime/test/timers.test.js
git commit -m "Add timers to the maemo-react host"
```

---

### Task 5: The bytecode cache, and React 19 on QuickJS

**Files:**
- Create: `maemo-react/runtime/src/bytecode.c`
- Modify: `maemo-react/runtime/src/mr.h`, `src/loader.c`, `src/main.c`
- Create: `maemo-react/package.json`
- Create: `maemo-react/runtime/test/build-bundles.mjs`, `maemo-react/runtime/test/bundles/react19.jsx`
- Test: `maemo-react/runtime/test/bytecode.sh`, `maemo-react/runtime/test/generated/react19.test.js` (generated)

**Interfaces:**
- Consumes: `mr_run_module_file` (Task 2).
- Produces:
  - `maemo-react-host --compile <file.js>...` writes `<file>.qbc` for each file. It needs no display. Exit code 0, or 1 if one file did not compile.
  - When the host runs `app.js`, it loads `app.qbc` if the cache is valid. If not, it compiles `app.js` and tries to write `app.qbc`. A write failure is silent.
  - The cache header: 48 bytes, `MRBC`, format 1, the QuickJS version (16 bytes), the maemo-react version (16 bytes), the source size and the source modification time (32-bit each).
  - C API: `gchar *mr_bc_path(const char *js_path)`, `uint8_t *mr_bc_read(const char *js_path, size_t *len)` (a `g_malloc` buffer, or `NULL` if missing or stale), `int mr_bc_write(const char *js_path, const uint8_t *buf, size_t len)`, `int mr_compile_file(JSContext *ctx, const char *path)`.
  - `npm run build:test-bundles` bundles `runtime/test/bundles/*.jsx` into `runtime/test/generated/*.test.js`.

- [ ] **Step 1: Write the failing bytecode test**

Create `maemo-react/runtime/test/bytecode.sh` (executable). It also covers Review Focus item 3:

```bash
#!/usr/bin/env bash
# The bytecode cache: written on the first run, used on the next one, and
# ignored when the source, the runtime version or the file is wrong.
set -uo pipefail
T=$(mktemp -d)
trap 'chmod -R u+w "$T"; rm -rf "$T"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
cat > "$T/app.js" <<'EOF'
import { quit } from 'maemo:app';
console.log('version one');
quit(0);
EOF

out=$($HOST_RUN "$T/app.js" 2>&1) || fail "first run: $out"
[ "$out" = "version one" ] || fail "first run printed: $out"
[ -s "$T/app.qbc" ] || fail "no app.qbc after the first run"
head -c 4 "$T/app.qbc" | grep -q MRBC || fail "app.qbc has no MRBC header"

# Change the text but keep the size and the time: the cache must still be used.
cp -p "$T/app.js" "$T/app.js.orig"
sed -i 's/version one/version ONE/' "$T/app.js"
touch -r "$T/app.js.orig" "$T/app.js"
out=$($HOST_RUN "$T/app.js" 2>&1)
[ "$out" = "version one" ] || fail "the second run did not use the cache: $out"

# A new modification time makes the cache stale.
touch -d '+1 minute' "$T/app.js"
out=$($HOST_RUN "$T/app.js" 2>&1)
[ "$out" = "version ONE" ] || fail "a stale cache was used: $out"

# A cache from another QuickJS version is ignored (byte 8 is in that field).
printf 'X' | dd of="$T/app.qbc" bs=1 seek=8 conv=notrunc status=none
out=$($HOST_RUN "$T/app.js" 2>&1)
[ "$out" = "version ONE" ] || fail "a cache with a wrong version was used: $out"

# A cut cache file is ignored.
$HOST_RUN "$T/app.js" >/dev/null 2>&1
truncate -s 60 "$T/app.qbc"
out=$($HOST_RUN "$T/app.js" 2>&1)
[ "$out" = "version ONE" ] || fail "a cut cache broke the run: $out"

# --compile writes the cache, and needs no display.
rm -f "$T/app.qbc"
env -u DISPLAY $HOST_RUN --compile "$T/app.js" >/dev/null || fail "--compile failed"
[ -s "$T/app.qbc" ] || fail "--compile wrote no app.qbc"

# A folder that the user cannot write: the run works, and writes no cache.
rm -f "$T/app.qbc"
chmod 555 "$T"
out=$(setpriv --reuid=65534 --regid=65534 --clear-groups $HOST_RUN "$T/app.js" 2>&1)
chmod 755 "$T"
[ "$out" = "version ONE" ] || fail "the run in a read-only folder failed: $out"
[ ! -e "$T/app.qbc" ] || fail "a cache was written in a read-only folder"
echo ok
```

- [ ] **Step 2: Write the failing React 19 test**

Create `maemo-react/package.json`:

```json
{
  "name": "maemo-react-workspace",
  "private": true,
  "type": "module",
  "scripts": {
    "build:prelude": "npm run build -w @maemo-react/prelude",
    "build:test-bundles": "node runtime/test/build-bundles.mjs",
    "typegen:emit": "node typegen/emit.mjs",
    "test": "vitest run",
    "typecheck": "tsc -p packages/types/test"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/react": "19.3.0",
    "esbuild": "0.28.2",
    "react": "19.3.0",
    "react-reconciler": "0.34.0",
    "typescript": "5.9.3",
    "vitest": "5.0.3"
  }
}
```

Create `maemo-react/runtime/test/build-bundles.mjs`:

```js
// Bundle the runtime tests that import npm packages (React). The output goes
// to runtime/test/generated/, and runtime/test/run.sh runs it there.
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = join(here, 'bundles');
for (const f of readdirSync(dir).filter((name) => /\.(jsx|tsx|js|ts)$/.test(name))) {
  await build({
    entryPoints: [join(dir, f)],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    external: ['maemo:*'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: join(here, 'generated', basename(f).replace(/\.(jsx|tsx|js|ts)$/, '.test.js')),
    logLevel: 'warning',
  });
}
```

Create `maemo-react/runtime/test/bundles/react19.jsx`. It runs React 19 with a host config that records operations, with no GTK. This is the first M1 risk check (spec section 14):

```jsx
import React, { createContext, useState } from 'react';
import Reconciler from 'react-reconciler';
import {
  ConcurrentRoot,
  DefaultEventPriority,
  DiscreteEventPriority,
  NoEventPriority,
} from 'react-reconciler/constants.js';
import { test, assertEqual, run } from '../harness.js';

const ops = [];
let next = 1;
let priority = NoEventPriority;
const host = {
  supportsMutation: true, supportsPersistence: false, supportsHydration: false,
  supportsMicrotasks: true, supportsResources: false, supportsSingletons: false,
  supportsTestSelectors: false, isPrimaryRenderer: true, noTimeout: -1,
  rendererPackageName: 'react19-smoke', rendererVersion: '0.0.0', extraDevToolsConfig: null,
  scheduleMicrotask: (fn) => Promise.resolve().then(fn),
  scheduleTimeout: (fn, ms) => setTimeout(fn, ms),
  cancelTimeout: (id) => clearTimeout(id),
  getRootHostContext: () => null, getChildHostContext: (c) => c, getPublicInstance: (i) => i,
  prepareForCommit: () => null, resetAfterCommit: () => {}, preparePortalMount: () => {},
  createInstance: (type) => { const h = next++; ops.push(['create', type, h]); return h; },
  createTextInstance: (text) => { const h = next++; ops.push(['text', text, h]); return h; },
  appendInitialChild: (p, c) => ops.push(['append', p, c]),
  appendChild: (p, c) => ops.push(['append', p, c]),
  appendChildToContainer: (p, c) => ops.push(['append', p, c]),
  insertBefore: (p, c, b) => ops.push(['insert', p, c, b]),
  insertInContainerBefore: (p, c, b) => ops.push(['insert', p, c, b]),
  removeChild: (p, c) => ops.push(['remove', p, c]),
  removeChildFromContainer: (p, c) => ops.push(['remove', p, c]),
  finalizeInitialChildren: () => false, commitMount: () => {},
  shouldSetTextContent: () => false,
  commitUpdate: (i, type, prev, nextProps) => ops.push(['update', i, nextProps.label]),
  commitTextUpdate: (i, prev, text) => ops.push(['settext', i, text]),
  resetTextContent: () => {}, clearContainer: () => {},
  hideInstance: () => {}, unhideInstance: () => {}, hideTextInstance: () => {}, unhideTextInstance: () => {},
  detachDeletedInstance: (i) => ops.push(['destroy', i]),
  getInstanceFromNode: () => null, beforeActiveInstanceBlur: () => {}, afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {}, getInstanceFromScope: () => null,
  setCurrentUpdatePriority: (p) => { priority = p; },
  getCurrentUpdatePriority: () => priority,
  resolveUpdatePriority: () => (priority !== NoEventPriority ? priority : DefaultEventPriority),
  trackSchedulerEvent: () => {}, resolveEventType: () => null, resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false, requestPostPaintCallback: () => {},
  maySuspendCommit: () => false, maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false, preloadInstance: () => true,
  startSuspendingCommit: () => {}, suspendInstance: () => {},
  waitForCommitToBeReady: () => null, getSuspendedCommitReason: () => null,
  NotPendingTransition: null, HostTransitionContext: createContext(null),
  resetFormInstance: () => {},
  bindToConsole: (method, args) => Function.prototype.bind.call(console[method], console, ...args),
};

const R = Reconciler(host);
let setN;
function App() {
  const [n, set] = useState(0);
  setN = set;
  return React.createElement('button', { label: 'n' + n }, n < 2 ? 'a' : null);
}
const root = R.createContainer('ROOT', ConcurrentRoot, null, false, null, '',
  (e) => console.error(e), (e) => console.error(e), (e) => console.error(e), () => {});

test('React 19 mounts synchronously', () => {
  R.updateContainerSync(React.createElement(App), root, null, null);
  R.flushSyncWork();
  assertEqual(ops.splice(0), [['text', 'a', 1], ['create', 'button', 2], ['append', 2, 1], ['append', 'ROOT', 2]]);
});

test('a discrete update renders inside flushSyncWork', () => {
  priority = DiscreteEventPriority;
  setN(1);
  priority = NoEventPriority;
  R.flushSyncWork();
  assertEqual(ops.splice(0), [['update', 2, 'n1']]);
});

test('a default update renders after a timer', async () => {
  setN(2);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assertEqual(ops.splice(0), [['remove', 2, 1], ['update', 2, 'n2']]);
});

test('unmount removes and detaches', async () => {
  R.updateContainer(null, root, null, null);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const kinds = ops.splice(0).map((op) => op[0]);
  assertEqual(kinds.includes('remove') && kinds.includes('destroy'), true);
});

await run();
```

- [ ] **Step 3: Run the new tests to see them fail**

```bash
npm install
npm run build:test-bundles
devhost/run.sh 'runtime/test/run.sh desktop test/bytecode.sh test/generated/react19.test.js'
```

Expected: `FAIL test/bytecode.sh` with `FAIL: no app.qbc after the first run`. The React test can already pass on desktop: React needs only the timers from Task 4. If it fails, read its output before you continue, because the renderer (Task 11) depends on it.

- [ ] **Step 4: Write bytecode.c**

Create `maemo-react/runtime/src/bytecode.c`:

```c
/* Bytecode cache files: app.js gets app.qbc beside it. A header records the
   QuickJS and maemo-react versions and the size and time of the source, so a
   changed source or a new runtime makes the cache stale. */
#include <string.h>
#include <sys/stat.h>
#include "mr.h"

#define BC_MAGIC "MRBC"
#define BC_FORMAT 1

typedef struct {
    char magic[4];
    guint32 format;
    char qjs[16];
    char mr[16];
    guint32 src_size;
    guint32 src_mtime;
} BcHeader; /* 48 bytes, no padding */

static void make_header(BcHeader *h, const struct stat *st)
{
    memset(h, 0, sizeof *h);
    memcpy(h->magic, BC_MAGIC, 4);
    h->format = BC_FORMAT;
    g_strlcpy(h->qjs, MR_QJS_VERSION, sizeof h->qjs);
    g_strlcpy(h->mr, MR_VERSION, sizeof h->mr);
    h->src_size = (guint32)st->st_size;
    h->src_mtime = (guint32)st->st_mtime;
}

gchar *mr_bc_path(const char *js_path)
{
    size_t n = strlen(js_path);
    if (n > 3 && g_str_has_suffix(js_path, ".js")) {
        gchar *stem = g_strndup(js_path, n - 3);
        gchar *p = g_strconcat(stem, ".qbc", NULL);
        g_free(stem);
        return p;
    }
    return g_strconcat(js_path, ".qbc", NULL);
}

uint8_t *mr_bc_read(const char *js_path, size_t *len)
{
    struct stat st;
    BcHeader want;
    gchar *path, *data;
    gsize n;
    if (stat(js_path, &st) < 0)
        return NULL;
    make_header(&want, &st);
    path = mr_bc_path(js_path);
    if (!g_file_get_contents(path, &data, &n, NULL)) {
        g_free(path);
        return NULL;
    }
    g_free(path);
    if (n <= sizeof want || memcmp(data, &want, sizeof want) != 0) {
        g_free(data);
        return NULL;
    }
    memmove(data, data + sizeof want, n - sizeof want);
    *len = n - sizeof want;
    return (uint8_t *)data;
}

int mr_bc_write(const char *js_path, const uint8_t *buf, size_t len)
{
    struct stat st;
    BcHeader h;
    gchar *path, *all;
    gboolean ok;
    if (stat(js_path, &st) < 0)
        return -1;
    make_header(&h, &st);
    all = g_malloc(sizeof h + len);
    memcpy(all, &h, sizeof h);
    memcpy(all + sizeof h, buf, len);
    path = mr_bc_path(js_path);
    /* Writes a temporary file and renames it, so a reader never sees half. */
    ok = g_file_set_contents(path, all, sizeof h + len, NULL);
    g_free(path);
    g_free(all);
    return ok ? 0 : -1;
}
```

Add to `mr.h`, after the `loader.c` block:

```c
int mr_compile_file(JSContext *ctx, const char *path);

/* bytecode.c */
gchar *mr_bc_path(const char *js_path);
uint8_t *mr_bc_read(const char *js_path, size_t *len);
int mr_bc_write(const char *js_path, const uint8_t *buf, size_t len);
```

- [ ] **Step 5: Use the cache in loader.c**

In `maemo-react/runtime/src/loader.c`, replace the function `mr_run_module_file` with:

```c
/* Write the bytecode cache. A failure is not an error: the folder of an
   installed application belongs to root. */
static int write_cache(JSContext *ctx, const char *path, JSValueConst fn)
{
    size_t len;
    int r;
    uint8_t *buf = JS_WriteObject(ctx, &len, fn, JS_WRITE_OBJ_BYTECODE);
    if (!buf) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        return -1;
    }
    r = mr_bc_write(path, buf, len);
    js_free(ctx, buf);
    return r;
}

int mr_run_module_file(JSContext *ctx, const char *path)
{
    size_t len;
    uint8_t *bc = mr_bc_read(path, &len);
    JSValue fn = JS_EXCEPTION;
    if (bc) {
        fn = JS_ReadObject(ctx, bc, len, JS_READ_OBJ_BYTECODE);
        g_free(bc);
        if (JS_IsException(fn)) /* a damaged cache: use the source */
            JS_FreeValue(ctx, JS_GetException(ctx));
    }
    if (JS_IsException(fn)) {
        fn = compile_file(ctx, path);
        if (JS_IsException(fn)) {
            mr_report_exception(ctx);
            return -1;
        }
        write_cache(ctx, path, fn);
    }
    return eval_module(ctx, fn);
}

int mr_compile_file(JSContext *ctx, const char *path)
{
    JSValue fn = compile_file(ctx, path);
    int r;
    if (JS_IsException(fn)) {
        mr_report_exception(ctx);
        return -1;
    }
    r = write_cache(ctx, path, fn);
    JS_FreeValue(ctx, fn);
    if (r < 0) {
        gchar *qbc = mr_bc_path(path);
        fprintf(stderr, "maemo-react-host: cannot write %s\n", qbc);
        g_free(qbc);
    }
    return r;
}
```

Add `#include <stdio.h>` at the top of `loader.c`.

- [ ] **Step 6: Add --compile to main.c**

In `main.c`, add this function before `main`:

```c
/* --compile needs no display: package scripts run it over SSH. */
static int compile_files(int argc, char **argv)
{
    int i, rc = 0;
    mr_rt = JS_NewRuntime();
    JS_SetStripInfo(mr_rt, JS_STRIP_SOURCE);
    mr_ctx = JS_NewContext(mr_rt);
    mr_loop_init(mr_rt);
    for (i = 2; i < argc; i++)
        if (mr_compile_file(mr_ctx, argv[i]) < 0)
            rc = 1;
    return rc;
}
```

In `main`, after the `if (argc < 2) usage();` line, add:

```c
    if (!strcmp(argv[1], "--compile")) {
        if (argc < 3)
            usage();
        return compile_files(argc, argv);
    }
```

After `mr_rt = JS_NewRuntime();` in `main`, add:

```c
    /* The same setting as --compile, so the caches are the same. */
    JS_SetStripInfo(mr_rt, JS_STRIP_SOURCE);
```

Add a third line to the usage text: `"       maemo-react-host --compile <file.js>...\n"`.

- [ ] **Step 7: Run all runtime tests on both targets**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: every line is `PASS`, including `test/bytecode.sh` and `test/generated/react19.test.js` on both targets.

- [ ] **Step 8: Commit**

```bash
git add maemo-react/package.json maemo-react/package-lock.json maemo-react/runtime
git commit -m "Add the bytecode cache and check React 19 on QuickJS

The host caches compiled modules in .qbc files with a version header, and
--compile writes them without a display. React 19 renders through a test
host config inside QuickJS on both targets."
```

---

### Task 6: The bridge, part 1: objects and properties

**Files:**
- Create: `maemo-react/runtime/src/gtype.c`, `src/convert.c`, `src/bridge.c`
- Modify: `maemo-react/runtime/src/mr.h`, `src/main.c`
- Test: `maemo-react/runtime/test/bridge-props.test.js`

**Interfaces:**
- Consumes: Task 2 (`mr_now_ms`, the loader registry).
- Produces:
  - JS module `maemo:gobject` with `create(typeName: string): number`, `set(h, prop, value): void`, `get(h, prop): unknown`, `reset(h, prop): void` (sets the property's default value), `destroy(h): void` (idempotent; also releases the handles of all descendant widgets; a top-level window also gets `gtk_widget_destroy`).
  - Errors are `TypeError` (unknown type, unknown or read-only property, wrong value type, invalid handle) or `RangeError` (a number out of the property's range).
  - Conversions: booleans must be booleans; numbers must be numbers; strings must be strings or `null`; enums are nicknames (`"automatic"`); flags are arrays of nicknames; objects are handles or `null`; `GdkColor` is `"#rrggbb"`.
  - C API: `GType mr_type_from_name(const char *name)`, `int mr_js_to_gvalue(JSContext *ctx, JSValueConst v, GValue *out, GParamSpec *ps, const char *what)` (`out` initialized; returns 0, or -1 with an exception), `JSValue mr_gvalue_to_js(JSContext *ctx, const GValue *v, int strict)` (strict: exception for unsupported types; else `undefined`), `GObject *mr_handle_object(int32_t h)`, `int32_t mr_handle_of(GObject *obj)` (0 if none), `GObject *mr_arg_object(JSContext *ctx, JSValueConst v)` (NULL with a `TypeError`), `int mr_bridge_handle_count(void)`, `void mr_bridge_init(void)`, `extern double mr_bridge_ms` (time spent in GTK setters, for benchmarks).

- [ ] **Step 1: Write the failing test**

Create `maemo-react/runtime/test/bridge-props.test.js`:

```js
import { test, assertEqual, assertThrows, run } from './harness.js';
import { create, set, get, reset, destroy } from 'maemo:gobject';

test('create, then set and get a string', () => {
  const l = create('GtkLabel');
  set(l, 'label', 'hi');
  assertEqual(get(l, 'label'), 'hi');
  destroy(l);
});

test('UTF-8 text', () => {
  const l = create('GtkLabel');
  const s = 'Ñandú € 😀 日本';
  set(l, 'label', s);
  assertEqual(get(l, 'label'), s);
  destroy(l);
});

test('a boolean must be a boolean', () => {
  const l = create('GtkLabel');
  set(l, 'wrap', true);
  assertEqual(get(l, 'wrap'), true);
  assertThrows(() => set(l, 'wrap', 1), /TypeError: GtkLabel.wrap: expected a boolean/);
  destroy(l);
});

test('an integer with a range check', () => {
  const b = create('GtkVBox');
  set(b, 'spacing', 6);
  assertEqual(get(b, 'spacing'), 6);
  assertThrows(() => set(b, 'spacing', -1), /RangeError/);
  assertThrows(() => set(b, 'spacing', 1.5), /expected an integer/);
  assertThrows(() => set(b, 'spacing', '6'), /expected a number/);
  destroy(b);
});

test('a float with a range check', () => {
  const l = create('GtkLabel');
  set(l, 'xalign', 0.25);
  assertEqual(get(l, 'xalign'), 0.25);
  assertThrows(() => set(l, 'xalign', 2), /RangeError/);
  destroy(l);
});

test('an enum by nickname', () => {
  const s = create('GtkScrolledWindow');
  set(s, 'hscrollbar-policy', 'never');
  assertEqual(get(s, 'hscrollbar-policy'), 'never');
  assertThrows(() => set(s, 'hscrollbar-policy', 'sometimes'), /expected one of: always, automatic, never/);
  destroy(s);
});

test('flags as an array of nicknames', () => {
  const l = create('GtkLabel');
  set(l, 'events', ['button-press-mask', 'key-press-mask']);
  assertEqual(get(l, 'events'), ['button-press-mask', 'key-press-mask']);
  destroy(l);
});

test('an object property takes a handle', () => {
  const l = create('GtkLabel');
  const b = create('GtkButton');
  set(l, 'mnemonic-widget', b);
  assertEqual(get(l, 'mnemonic-widget'), b);
  set(l, 'mnemonic-widget', null);
  assertEqual(get(l, 'mnemonic-widget'), null);
  destroy(l);
  destroy(b);
});

test('a GdkColor from #rrggbb', () => {
  const c = create('GtkCellRendererText');
  set(c, 'foreground-gdk', '#ff8000');
  assertEqual(get(c, 'foreground-gdk'), '#ff8000');
  assertThrows(() => set(c, 'foreground-gdk', 'not a color'), /is not a color/);
  destroy(c);
});

test('reset sets the default value', () => {
  const b = create('GtkVBox');
  set(b, 'spacing', 9);
  reset(b, 'spacing');
  assertEqual(get(b, 'spacing'), 0);
  destroy(b);
});

test('errors name the type and the property', () => {
  const l = create('GtkLabel');
  assertThrows(() => set(l, 'nope', 1), /GtkLabel has no property 'nope'/);
  assertThrows(() => create('GtkNope'), /'GtkNope' is not a GObject type/);
  assertThrows(() => create('GtkWidget'), /'GtkWidget' is not a GObject type that can be created/);
  destroy(l);
});

test('construct-only properties cannot be set', () => {
  const w = create('GtkWindow');
  assertThrows(() => set(w, 'type', 'popup'), /property 'type' of GtkWindow is not writable/);
  destroy(w);
});

test('destroy is idempotent, and the handle is then invalid', () => {
  const l = create('GtkLabel');
  destroy(l);
  destroy(l);
  assertThrows(() => get(l, 'label'), /invalid handle/);
});

await run();
```

- [ ] **Step 2: Run it to see it fail**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/test/run.sh desktop test/bridge-props.test.js'
```

Expected: `FAIL` with `unknown native module 'maemo:gobject'`.

- [ ] **Step 3: Write gtype.c**

Create `maemo-react/runtime/src/gtype.c`:

```c
/* Find a GType by its name. A type exists only after its get_type function
   ran once, so for a name such as GtkVBox we call gtk_vbox_get_type. */
#include <dlfcn.h>
#include <glib-object.h>
#include "mr.h"

GType mr_type_from_name(const char *name)
{
    GType t = g_type_from_name(name);
    GType (*get_type)(void);
    GString *fn;
    const char *p;
    if (t)
        return t;
    fn = g_string_new(NULL);
    for (p = name; *p; p++) {
        if (p != name && g_ascii_isupper(*p) && g_ascii_islower(p[-1]))
            g_string_append_c(fn, '_');
        g_string_append_c(fn, g_ascii_tolower(*p));
    }
    g_string_append(fn, "_get_type");
    get_type = (GType (*)(void))dlsym(RTLD_DEFAULT, fn->str);
    g_string_free(fn, TRUE);
    return get_type ? get_type() : 0;
}
```

- [ ] **Step 4: Write convert.c**

Create `maemo-react/runtime/src/convert.c`:

```c
/* Conversion between JavaScript values and GValues. The rules are strict:
   a boolean property takes only a boolean, a number property only a number. */
#include <math.h>
#include <string.h>
#include <gtk/gtk.h>
#include "mr.h"

/* The allowed range for a number type; from the GParamSpec if there is one. */
static void number_range(GParamSpec *ps, GType ft, double *lo, double *hi)
{
    switch (ft) {
    case G_TYPE_CHAR:
        *lo = ps && G_IS_PARAM_SPEC_CHAR(ps) ? G_PARAM_SPEC_CHAR(ps)->minimum : -128;
        *hi = ps && G_IS_PARAM_SPEC_CHAR(ps) ? G_PARAM_SPEC_CHAR(ps)->maximum : 127;
        break;
    case G_TYPE_UCHAR:
        *lo = ps && G_IS_PARAM_SPEC_UCHAR(ps) ? G_PARAM_SPEC_UCHAR(ps)->minimum : 0;
        *hi = ps && G_IS_PARAM_SPEC_UCHAR(ps) ? G_PARAM_SPEC_UCHAR(ps)->maximum : 255;
        break;
    case G_TYPE_INT:
        *lo = ps && G_IS_PARAM_SPEC_INT(ps) ? G_PARAM_SPEC_INT(ps)->minimum : G_MININT;
        *hi = ps && G_IS_PARAM_SPEC_INT(ps) ? G_PARAM_SPEC_INT(ps)->maximum : G_MAXINT;
        break;
    case G_TYPE_UINT:
        *lo = ps && G_IS_PARAM_SPEC_UINT(ps) ? G_PARAM_SPEC_UINT(ps)->minimum : 0;
        *hi = ps && G_IS_PARAM_SPEC_UINT(ps) ? G_PARAM_SPEC_UINT(ps)->maximum : G_MAXUINT;
        break;
    case G_TYPE_LONG:
        *lo = ps && G_IS_PARAM_SPEC_LONG(ps) ? G_PARAM_SPEC_LONG(ps)->minimum : G_MINLONG;
        *hi = ps && G_IS_PARAM_SPEC_LONG(ps) ? G_PARAM_SPEC_LONG(ps)->maximum : G_MAXLONG;
        break;
    case G_TYPE_ULONG:
        *lo = ps && G_IS_PARAM_SPEC_ULONG(ps) ? G_PARAM_SPEC_ULONG(ps)->minimum : 0;
        *hi = ps && G_IS_PARAM_SPEC_ULONG(ps) ? G_PARAM_SPEC_ULONG(ps)->maximum : G_MAXULONG;
        break;
    case G_TYPE_INT64:
        *lo = ps && G_IS_PARAM_SPEC_INT64(ps) ? MAX((double)G_PARAM_SPEC_INT64(ps)->minimum, -9007199254740991.0) : -9007199254740991.0;
        *hi = ps && G_IS_PARAM_SPEC_INT64(ps) ? MIN((double)G_PARAM_SPEC_INT64(ps)->maximum, 9007199254740991.0) : 9007199254740991.0;
        break;
    case G_TYPE_UINT64:
        *lo = ps && G_IS_PARAM_SPEC_UINT64(ps) ? (double)G_PARAM_SPEC_UINT64(ps)->minimum : 0;
        *hi = ps && G_IS_PARAM_SPEC_UINT64(ps) ? MIN((double)G_PARAM_SPEC_UINT64(ps)->maximum, 9007199254740991.0) : 9007199254740991.0;
        break;
    case G_TYPE_FLOAT:
        *lo = ps && G_IS_PARAM_SPEC_FLOAT(ps) ? G_PARAM_SPEC_FLOAT(ps)->minimum : -G_MAXFLOAT;
        *hi = ps && G_IS_PARAM_SPEC_FLOAT(ps) ? G_PARAM_SPEC_FLOAT(ps)->maximum : G_MAXFLOAT;
        break;
    default: /* G_TYPE_DOUBLE */
        *lo = ps && G_IS_PARAM_SPEC_DOUBLE(ps) ? G_PARAM_SPEC_DOUBLE(ps)->minimum : -G_MAXDOUBLE;
        *hi = ps && G_IS_PARAM_SPEC_DOUBLE(ps) ? G_PARAM_SPEC_DOUBLE(ps)->maximum : G_MAXDOUBLE;
        break;
    }
}

static int to_number(JSContext *ctx, JSValueConst v, GValue *out, GParamSpec *ps, const char *what)
{
    GType ft = G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(out));
    double d, lo, hi;
    if (!JS_IsNumber(v)) {
        JS_ThrowTypeError(ctx, "%s: expected a number", what);
        return -1;
    }
    JS_ToFloat64(ctx, &d, v);
    if (ft != G_TYPE_FLOAT && ft != G_TYPE_DOUBLE && (!isfinite(d) || d != floor(d))) {
        JS_ThrowRangeError(ctx, "%s: expected an integer, got %g", what, d);
        return -1;
    }
    number_range(ps, ft, &lo, &hi);
    if (!(d >= lo && d <= hi)) {
        JS_ThrowRangeError(ctx, "%s: %g is out of the range %g to %g", what, d, lo, hi);
        return -1;
    }
    switch (ft) {
    case G_TYPE_CHAR: g_value_set_char(out, (gchar)d); break;
    case G_TYPE_UCHAR: g_value_set_uchar(out, (guchar)d); break;
    case G_TYPE_INT: g_value_set_int(out, (gint)d); break;
    case G_TYPE_UINT: g_value_set_uint(out, (guint)d); break;
    case G_TYPE_LONG: g_value_set_long(out, (glong)d); break;
    case G_TYPE_ULONG: g_value_set_ulong(out, (gulong)d); break;
    case G_TYPE_INT64: g_value_set_int64(out, (gint64)d); break;
    case G_TYPE_UINT64: g_value_set_uint64(out, (guint64)d); break;
    case G_TYPE_FLOAT: g_value_set_float(out, (gfloat)d); break;
    default: g_value_set_double(out, d); break;
    }
    return 0;
}

static int to_enum(JSContext *ctx, JSValueConst v, GValue *out, const char *what)
{
    GEnumClass *ec = g_type_class_ref(G_VALUE_TYPE(out));
    GEnumValue *ev = NULL;
    if (JS_IsString(v)) {
        const char *s = JS_ToCString(ctx, v);
        ev = g_enum_get_value_by_nick(ec, s);
        if (!ev)
            ev = g_enum_get_value_by_name(ec, s);
        JS_FreeCString(ctx, s);
    } else if (JS_IsNumber(v)) {
        int32_t n;
        JS_ToInt32(ctx, &n, v);
        ev = g_enum_get_value(ec, n);
    }
    if (!ev) {
        GString *nicks = g_string_new(NULL);
        guint i;
        for (i = 0; i < ec->n_values; i++)
            g_string_append_printf(nicks, "%s%s", i ? ", " : "", ec->values[i].value_nick);
        JS_ThrowTypeError(ctx, "%s: not a %s value; expected one of: %s", what,
                          G_VALUE_TYPE_NAME(out), nicks->str);
        g_string_free(nicks, TRUE);
        g_type_class_unref(ec);
        return -1;
    }
    g_value_set_enum(out, ev->value);
    g_type_class_unref(ec);
    return 0;
}

static int to_flags(JSContext *ctx, JSValueConst v, GValue *out, const char *what)
{
    GFlagsClass *fc = g_type_class_ref(G_VALUE_TYPE(out));
    guint bits = 0;
    int ok = 0;
    if (JS_IsNumber(v)) {
        uint32_t n;
        JS_ToUint32(ctx, &n, v);
        bits = n;
    } else if (JS_IsArray(ctx, v)) {
        JSValue lenv = JS_GetPropertyStr(ctx, v, "length");
        uint32_t i, len = 0;
        JS_ToUint32(ctx, &len, lenv);
        JS_FreeValue(ctx, lenv);
        for (i = 0; i < len && ok == 0; i++) {
            JSValue item = JS_GetPropertyUint32(ctx, v, i);
            const char *s = JS_IsString(item) ? JS_ToCString(ctx, item) : NULL;
            GFlagsValue *fv = s ? g_flags_get_value_by_nick(fc, s) : NULL;
            if (s && !fv)
                fv = g_flags_get_value_by_name(fc, s);
            if (fv)
                bits |= fv->value;
            else {
                JS_ThrowTypeError(ctx, "%s: '%s' is not a %s flag", what, s ? s : "?", G_VALUE_TYPE_NAME(out));
                ok = -1;
            }
            if (s)
                JS_FreeCString(ctx, s);
            JS_FreeValue(ctx, item);
        }
    } else {
        JS_ThrowTypeError(ctx, "%s: expected an array of flag names", what);
        ok = -1;
    }
    if (ok == 0)
        g_value_set_flags(out, bits);
    g_type_class_unref(fc);
    return ok;
}

int mr_js_to_gvalue(JSContext *ctx, JSValueConst v, GValue *out, GParamSpec *ps, const char *what)
{
    switch (G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(out))) {
    case G_TYPE_BOOLEAN:
        if (!JS_IsBool(v)) {
            JS_ThrowTypeError(ctx, "%s: expected a boolean", what);
            return -1;
        }
        g_value_set_boolean(out, JS_ToBool(ctx, v));
        return 0;
    case G_TYPE_CHAR: case G_TYPE_UCHAR: case G_TYPE_INT: case G_TYPE_UINT:
    case G_TYPE_LONG: case G_TYPE_ULONG: case G_TYPE_INT64: case G_TYPE_UINT64:
    case G_TYPE_FLOAT: case G_TYPE_DOUBLE:
        return to_number(ctx, v, out, ps, what);
    case G_TYPE_STRING:
        if (JS_IsNull(v) || JS_IsUndefined(v)) {
            g_value_set_string(out, NULL);
        } else if (JS_IsString(v)) {
            const char *s = JS_ToCString(ctx, v);
            g_value_set_string(out, s);
            JS_FreeCString(ctx, s);
        } else {
            JS_ThrowTypeError(ctx, "%s: expected a string", what);
            return -1;
        }
        return 0;
    case G_TYPE_ENUM:
        return to_enum(ctx, v, out, what);
    case G_TYPE_FLAGS:
        return to_flags(ctx, v, out, what);
    case G_TYPE_OBJECT: {
        GObject *obj;
        if (JS_IsNull(v) || JS_IsUndefined(v)) {
            g_value_set_object(out, NULL);
            return 0;
        }
        if (!(obj = mr_arg_object(ctx, v)))
            return -1;
        if (!g_type_is_a(G_OBJECT_TYPE(obj), G_VALUE_TYPE(out))) {
            JS_ThrowTypeError(ctx, "%s: expected a %s, got a %s", what,
                              G_VALUE_TYPE_NAME(out), G_OBJECT_TYPE_NAME(obj));
            return -1;
        }
        g_value_set_object(out, obj);
        return 0;
    }
    case G_TYPE_BOXED:
        if (G_VALUE_TYPE(out) == GDK_TYPE_COLOR) {
            GdkColor color;
            const char *s;
            gboolean ok;
            if (JS_IsNull(v) || JS_IsUndefined(v)) {
                g_value_set_boxed(out, NULL);
                return 0;
            }
            if (!JS_IsString(v)) {
                JS_ThrowTypeError(ctx, "%s: expected a color string such as #rrggbb", what);
                return -1;
            }
            s = JS_ToCString(ctx, v);
            ok = gdk_color_parse(s, &color);
            if (!ok)
                JS_ThrowTypeError(ctx, "%s: '%s' is not a color; use #rrggbb", what, s);
            JS_FreeCString(ctx, s);
            if (!ok)
                return -1;
            g_value_set_boxed(out, &color);
            return 0;
        }
        break;
    default:
        break;
    }
    JS_ThrowTypeError(ctx, "%s: maemo:gobject cannot convert values of type %s",
                      what, G_VALUE_TYPE_NAME(out));
    return -1;
}

JSValue mr_gvalue_to_js(JSContext *ctx, const GValue *v, int strict)
{
    switch (G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(v))) {
    case G_TYPE_BOOLEAN: return JS_NewBool(ctx, g_value_get_boolean(v));
    case G_TYPE_CHAR: return JS_NewInt32(ctx, g_value_get_char(v));
    case G_TYPE_UCHAR: return JS_NewInt32(ctx, g_value_get_uchar(v));
    case G_TYPE_INT: return JS_NewInt32(ctx, g_value_get_int(v));
    case G_TYPE_UINT: return JS_NewInt64(ctx, g_value_get_uint(v));
    case G_TYPE_LONG: return JS_NewInt64(ctx, g_value_get_long(v));
    case G_TYPE_ULONG: return JS_NewInt64(ctx, g_value_get_ulong(v));
    case G_TYPE_INT64: return JS_NewInt64(ctx, g_value_get_int64(v));
    case G_TYPE_UINT64: return JS_NewFloat64(ctx, (double)g_value_get_uint64(v));
    case G_TYPE_FLOAT: return JS_NewFloat64(ctx, g_value_get_float(v));
    case G_TYPE_DOUBLE: return JS_NewFloat64(ctx, g_value_get_double(v));
    case G_TYPE_STRING: {
        const char *s = g_value_get_string(v);
        return s ? JS_NewString(ctx, s) : JS_NULL;
    }
    case G_TYPE_ENUM: {
        GEnumClass *ec = g_type_class_ref(G_VALUE_TYPE(v));
        GEnumValue *ev = g_enum_get_value(ec, g_value_get_enum(v));
        JSValue r = ev ? JS_NewString(ctx, ev->value_nick) : JS_NewInt32(ctx, g_value_get_enum(v));
        g_type_class_unref(ec);
        return r;
    }
    case G_TYPE_FLAGS: {
        GFlagsClass *fc = g_type_class_ref(G_VALUE_TYPE(v));
        guint bits = g_value_get_flags(v), i;
        JSValue arr = JS_NewArray(ctx);
        uint32_t n = 0;
        for (i = 0; i < fc->n_values; i++) {
            guint fv = fc->values[i].value;
            if (fv && (bits & fv) == fv)
                JS_SetPropertyUint32(ctx, arr, n++, JS_NewString(ctx, fc->values[i].value_nick));
        }
        g_type_class_unref(fc);
        return arr;
    }
    case G_TYPE_OBJECT: {
        GObject *o = g_value_get_object(v);
        int32_t h = o ? mr_handle_of(o) : 0;
        return h ? JS_NewInt32(ctx, h) : JS_NULL;
    }
    case G_TYPE_BOXED:
        if (G_VALUE_TYPE(v) == GDK_TYPE_COLOR) {
            GdkColor *c = g_value_get_boxed(v);
            char buf[8];
            if (!c)
                return JS_NULL;
            g_snprintf(buf, sizeof buf, "#%02x%02x%02x", c->red >> 8, c->green >> 8, c->blue >> 8);
            return JS_NewString(ctx, buf);
        }
        break;
    default:
        break;
    }
    if (strict)
        return JS_ThrowTypeError(ctx, "maemo:gobject cannot convert values of type %s",
                                 G_VALUE_TYPE_NAME(v));
    return JS_UNDEFINED;
}
```

- [ ] **Step 5: Write bridge.c**

Create `maemo-react/runtime/src/bridge.c`:

```c
/* maemo:gobject -- make GObjects and use their properties. A handle is an
   integer; the handle table holds one strong reference for each handle.
   Handles are never used again after a destroy. */
#include <string.h>
#include <gtk/gtk.h>
#include "mr.h"

static GHashTable *handles; /* handle -> GObject */
static GQuark handle_quark;
static int32_t next_handle = 1;
double mr_bridge_ms;

void mr_bridge_init(void)
{
    handles = g_hash_table_new(g_direct_hash, g_direct_equal);
    handle_quark = g_quark_from_static_string("maemo-react-handle");
}

GObject *mr_handle_object(int32_t h)
{
    return g_hash_table_lookup(handles, GINT_TO_POINTER(h));
}

int32_t mr_handle_of(GObject *obj)
{
    return GPOINTER_TO_INT(g_object_get_qdata(obj, handle_quark));
}

int mr_bridge_handle_count(void)
{
    return g_hash_table_size(handles);
}

GObject *mr_arg_object(JSContext *ctx, JSValueConst v)
{
    int32_t h;
    GObject *o = NULL;
    if (JS_IsNumber(v) && JS_ToInt32(ctx, &h, v) == 0)
        o = mr_handle_object(h);
    if (!o)
        JS_ThrowTypeError(ctx, "maemo:gobject: invalid handle");
    return o;
}

static int32_t add_handle(GObject *obj)
{
    int32_t h = next_handle++;
    g_hash_table_insert(handles, GINT_TO_POINTER(h), obj);
    g_object_set_qdata(obj, handle_quark, GINT_TO_POINTER(h));
    return h;
}

/* Remove the handle of obj and give back the table's reference. */
static void release(GObject *obj)
{
    int32_t h = mr_handle_of(obj);
    if (!h)
        return;
    g_object_set_qdata(obj, handle_quark, NULL);
    g_hash_table_remove(handles, GINT_TO_POINTER(h));
    g_object_unref(obj);
}

static void release_tree(GtkWidget *w, gpointer data)
{
    if (GTK_IS_CONTAINER(w))
        gtk_container_forall(GTK_CONTAINER(w), release_tree, NULL);
    release(G_OBJECT(w));
}

static GParamSpec *find_property(JSContext *ctx, GObject *o, const char *name, gboolean write)
{
    GParamSpec *ps = g_object_class_find_property(G_OBJECT_GET_CLASS(o), name);
    if (!ps) {
        JS_ThrowTypeError(ctx, "%s has no property '%s'", G_OBJECT_TYPE_NAME(o), name);
        return NULL;
    }
    if (write && (!(ps->flags & G_PARAM_WRITABLE) || (ps->flags & G_PARAM_CONSTRUCT_ONLY))) {
        JS_ThrowTypeError(ctx, "property '%s' of %s is not writable", name, G_OBJECT_TYPE_NAME(o));
        return NULL;
    }
    if (!write && !(ps->flags & G_PARAM_READABLE)) {
        JS_ThrowTypeError(ctx, "property '%s' of %s is not readable", name, G_OBJECT_TYPE_NAME(o));
        return NULL;
    }
    return ps;
}

static JSValue js_create(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *name = JS_ToCString(ctx, argv[0]);
    GType t;
    GObject *o;
    if (!name)
        return JS_EXCEPTION;
    t = mr_type_from_name(name);
    if (!t || !G_TYPE_IS_OBJECT(t) || G_TYPE_IS_ABSTRACT(t)) {
        JS_ThrowTypeError(ctx, "'%s' is not a GObject type that can be created", name);
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    JS_FreeCString(ctx, name);
    o = g_object_new(t, NULL);
    if (g_object_is_floating(o))
        g_object_ref_sink(o); /* GtkObject starts floating; we own it now */
    return JS_NewInt32(ctx, add_handle(o));
}

static JSValue js_set(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double t0 = mr_now_ms();
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    gchar *what;
    int r;
    if (!o || !(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    if (!(ps = find_property(ctx, o, name, TRUE))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    what = g_strdup_printf("%s.%s", G_OBJECT_TYPE_NAME(o), name);
    r = mr_js_to_gvalue(ctx, argv[2], &v, ps, what);
    g_free(what);
    if (r == 0)
        g_object_set_property(o, name, &v);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    mr_bridge_ms += mr_now_ms() - t0;
    return r == 0 ? JS_UNDEFINED : JS_EXCEPTION;
}

static JSValue js_get(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    JSValue r;
    if (!o || !(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    if (!(ps = find_property(ctx, o, name, FALSE))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    g_object_get_property(o, name, &v);
    r = mr_gvalue_to_js(ctx, &v, 1);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    return r;
}

static JSValue js_reset(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double t0 = mr_now_ms();
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    if (!o || !(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    if (!(ps = find_property(ctx, o, name, TRUE))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    g_param_value_set_default(ps, &v);
    g_object_set_property(o, name, &v);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    mr_bridge_ms += mr_now_ms() - t0;
    return JS_UNDEFINED;
}

static JSValue js_destroy(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    int32_t h;
    GObject *o;
    if (!JS_IsNumber(argv[0]) || JS_ToInt32(ctx, &h, argv[0]))
        return JS_ThrowTypeError(ctx, "maemo:gobject: invalid handle");
    o = mr_handle_object(h);
    if (!o)
        return JS_UNDEFINED; /* destroyed already */
    g_object_ref(o);
    if (GTK_IS_CONTAINER(o))
        gtk_container_forall(GTK_CONTAINER(o), release_tree, NULL);
    if (GTK_IS_WIDGET(o) && GTK_WIDGET_TOPLEVEL(GTK_WIDGET(o)))
        gtk_widget_destroy(GTK_WIDGET(o));
    release(o);
    g_object_unref(o);
    return JS_UNDEFINED;
}

static const JSCFunctionListEntry gobject_funcs[] = {
    JS_CFUNC_DEF("create", 1, js_create),
    JS_CFUNC_DEF("set", 3, js_set),
    JS_CFUNC_DEF("get", 2, js_get),
    JS_CFUNC_DEF("reset", 2, js_reset),
    JS_CFUNC_DEF("destroy", 1, js_destroy),
};

static int gobject_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, gobject_funcs, G_N_ELEMENTS(gobject_funcs));
}

JSModuleDef *mr_init_gobject(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, gobject_init);
    if (!m)
        return NULL;
    JS_AddModuleExportList(ctx, m, gobject_funcs, G_N_ELEMENTS(gobject_funcs));
    return m;
}
```

- [ ] **Step 6: Declare and register the module**

In `mr.h`, change `#include <glib.h>` to `#include <glib-object.h>`, and add before `#endif`:

```c
/* gtype.c */
GType mr_type_from_name(const char *name);

/* convert.c */
int mr_js_to_gvalue(JSContext *ctx, JSValueConst v, GValue *out, GParamSpec *ps, const char *what);
JSValue mr_gvalue_to_js(JSContext *ctx, const GValue *v, int strict);

/* bridge.c */
extern double mr_bridge_ms;
void mr_bridge_init(void);
JSModuleDef *mr_init_gobject(JSContext *ctx, const char *name);
GObject *mr_handle_object(int32_t h);
int32_t mr_handle_of(GObject *obj);
GObject *mr_arg_object(JSContext *ctx, JSValueConst v);
int mr_bridge_handle_count(void);
```

In `main.c`, after `mr_register_module("maemo:app", mr_init_app);`, add:

```c
    mr_bridge_init();
    mr_register_module("maemo:gobject", mr_init_gobject);
```

- [ ] **Step 7: Run all runtime tests on both targets**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: every line is `PASS`. On Diablo, `bridge-props.test.js` tests GTK 2.10 itself. If one case fails only there (for example a property that GTK 2.10 does not have), tell your human partner before you change the test: it is a fact about the tablet that the types (Task 12) must also show.

- [ ] **Step 8: Commit**

```bash
git add maemo-react/runtime/src maemo-react/runtime/test/bridge-props.test.js
git commit -m "Add the maemo:gobject bridge: objects and properties

Handles for GObjects, strict conversion between JavaScript values and
GValues by GParamSpec, and destroy that releases a whole widget tree."
```

---

### Task 7: The bridge, part 2: signals, child properties, helpers

**Files:**
- Create: `maemo-react/runtime/src/closure.c`, `src/helpers.c`, `src/debug.c`
- Modify: `maemo-react/runtime/src/bridge.c` (add four functions, replace the function list), `src/mr.h`, `src/main.c`
- Test: `maemo-react/runtime/test/bridge-signals.test.js`, `maemo-react/runtime/test/bridge-tree.test.js`

**Interfaces:**
- Consumes: Task 6 (`mr_arg_object`, `mr_js_to_gvalue`, `mr_gvalue_to_js`, `mr_handle_object`), Task 2 (`mr_call`).
- Produces:
  - In `maemo:gobject`: `connect(h, signal, fn): number` (detailed names such as `notify::label` work; the handler gets the signal arguments without the instance; its return value becomes the signal's return value, and `undefined` gives the type's zero value), `childSet(parent, child, prop, value)`, `childGet(parent, child, prop)`, `call(h, helper, ...args)`.
  - Helpers (each checks the object type): `container.add(child)`, `container.indexOf(child): number` (-1 if absent), `box.reorder(child, position)` (negative: the end), `scrolled.add(child)` (puts a viewport around widgets that cannot scroll), `widget.removeFromParent()` (also removes the viewport that `scrolled.add` made), `widget.show()`, `widget.hide()`, `button.clicked()`, `window.registerProgram()` (Hildon: adds the window to the HildonProgram; desktop: default size 800x480), `object.emit(signal, ...args)` (returns the signal's return value).
  - JS module `maemo:debug`: `stats(): { handles, closures, jsMallocSize }`, `bridgeTime(): number` (ms in GTK setters and layout helpers since the last call; it resets the counter), `flushPaint(): void` (`gdk_window_process_all_updates` + `gdk_flush`), `cpu(): { governor, kHz } | null`, `gc(): void`.
  - C API: `GClosure *mr_closure_new(JSContext *ctx, JSValueConst fn)`, `int mr_closure_count(void)`, `JSValue mr_call_helper(JSContext *ctx, GObject *o, const char *name, int argc, JSValueConst *argv)`, `JSModuleDef *mr_init_debug(JSContext *ctx, const char *name)`.

- [ ] **Step 1: Write the failing tests**

Create `maemo-react/runtime/test/bridge-signals.test.js`:

```js
import { test, assertEqual, assertThrows, run } from './harness.js';
import { create, set, connect, call, destroy } from 'maemo:gobject';
import { stats } from 'maemo:debug';

test('a handler runs when the signal is emitted', () => {
  const b = create('GtkButton');
  let n = 0;
  connect(b, 'clicked', () => { n++; });
  call(b, 'button.clicked');
  call(b, 'button.clicked');
  assertEqual(n, 2);
  destroy(b);
});

test('signal arguments arrive as JavaScript values', () => {
  const l = create('GtkLabel');
  let got;
  connect(l, 'can-activate-accel', (id) => { got = id; });
  call(l, 'object.emit', 'can-activate-accel', 7);
  assertEqual(got, 7);
  destroy(l);
});

test('the return value of the handler becomes the signal result', () => {
  const b = create('GtkButton');
  assertEqual(call(b, 'object.emit', 'popup-menu'), false);
  connect(b, 'popup-menu', () => true);
  assertEqual(call(b, 'object.emit', 'popup-menu'), true);
  destroy(b);
});

test('a detailed signal: notify::label', () => {
  const l = create('GtkLabel');
  let n = 0;
  connect(l, 'notify::label', () => { n++; });
  set(l, 'label', 'a');
  set(l, 'wrap', true);
  assertEqual(n, 1);
  destroy(l);
});

test('errors: unknown signal, and a handler that is not a function', () => {
  const l = create('GtkLabel');
  assertThrows(() => connect(l, 'nope', () => {}), /GtkLabel has no signal 'nope'/);
  assertThrows(() => connect(l, 'show', 'x'), /handler must be a function/);
  destroy(l);
});

test('destroying the object frees its closures', () => {
  const before = stats().closures;
  const b = create('GtkButton');
  connect(b, 'clicked', () => {});
  connect(b, 'enter', () => {});
  assertEqual(stats().closures, before + 2);
  destroy(b);
  assertEqual(stats().closures, before);
});

await run();
```

Create `maemo-react/runtime/test/bridge-tree.test.js`:

```js
import { test, assert, assertEqual, assertThrows, run } from './harness.js';
import { create, set, get, childSet, childGet, call, connect, destroy } from 'maemo:gobject';
import { stats, gc } from 'maemo:debug';
import { platform } from 'maemo:app';

test('container.add, container.indexOf and box.reorder', () => {
  const box = create('GtkVBox');
  const a = create('GtkLabel');
  const b = create('GtkLabel');
  call(box, 'container.add', a);
  call(box, 'container.add', b);
  assertEqual([call(box, 'container.indexOf', a), call(box, 'container.indexOf', b)], [0, 1]);
  call(box, 'box.reorder', b, 0);
  assertEqual(call(box, 'container.indexOf', b), 0);
  call(box, 'box.reorder', b, -1);
  assertEqual(call(box, 'container.indexOf', b), 1);
  destroy(box);
});

test('childSet and childGet', () => {
  const box = create('GtkHBox');
  const a = create('GtkLabel');
  call(box, 'container.add', a);
  childSet(box, a, 'expand', false);
  childSet(box, a, 'padding', 4);
  childSet(box, a, 'pack-type', 'end');
  assertEqual([childGet(box, a, 'expand'), childGet(box, a, 'padding'), childGet(box, a, 'pack-type')], [false, 4, 'end']);
  destroy(box);
});

test('childSet checks the parent and the property', () => {
  const box = create('GtkVBox');
  const a = create('GtkLabel');
  assertThrows(() => childSet(box, a, 'expand', true), /is not a child of/);
  call(box, 'container.add', a);
  assertThrows(() => childSet(box, a, 'nope', 1), /GtkVBox has no child property 'nope'/);
  destroy(box);
});

test('widget.removeFromParent', () => {
  const box = create('GtkVBox');
  const a = create('GtkLabel');
  call(box, 'container.add', a);
  call(a, 'widget.removeFromParent');
  assertEqual(call(box, 'container.indexOf', a), -1);
  destroy(box);
  destroy(a);
});

test('scrolled.add adds a viewport, and removal takes it away', () => {
  const s = create('GtkScrolledWindow');
  const inner = create('GtkVBox');
  const inner2 = create('GtkVBox');
  call(s, 'scrolled.add', inner);
  call(inner, 'widget.removeFromParent');
  call(s, 'scrolled.add', inner2); // a GTK critical (fatal in tests) if the old viewport stayed
  destroy(s);
  destroy(inner);
});

test('a helper checks the type of the object', () => {
  const l = create('GtkLabel');
  assertThrows(() => call(l, 'box.reorder', l, 0), /helper 'box.reorder' needs a GtkBox, got a GtkLabel/);
  assertThrows(() => call(l, 'nope'), /has no helper 'nope'/);
  destroy(l);
});

test('destroy releases the handles of the children', () => {
  const before = stats().handles;
  const box = create('GtkVBox');
  const l = create('GtkLabel');
  call(box, 'container.add', l);
  destroy(box);
  assertEqual(stats().handles, before);
  assertThrows(() => get(l, 'label'), /invalid handle/);
});

test('1000 create and destroy cycles leak no handles or closures', () => {
  gc();
  const before = stats();
  for (let i = 0; i < 1000; i++) {
    const box = create('GtkVBox');
    for (let j = 0; j < 3; j++) {
      const l = create('GtkLabel');
      set(l, 'label', 'row ' + j);
      call(box, 'container.add', l);
    }
    const b = create('GtkButton');
    connect(b, 'clicked', () => {});
    call(box, 'container.add', b);
    destroy(box);
  }
  gc();
  const after = stats();
  assertEqual(after.handles, before.handles);
  assertEqual(after.closures, before.closures);
  assert(after.jsMallocSize - before.jsMallocSize < 256 * 1024,
    'the JS heap grew by ' + (after.jsMallocSize - before.jsMallocSize) + ' bytes');
});

test('a window: registerProgram, show, destroy', () => {
  const w = create(platform === 'hildon' ? 'HildonWindow' : 'GtkWindow');
  call(w, 'window.registerProgram');
  call(w, 'widget.show');
  destroy(w);
});

await run();
```

- [ ] **Step 2: Run them to see them fail**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/test/run.sh desktop test/bridge-signals.test.js test/bridge-tree.test.js'
```

Expected: both `FAIL` with `unknown native module 'maemo:debug'`.

- [ ] **Step 3: Write closure.c**

Create `maemo-react/runtime/src/closure.c`:

```c
/* GClosures that call JavaScript functions, for maemo:gobject connect().
   GLib frees a closure when the object goes away; then we free the function. */
#include <gtk/gtk.h>
#include "mr.h"

#define MAX_SIGNAL_ARGS 16

typedef struct {
    GClosure closure;
    JSValue fn;
} JsClosure;

static int live_closures;

int mr_closure_count(void)
{
    return live_closures;
}

static void closure_invalidate(gpointer data, GClosure *c)
{
    JsClosure *jc = (JsClosure *)c;
    JS_FreeValue(mr_ctx, jc->fn);
    jc->fn = JS_UNDEFINED;
    live_closures--;
}

static void closure_marshal(GClosure *c, GValue *ret, guint n_params, const GValue *params,
                            gpointer hint, gpointer data)
{
    JsClosure *jc = (JsClosure *)c;
    JSValue args[MAX_SIGNAL_ARGS], r;
    guint i, argc = n_params > 0 ? n_params - 1 : 0; /* params[0] is the instance */
    if (argc > MAX_SIGNAL_ARGS)
        argc = MAX_SIGNAL_ARGS;
    for (i = 0; i < argc; i++)
        args[i] = mr_gvalue_to_js(mr_ctx, &params[i + 1], 0);
    r = mr_call(jc->fn, JS_UNDEFINED, argc, (JSValueConst *)args);
    for (i = 0; i < argc; i++)
        JS_FreeValue(mr_ctx, args[i]);
    if (ret && G_IS_VALUE(ret) && !JS_IsUndefined(r)) {
        if (mr_js_to_gvalue(mr_ctx, r, ret, NULL, "the return value of a signal handler") < 0)
            mr_report_exception(mr_ctx);
    }
    JS_FreeValue(mr_ctx, r);
}

GClosure *mr_closure_new(JSContext *ctx, JSValueConst fn)
{
    GClosure *c = g_closure_new_simple(sizeof(JsClosure), NULL);
    ((JsClosure *)c)->fn = JS_DupValue(ctx, fn);
    live_closures++;
    g_closure_add_invalidate_notifier(c, NULL, closure_invalidate);
    g_closure_set_marshal(c, closure_marshal);
    return c;
}
```

- [ ] **Step 4: Write helpers.c**

Create `maemo-react/runtime/src/helpers.c`:

```c
/* call() helpers: GTK functions that are not properties or signals. */
#include <string.h>
#include <gtk/gtk.h>
#ifdef MR_HILDON
#include <hildon/hildon-program.h>
#include <hildon/hildon-window.h>
#endif
#include "mr.h"

typedef JSValue (*HelperFn)(JSContext *ctx, GObject *o, int argc, JSValueConst *argv);

static GtkWidget *arg_widget(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper)
{
    GObject *o;
    if (i >= argc) {
        JS_ThrowTypeError(ctx, "%s: missing argument %d", helper, i + 1);
        return NULL;
    }
    if (!(o = mr_arg_object(ctx, argv[i])))
        return NULL;
    if (!GTK_IS_WIDGET(o)) {
        JS_ThrowTypeError(ctx, "%s: expected a widget, got a %s", helper, G_OBJECT_TYPE_NAME(o));
        return NULL;
    }
    return GTK_WIDGET(o);
}

static JSValue h_container_add(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "container.add");
    if (!child)
        return JS_EXCEPTION;
    if (gtk_widget_get_parent(child))
        return JS_ThrowTypeError(ctx, "container.add: the %s has a parent already", G_OBJECT_TYPE_NAME(child));
    gtk_container_add(GTK_CONTAINER(o), child);
    return JS_UNDEFINED;
}

static JSValue h_container_index_of(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "container.indexOf");
    GList *list;
    int i;
    if (!child)
        return JS_EXCEPTION;
    list = gtk_container_get_children(GTK_CONTAINER(o));
    i = g_list_index(list, child);
    g_list_free(list);
    return JS_NewInt32(ctx, i);
}

static JSValue h_box_reorder(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "box.reorder");
    int32_t pos;
    if (!child)
        return JS_EXCEPTION;
    if (argc < 2 || !JS_IsNumber(argv[1]) || JS_ToInt32(ctx, &pos, argv[1]))
        return JS_ThrowTypeError(ctx, "box.reorder: the position must be a number");
    gtk_box_reorder_child(GTK_BOX(o), child, pos);
    return JS_UNDEFINED;
}

static JSValue h_scrolled_add(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "scrolled.add");
    if (!child)
        return JS_EXCEPTION;
    /* Tree views and text views scroll by themselves; others need a viewport. */
    if (GTK_WIDGET_GET_CLASS(child)->set_scroll_adjustments_signal)
        gtk_container_add(GTK_CONTAINER(o), child);
    else
        gtk_scrolled_window_add_with_viewport(GTK_SCROLLED_WINDOW(o), child);
    return JS_UNDEFINED;
}

static JSValue h_remove_from_parent(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *w = GTK_WIDGET(o);
    GtkWidget *parent = gtk_widget_get_parent(w);
    GtkWidget *grand;
    if (!parent)
        return JS_UNDEFINED;
    grand = gtk_widget_get_parent(parent);
    gtk_container_remove(GTK_CONTAINER(parent), w);
    /* Remove the viewport that scrolled.add made, so the scrolled window is
       empty again. */
    if (GTK_IS_VIEWPORT(parent) && grand && GTK_IS_SCROLLED_WINDOW(grand))
        gtk_container_remove(GTK_CONTAINER(grand), parent);
    return JS_UNDEFINED;
}

static JSValue h_show(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gtk_widget_show(GTK_WIDGET(o));
    return JS_UNDEFINED;
}

static JSValue h_hide(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gtk_widget_hide(GTK_WIDGET(o));
    return JS_UNDEFINED;
}

static JSValue h_button_clicked(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gtk_button_clicked(GTK_BUTTON(o));
    return JS_UNDEFINED;
}

static JSValue h_register_program(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
#ifdef MR_HILDON
    if (HILDON_IS_WINDOW(o))
        hildon_program_add_window(hildon_program_get_instance(), HILDON_WINDOW(o));
#else
    /* The desktop dev host: the size of the tablet's screen. */
    gtk_window_set_default_size(GTK_WINDOW(o), 800, 480);
#endif
    return JS_UNDEFINED;
}

static JSValue h_object_emit(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    const char *name;
    guint id, i;
    GQuark detail;
    GSignalQuery q;
    GValue *params;
    GValue ret = { 0 };
    GType rtype;
    JSValue result = JS_UNDEFINED;
    int bad = 0;
    if (argc < 1 || !(name = JS_ToCString(ctx, argv[0])))
        return JS_ThrowTypeError(ctx, "object.emit: give the signal name");
    if (!g_signal_parse_name(name, G_OBJECT_TYPE(o), &id, &detail, TRUE)) {
        JS_ThrowTypeError(ctx, "%s has no signal '%s'", G_OBJECT_TYPE_NAME(o), name);
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    JS_FreeCString(ctx, name);
    g_signal_query(id, &q);
    if ((guint)(argc - 1) != q.n_params)
        return JS_ThrowTypeError(ctx, "signal '%s' takes %u arguments", q.signal_name, q.n_params);
    params = g_new0(GValue, q.n_params + 1);
    g_value_init(&params[0], G_OBJECT_TYPE(o));
    g_value_set_object(&params[0], o);
    for (i = 0; i < q.n_params && !bad; i++) {
        g_value_init(&params[i + 1], q.param_types[i] & ~G_SIGNAL_TYPE_STATIC_SCOPE);
        bad = mr_js_to_gvalue(ctx, argv[i + 1], &params[i + 1], NULL, q.signal_name) < 0;
    }
    if (!bad) {
        rtype = q.return_type & ~G_SIGNAL_TYPE_STATIC_SCOPE;
        if (rtype != G_TYPE_NONE)
            g_value_init(&ret, rtype);
        g_signal_emitv(params, id, detail, rtype != G_TYPE_NONE ? &ret : NULL);
        if (rtype != G_TYPE_NONE) {
            result = mr_gvalue_to_js(ctx, &ret, 0);
            g_value_unset(&ret);
        }
    }
    for (i = 0; i <= q.n_params; i++)
        if (G_IS_VALUE(&params[i]))
            g_value_unset(&params[i]);
    g_free(params);
    return bad ? JS_EXCEPTION : result;
}

static const struct {
    const char *name;
    GType (*type)(void);
    HelperFn fn;
    gboolean emits; /* runs JavaScript: not counted as GTK time */
} helpers[] = {
    { "container.add", gtk_container_get_type, h_container_add, FALSE },
    { "container.indexOf", gtk_container_get_type, h_container_index_of, FALSE },
    { "box.reorder", gtk_box_get_type, h_box_reorder, FALSE },
    { "scrolled.add", gtk_scrolled_window_get_type, h_scrolled_add, FALSE },
    { "widget.removeFromParent", gtk_widget_get_type, h_remove_from_parent, FALSE },
    { "widget.show", gtk_widget_get_type, h_show, FALSE },
    { "widget.hide", gtk_widget_get_type, h_hide, FALSE },
    { "button.clicked", gtk_button_get_type, h_button_clicked, TRUE },
    { "window.registerProgram", gtk_window_get_type, h_register_program, FALSE },
    { "object.emit", g_object_get_type, h_object_emit, TRUE },
};

JSValue mr_call_helper(JSContext *ctx, GObject *o, const char *name, int argc, JSValueConst *argv)
{
    guint i;
    double t0;
    JSValue r;
    for (i = 0; i < G_N_ELEMENTS(helpers); i++) {
        if (strcmp(helpers[i].name, name))
            continue;
        if (!g_type_is_a(G_OBJECT_TYPE(o), helpers[i].type()))
            return JS_ThrowTypeError(ctx, "helper '%s' needs a %s, got a %s", name,
                                     g_type_name(helpers[i].type()), G_OBJECT_TYPE_NAME(o));
        t0 = mr_now_ms();
        r = helpers[i].fn(ctx, o, argc, argv);
        if (!helpers[i].emits)
            mr_bridge_ms += mr_now_ms() - t0;
        return r;
    }
    return JS_ThrowTypeError(ctx, "maemo:gobject has no helper '%s'", name);
}
```

- [ ] **Step 5: Write debug.c**

Create `maemo-react/runtime/src/debug.c`:

```c
/* maemo:debug -- numbers for tests and benchmarks. */
#include <stdlib.h>
#include <gtk/gtk.h>
#include "mr.h"

static JSValue js_stats(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JSMemoryUsage mu;
    JSValue o = JS_NewObject(ctx);
    JS_ComputeMemoryUsage(mr_rt, &mu);
    JS_SetPropertyStr(ctx, o, "handles", JS_NewInt32(ctx, mr_bridge_handle_count()));
    JS_SetPropertyStr(ctx, o, "closures", JS_NewInt32(ctx, mr_closure_count()));
    JS_SetPropertyStr(ctx, o, "jsMallocSize", JS_NewInt64(ctx, mu.malloc_size));
    return o;
}

static JSValue js_bridge_time(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double v = mr_bridge_ms;
    mr_bridge_ms = 0;
    return JS_NewFloat64(ctx, v);
}

static JSValue js_flush_paint(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gdk_window_process_all_updates();
    gdk_flush();
    return JS_UNDEFINED;
}

static JSValue js_gc(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JS_RunGC(mr_rt);
    return JS_UNDEFINED;
}

static gchar *read_line(const char *path)
{
    gchar *s = NULL;
    if (!g_file_get_contents(path, &s, NULL, NULL))
        return NULL;
    return g_strstrip(s);
}

static JSValue js_cpu(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gchar *gov = read_line("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor");
    gchar *khz = read_line("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq");
    JSValue o;
    if (!gov) {
        g_free(khz);
        return JS_NULL;
    }
    o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "governor", JS_NewString(ctx, gov));
    JS_SetPropertyStr(ctx, o, "kHz", khz ? JS_NewInt32(ctx, atoi(khz)) : JS_NULL);
    g_free(gov);
    g_free(khz);
    return o;
}

static const JSCFunctionListEntry debug_funcs[] = {
    JS_CFUNC_DEF("stats", 0, js_stats),
    JS_CFUNC_DEF("bridgeTime", 0, js_bridge_time),
    JS_CFUNC_DEF("flushPaint", 0, js_flush_paint),
    JS_CFUNC_DEF("gc", 0, js_gc),
    JS_CFUNC_DEF("cpu", 0, js_cpu),
};

static int debug_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, debug_funcs, G_N_ELEMENTS(debug_funcs));
}

JSModuleDef *mr_init_debug(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, debug_init);
    if (!m)
        return NULL;
    JS_AddModuleExportList(ctx, m, debug_funcs, G_N_ELEMENTS(debug_funcs));
    return m;
}
```

- [ ] **Step 6: Add the bridge functions**

In `bridge.c`, add these functions before `static const JSCFunctionListEntry gobject_funcs[]`:

```c
static JSValue js_connect(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    guint id;
    GQuark detail;
    gulong hid;
    if (!o)
        return JS_EXCEPTION;
    if (!JS_IsFunction(ctx, argv[2]))
        return JS_ThrowTypeError(ctx, "connect: the handler must be a function");
    if (!(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    if (!g_signal_parse_name(name, G_OBJECT_TYPE(o), &id, &detail, TRUE)) {
        JS_ThrowTypeError(ctx, "%s has no signal '%s'", G_OBJECT_TYPE_NAME(o), name);
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    JS_FreeCString(ctx, name);
    hid = g_signal_connect_closure_by_id(o, id, detail, mr_closure_new(ctx, argv[2]), FALSE);
    return JS_NewInt64(ctx, hid);
}

static GParamSpec *find_child_property(JSContext *ctx, GObject *parent, GObject *child, const char *name)
{
    GParamSpec *ps;
    if (!GTK_IS_CONTAINER(parent)) {
        JS_ThrowTypeError(ctx, "%s is not a container", G_OBJECT_TYPE_NAME(parent));
        return NULL;
    }
    if (!GTK_IS_WIDGET(child) || gtk_widget_get_parent(GTK_WIDGET(child)) != GTK_WIDGET(parent)) {
        JS_ThrowTypeError(ctx, "the %s is not a child of the %s", G_OBJECT_TYPE_NAME(child),
                          G_OBJECT_TYPE_NAME(parent));
        return NULL;
    }
    ps = gtk_container_class_find_child_property(G_OBJECT_GET_CLASS(parent), name);
    if (!ps)
        JS_ThrowTypeError(ctx, "%s has no child property '%s'", G_OBJECT_TYPE_NAME(parent), name);
    return ps;
}

static JSValue js_child_set(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double t0 = mr_now_ms();
    GObject *parent = mr_arg_object(ctx, argv[0]);
    GObject *child = parent ? mr_arg_object(ctx, argv[1]) : NULL;
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    int r;
    if (!child || !(name = JS_ToCString(ctx, argv[2])))
        return JS_EXCEPTION;
    if (!(ps = find_child_property(ctx, parent, child, name))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    r = mr_js_to_gvalue(ctx, argv[3], &v, ps, name);
    if (r == 0)
        gtk_container_child_set_property(GTK_CONTAINER(parent), GTK_WIDGET(child), name, &v);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    mr_bridge_ms += mr_now_ms() - t0;
    return r == 0 ? JS_UNDEFINED : JS_EXCEPTION;
}

static JSValue js_child_get(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    GObject *parent = mr_arg_object(ctx, argv[0]);
    GObject *child = parent ? mr_arg_object(ctx, argv[1]) : NULL;
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    JSValue r;
    if (!child || !(name = JS_ToCString(ctx, argv[2])))
        return JS_EXCEPTION;
    if (!(ps = find_child_property(ctx, parent, child, name))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    gtk_container_child_get_property(GTK_CONTAINER(parent), GTK_WIDGET(child), name, &v);
    r = mr_gvalue_to_js(ctx, &v, 1);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    return r;
}

static JSValue js_call(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    JSValue r;
    if (!o || !(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    g_object_ref(o); /* a helper can emit a signal whose handler destroys o */
    r = mr_call_helper(ctx, o, name, argc > 2 ? argc - 2 : 0, argv + 2);
    g_object_unref(o);
    JS_FreeCString(ctx, name);
    return r;
}
```

Replace the `gobject_funcs` array with:

```c
static const JSCFunctionListEntry gobject_funcs[] = {
    JS_CFUNC_DEF("create", 1, js_create),
    JS_CFUNC_DEF("set", 3, js_set),
    JS_CFUNC_DEF("get", 2, js_get),
    JS_CFUNC_DEF("reset", 2, js_reset),
    JS_CFUNC_DEF("connect", 3, js_connect),
    JS_CFUNC_DEF("childSet", 4, js_child_set),
    JS_CFUNC_DEF("childGet", 3, js_child_get),
    JS_CFUNC_DEF("call", 2, js_call),
    JS_CFUNC_DEF("destroy", 1, js_destroy),
};
```

- [ ] **Step 7: Declare and register**

Add to `mr.h` before `#endif`:

```c
/* closure.c */
GClosure *mr_closure_new(JSContext *ctx, JSValueConst fn);
int mr_closure_count(void);

/* helpers.c */
JSValue mr_call_helper(JSContext *ctx, GObject *o, const char *name, int argc, JSValueConst *argv);

/* debug.c */
JSModuleDef *mr_init_debug(JSContext *ctx, const char *name);
```

In `main.c`, after `mr_register_module("maemo:gobject", mr_init_gobject);`, add:

```c
    mr_register_module("maemo:debug", mr_init_debug);
```

- [ ] **Step 8: Run all runtime tests on both targets**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: every line is `PASS`. The 1000-cycle test takes up to a minute under qemu-user.

- [ ] **Step 9: Commit**

```bash
git add maemo-react/runtime/src maemo-react/runtime/test
git commit -m "Add signals, child properties and helpers to maemo:gobject

JavaScript closures for GTK signals, container child properties, the
call() helpers that the renderer needs, and maemo:debug for tests and
benchmarks."
```


---

### Task 8: The prelude, part 1: console, UTF-8, URL

**Files:**
- Create: `maemo-react/prelude/package.json`, `prelude/src/index.js`, `prelude/src/console.js`, `prelude/src/encoding.js`, `prelude/src/url.js`
- Create: `maemo-react/vitest.config.ts`
- Test: `maemo-react/prelude/test/encoding.test.js`, `prelude/test/url.test.js`, `prelude/test/console.test.js`, `maemo-react/runtime/test/prelude.test.js`
- Modify: `maemo-react/runtime/src/main.c` (load the prelude), `maemo-react/runtime/Makefile` (copy it)

**Interfaces:**
- Consumes: the host (Tasks 2–7).
- Produces:
  - `npm run build:prelude` writes `prelude/dist/prelude.js` (an ES module, target ES2022, `maemo:*` external).
  - The host loads the prelude module before the application, from `$MR_PRELUDE` or else `<binary folder>/../lib/maemo-react/prelude.js`. Without a prelude it exits with code 1 and a message. `runtime/build.sh` copies the prelude to `runtime/build/<target>/lib/maemo-react/prelude.js`.
  - Globals: `console.*` with object formatting, `TextEncoder`, `TextDecoder` (UTF-8 only; `stream` is not supported), `URL`, `URLSearchParams` (a WHATWG subset: no internationalized host names), `queueMicrotask`.
  - Module exports used by Task 10: `encoding.js` exports `TextEncoder`, `TextDecoder`; `url.js` exports `URL`, `URLSearchParams`; `console.js` exports `inspect(value)`, `format(args)`, `installConsole(console)`.

- [ ] **Step 1: Write the package, the Vitest config and the failing tests**

Create `maemo-react/prelude/package.json`:

```json
{
  "name": "@maemo-react/prelude",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "esbuild src/index.js --bundle --format=esm --target=es2022 --external:maemo:* --outfile=dist/prelude.js --log-level=warning"
  }
}
```

In `maemo-react/package.json`, add the workspaces after the `"type"` line:

```json
  "workspaces": ["prelude", "packages/*", "examples/*"],
```

`packages/*` and `examples/*` match nothing yet; later tasks add those folders.

The prelude runs only on QuickJS, which supports ES2023, so it uses target ES2022 (class private fields stay native). Application bundles stay at ES2020 (Global Constraints).

Create `maemo-react/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'prelude/test/**/*.test.js',
      'packages/*/test/**/*.test.{ts,tsx}',
      'typegen/test/**/*.test.mjs',
    ],
  },
});
```

Create `maemo-react/prelude/test/encoding.test.js`:

```js
import { expect, test } from 'vitest';
import { TextDecoder as OurDecoder, TextEncoder as OurEncoder } from '../src/encoding.js';

// Node implements the WHATWG Encoding standard, so it is the reference.
const hex = (u8) => Buffer.from(u8).toString('hex');

test.each(['', 'abc', 'Ñandú € 😀', '\uD800x', 'x\uDFFF', '\u{10FFFF}'])('encode %j like Node', (s) => {
  expect(hex(new OurEncoder().encode(s))).toBe(hex(new TextEncoder().encode(s)));
});

test.each(['c3b1', 'c080', 'e282', 'eda080', 'f4908080', 'efbbbf41', 'f09f9880', 'ff', 'e2ac', '61e2828262', 'f0908d'])(
  'decode %s like Node',
  (h) => {
    const bytes = Buffer.from(h, 'hex');
    expect(new OurDecoder().decode(bytes)).toBe(new TextDecoder().decode(bytes));
  },
);

test('ignoreBOM keeps the byte order mark', () => {
  expect(new OurDecoder('utf-8', { ignoreBOM: true }).decode(Buffer.from('efbbbf41', 'hex'))).toBe('﻿A');
});

test('fatal throws on bad data', () => {
  expect(() => new OurDecoder('utf-8', { fatal: true }).decode(Buffer.from('ff', 'hex'))).toThrow(TypeError);
});

test('only UTF-8 is supported', () => {
  expect(() => new OurDecoder('latin1')).toThrow(RangeError);
});

test('decode takes an ArrayBuffer, a typed array or a DataView', () => {
  const u8 = new OurEncoder().encode('hi');
  expect(new OurDecoder().decode(u8.buffer)).toBe('hi');
  expect(new OurDecoder().decode(new DataView(u8.buffer))).toBe('hi');
});
```

Create `maemo-react/prelude/test/url.test.js`:

```js
import { describe, expect, test } from 'vitest';
import { URL as OurURL, URLSearchParams as OurParams } from '../src/url.js';

// Node's URL is a full WHATWG implementation, so it is the reference.
const CASES = [
  ['https://Example.COM:443/a/./b/../c?x=1#frag'],
  ['http://user:pa ss@host:8080/p a t h?q a#f a'],
  ['HTTP://example.com'],
  ['https://example.com/%7Euser/'],
  ['https://example.com/Ñandú?€=1#ü'],
  ['ws://example.com:80/chat'],
  ['https://[::1]:8443/x'],
  ['mailto:someone@example.com'],
  ['file:///etc/hosts'],
  ['file:/etc/x'],
  ['file://localhost/etc/x'],
  ['../d', 'https://example.com/a/b/c'],
  ['/root', 'https://example.com/a/b'],
  ['//other.org/x', 'https://example.com/a'],
  ['?q=2', 'https://example.com/a?q=1#f'],
  ['#top', 'https://example.com/a?q=1'],
  ['', 'https://example.com/a?q=1#f'],
  ['x/./y/../z', 'http://example.com/dir/file'],
  ['http:rel', 'http://example.com/dir/file'],
  ['  https://example.com/trim  '],
  ['https://example.com\\back\\slash'],
  ['https://example.com/a/%2e%2E/b'],
  ['https://example.com/a/b/..'],
  ['https://example.com?'],
  ['https://example.com/#'],
  ['https://u@example.com/'],
  ['https://example.com:/x'],
  ["https://example.com/?a='b'"],
  ['data:text/plain,hello'],
  ['https://example.com/a?b=c\\d'],
  ['..', 'https://example.com/a/b/c'],
  ['https://EXAMPLE.com/%41'],
];
const FIELDS = ['href', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'origin'];

describe('URL gives the same result as Node', () => {
  for (const [input, base] of CASES) {
    test(JSON.stringify(input) + (base ? ' against ' + base : ''), () => {
      const ours = new OurURL(input, base);
      const node = new URL(input, base);
      for (const f of FIELDS) expect([f, ours[f]]).toEqual([f, node[f]]);
    });
  }
});

test.each(['https://exa mple.com', 'http://host:99999/', 'no-scheme', 'http://[::1/x', 'https://'])(
  'invalid: %s',
  (input) => {
    expect(() => new URL(input)).toThrow(TypeError);
    expect(() => new OurURL(input)).toThrow(TypeError);
  },
);

test('internationalized host names give a clear error', () => {
  expect(() => new OurURL('https://ñ.example/')).toThrow(/internationalized host names are not supported/);
});

test.each(['a=1&b=2&a=3', 'x=a+b%20c&y=%E2%82%AC', '=empty&novalue', '&&a=1&&'])('URLSearchParams %s', (q) => {
  const ours = new OurParams(q);
  const node = new URLSearchParams(q);
  expect(ours.toString()).toBe(node.toString());
  expect([...ours]).toEqual([...node]);
});

test('searchParams and search stay linked', () => {
  const ours = new OurURL('https://e.com/?a=1');
  const node = new URL('https://e.com/?a=1');
  ours.searchParams.append('b', 'x y');
  node.searchParams.append('b', 'x y');
  expect(ours.href).toBe(node.href);
  ours.search = '?z=9';
  expect(ours.searchParams.get('z')).toBe('9');
  ours.searchParams.delete('z');
  expect(ours.href).toBe('https://e.com/');
});

test('URL.canParse', () => {
  expect(OurURL.canParse('https://e.com/')).toBe(true);
  expect(OurURL.canParse('nope')).toBe(false);
});
```

Create `maemo-react/prelude/test/console.test.js`:

```js
import { expect, test } from 'vitest';
import { format, inspect } from '../src/console.js';

test('inspect formats nested values, cycles and special objects', () => {
  const a = {
    x: 1,
    'a-b': 'str',
    arr: [1, 'two', null, undefined],
    nested: { deep: { deeper: { deepest: 1 } } },
    f: function named() {},
    m: new Map([[1, 'a']]),
    s: new Set(),
    u8: new Uint8Array(3),
  };
  a.self = a;
  expect(inspect(a)).toBe(
    '{ x: 1, "a-b": "str", arr: [ 1, "two", null, undefined ], nested: { deep: { deeper: [Object] } }, ' +
      'f: [Function named], m: Map(1) { 1 => "a" }, s: Set(0) {}, u8: Uint8Array(3), self: [Circular] }',
  );
});

test('format keeps top-level strings as they are', () => {
  expect(format(['plain', 42, [], {}])).toBe('plain 42 [] {}');
});

test('errors print their name, message and stack', () => {
  expect(format([new Error('boom')]).split('\n')[0]).toBe('Error: boom');
});
```

Create `maemo-react/runtime/test/prelude.test.js`:

```js
import { test, assertEqual, run } from './harness.js';

test('the prelude installs the globals', () => {
  for (const name of ['TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'queueMicrotask']) {
    assertEqual([name, typeof globalThis[name]], [name, 'function']);
  }
});

test('a UTF-8 round trip in QuickJS', () => {
  const s = 'Ñandú € 😀';
  assertEqual(new TextDecoder().decode(new TextEncoder().encode(s)), s);
  assertEqual(new TextEncoder().encode('€').length, 3);
});

test('URL resolves a relative reference in QuickJS', () => {
  assertEqual(new URL('../x?y=1', 'https://example.com/a/b/c').href, 'https://example.com/a/x?y=1');
});

test('queueMicrotask runs before a timer', async () => {
  const seen = [];
  setTimeout(() => seen.push('timer'), 0);
  queueMicrotask(() => seen.push('micro'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEqual(seen, ['micro', 'timer']);
});

test('console.log formats objects', () => {
  console.log({ a: 1, b: [1, 2], c: 'x' });
});

await run();
```

- [ ] **Step 2: Run the Node tests to see them fail**

```bash
npm install
npx vitest run prelude
```

Expected: FAIL, because `prelude/src/encoding.js` and the other modules do not exist.

- [ ] **Step 3: Write the prelude modules**

Create `maemo-react/prelude/src/encoding.js`:

```js
// TextEncoder and TextDecoder for UTF-8 only, as the WHATWG Encoding standard
// describes them. The decoder replaces bad sequences with U+FFFD.

function toBytes(input) {
  if (input === undefined) return new Uint8Array(0);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('TextDecoder.decode: the argument must be an ArrayBuffer or a view');
}

export class TextEncoder {
  get encoding() {
    return 'utf-8';
  }

  encode(input = '') {
    const s = String(input);
    const out = new Uint8Array(s.length * 3);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        } else {
          c = 0xfffd;
        }
      } else if (c >= 0xd800 && c <= 0xdfff) {
        c = 0xfffd;
      }
      if (c < 0x80) {
        out[n++] = c;
      } else if (c < 0x800) {
        out[n++] = 0xc0 | (c >> 6);
        out[n++] = 0x80 | (c & 63);
      } else if (c < 0x10000) {
        out[n++] = 0xe0 | (c >> 12);
        out[n++] = 0x80 | ((c >> 6) & 63);
        out[n++] = 0x80 | (c & 63);
      } else {
        out[n++] = 0xf0 | (c >> 18);
        out[n++] = 0x80 | ((c >> 12) & 63);
        out[n++] = 0x80 | ((c >> 6) & 63);
        out[n++] = 0x80 | (c & 63);
      }
    }
    return out.slice(0, n);
  }
}

export class TextDecoder {
  constructor(label = 'utf-8', options = {}) {
    const l = String(label).trim().toLowerCase();
    if (l !== 'utf-8' && l !== 'utf8' && l !== 'unicode-1-1-utf-8') {
      throw new RangeError('TextDecoder: only utf-8 is supported, not ' + label);
    }
    this.fatal = Boolean(options.fatal);
    this.ignoreBOM = Boolean(options.ignoreBOM);
  }

  get encoding() {
    return 'utf-8';
  }

  decode(input, options) {
    if (options && options.stream) throw new TypeError('TextDecoder: stream mode is not supported');
    const bytes = toBytes(input);
    let out = '';
    let chunk = [];
    let need = 0;
    let cp = 0;
    let lower = 0x80;
    let upper = 0xbf;
    const push = (c) => {
      if (c > 0xffff) {
        c -= 0x10000;
        chunk.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      } else {
        chunk.push(c);
      }
      if (chunk.length > 8192) {
        out += String.fromCharCode.apply(null, chunk);
        chunk = [];
      }
    };
    const bad = () => {
      if (this.fatal) throw new TypeError('TextDecoder: the data is not valid UTF-8');
      push(0xfffd);
    };
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (need === 0) {
        if (b <= 0x7f) {
          push(b);
        } else if (b >= 0xc2 && b <= 0xdf) {
          need = 1;
          cp = b & 0x1f;
        } else if (b >= 0xe0 && b <= 0xef) {
          if (b === 0xe0) lower = 0xa0;
          if (b === 0xed) upper = 0x9f;
          need = 2;
          cp = b & 0xf;
        } else if (b >= 0xf0 && b <= 0xf4) {
          if (b === 0xf0) lower = 0x90;
          if (b === 0xf4) upper = 0x8f;
          need = 3;
          cp = b & 0x7;
        } else {
          bad();
        }
        continue;
      }
      if (b < lower || b > upper) {
        need = 0;
        cp = 0;
        lower = 0x80;
        upper = 0xbf;
        bad();
        i--; // this byte can start a new sequence
        continue;
      }
      lower = 0x80;
      upper = 0xbf;
      cp = (cp << 6) | (b & 0x3f);
      if (--need === 0) push(cp);
    }
    if (need) bad();
    if (chunk.length) out += String.fromCharCode.apply(null, chunk);
    if (!this.ignoreBOM && out.charCodeAt(0) === 0xfeff) out = out.slice(1);
    return out;
  }
}
```

Create `maemo-react/prelude/src/url.js`:

```js
// A subset of the WHATWG URL standard: the special schemes (http, https, ws,
// wss, ftp, file) and opaque URLs such as mailto: or data:. Not supported:
// internationalized host names, IPv4 short forms such as 127.1, and
// non-special URLs with an authority (foo://host/path).
import { TextDecoder, TextEncoder } from './encoding.js';

const DEFAULT_PORT = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21', 'file:': '' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Percent-encode sets: the ASCII characters that are encoded in addition to
// controls, space and all non-ASCII characters.
const FRAGMENT_SET = '"<>`';
const QUERY_SET = '"#<>';
const SPECIAL_QUERY_SET = QUERY_SET + "'";
const PATH_SET = QUERY_SET + '?`{}^';
const USERINFO_SET = PATH_SET + '/:;=@[\\]|';
const FORBIDDEN_HOST = ' #%/:<>?@[\\]^|';

function hex(b) {
  return '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
}

function encodeSet(s, set) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c > 0x20 && c < 0x7f && !set.includes(ch)) {
      out += ch;
    } else if (c < 0x80) {
      out += hex(c);
    } else {
      for (const b of encoder.encode(ch)) out += hex(b);
    }
  }
  return out;
}

function encodeOpaque(s) {
  // Opaque paths encode only controls and non-ASCII characters.
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c < 0x7f) out += ch;
    else if (c < 0x80) out += hex(c);
    else for (const b of encoder.encode(ch)) out += hex(b);
  }
  return out;
}

function percentDecodeBytes(s) {
  const bytes = encoder.encode(s);
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x25 && i + 2 < bytes.length) {
      const h = String.fromCharCode(bytes[i + 1], bytes[i + 2]);
      if (/^[0-9a-fA-F]{2}$/.test(h)) {
        out[n++] = parseInt(h, 16);
        i += 2;
        continue;
      }
    }
    out[n++] = b;
  }
  return out.slice(0, n);
}

function percentDecode(s) {
  return decoder.decode(percentDecodeBytes(s));
}

function invalid(input) {
  return new TypeError('Invalid URL: ' + input);
}

function parseHost(h, input) {
  if (h.startsWith('[')) {
    if (!h.endsWith(']') || !/^\[[0-9a-fA-F:.]+\]$/.test(h)) throw invalid(input);
    return h.toLowerCase();
  }
  const host = percentDecode(h).toLowerCase();
  if (host === '') throw invalid(input);
  for (const ch of host) {
    if (ch.codePointAt(0) >= 0x80) {
      throw new TypeError('Invalid URL: internationalized host names are not supported: ' + input);
    }
    if (ch.codePointAt(0) < 0x21 || FORBIDDEN_HOST.includes(ch)) throw invalid(input);
  }
  return host;
}

function isDouble(seg) {
  const s = seg.toLowerCase();
  return s === '..' || s === '.%2e' || s === '%2e.' || s === '%2e%2e';
}

function isSingle(seg) {
  const s = seg.toLowerCase();
  return s === '.' || s === '%2e';
}

// Remove "." and ".." segments and encode each segment. The path starts with "/".
function normalizePath(path) {
  const segs = path.split('/').slice(1);
  const out = [];
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    if (isDouble(seg)) {
      out.pop();
      if (last) out.push('');
    } else if (isSingle(seg)) {
      if (last) out.push('');
    } else {
      out.push(encodeSet(seg, PATH_SET));
    }
  });
  return '/' + out.join('/');
}

// In special URLs, a backslash before the query or the fragment is a slash.
function slashes(s) {
  const cut = s.search(/[?#]/);
  return cut < 0 ? s.replace(/\\/g, '/') : s.slice(0, cut).replace(/\\/g, '/') + s.slice(cut);
}

// Split "path?query#fragment". Query and fragment are null when absent.
function splitTail(tail) {
  let fragment = null;
  let query = null;
  const h = tail.indexOf('#');
  if (h >= 0) {
    fragment = tail.slice(h + 1);
    tail = tail.slice(0, h);
  }
  const q = tail.indexOf('?');
  if (q >= 0) {
    query = tail.slice(q + 1);
    tail = tail.slice(0, q);
  }
  return { path: tail, query, fragment };
}

function finish(rec, path, query, fragment, special) {
  rec.pathname = rec.opaque ? encodeOpaque(path) : normalizePath(path || '/');
  rec.query = query === null ? null : encodeSet(query, special ? SPECIAL_QUERY_SET : QUERY_SET);
  rec.fragment = fragment === null ? null : encodeSet(fragment, FRAGMENT_SET);
  return rec;
}

function parseAuthority(protocol, rest, input) {
  const end = rest.search(/[/\\?#]/);
  const auth = end < 0 ? rest : rest.slice(0, end);
  const tail = end < 0 ? '' : rest.slice(end);
  const rec = { protocol, username: '', password: '', hostname: '', port: '', opaque: false };
  let hostport = auth;
  const at = auth.lastIndexOf('@');
  if (at >= 0) {
    const userinfo = auth.slice(0, at);
    hostport = auth.slice(at + 1);
    const c = userinfo.indexOf(':');
    rec.username = encodeSet(c < 0 ? userinfo : userinfo.slice(0, c), USERINFO_SET);
    rec.password = c < 0 ? '' : encodeSet(userinfo.slice(c + 1), USERINFO_SET);
  }
  let port = '';
  if (hostport.startsWith('[')) {
    const close = hostport.indexOf(']');
    if (close < 0) throw invalid(input);
    const after = hostport.slice(close + 1);
    if (after !== '' && after[0] !== ':') throw invalid(input);
    port = after.slice(1);
    hostport = hostport.slice(0, close + 1);
  } else {
    const c = hostport.lastIndexOf(':');
    if (c >= 0) {
      port = hostport.slice(c + 1);
      hostport = hostport.slice(0, c);
    }
  }
  if (protocol === 'file:' && hostport === '') {
    rec.hostname = '';
  } else {
    rec.hostname = parseHost(hostport, input);
  }
  if (rec.hostname === 'localhost' && protocol === 'file:') rec.hostname = '';
  if (port !== '') {
    if (!/^[0-9]+$/.test(port) || Number(port) > 65535) throw invalid(input);
    port = String(Number(port));
    rec.port = port === DEFAULT_PORT[protocol] ? '' : port;
  }
  const t = splitTail(slashes(tail));
  return finish(rec, t.path, t.query, t.fragment, true);
}

function copyAuthority(base) {
  return {
    protocol: base.protocol,
    username: base.username,
    password: base.password,
    hostname: base.hostname,
    port: base.port,
    opaque: false,
  };
}

function resolve(s, base, input) {
  const special = base.protocol in DEFAULT_PORT;
  if (base.opaque) {
    if (!s.startsWith('#')) throw invalid(input);
    return { ...base, fragment: encodeSet(s.slice(1), FRAGMENT_SET) };
  }
  if (special) s = slashes(s);
  if (s.startsWith('//')) return parseAuthority(base.protocol, s.replace(/^\/+/, ''), input);
  const t = splitTail(s);
  const rec = copyAuthority(base);
  if (s.startsWith('/')) return finish(rec, t.path, t.query, t.fragment, special);
  if (t.path === '') {
    // "", "?query" or "#fragment": keep the base path, and the base query
    // unless a new one is given.
    rec.pathname = base.pathname;
    rec.query = t.query === null ? base.query : encodeSet(t.query, special ? SPECIAL_QUERY_SET : QUERY_SET);
    rec.fragment = t.fragment === null ? null : encodeSet(t.fragment, FRAGMENT_SET);
    return rec;
  }
  const dir = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  return finish(rec, dir + t.path, t.query, t.fragment, special);
}

function parse(input, base) {
  // Remove leading and trailing C0 controls and spaces, then all tabs and newlines.
  const s = String(input).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
  if (m) {
    const protocol = m[1].toLowerCase() + ':';
    const rest = s.slice(m[0].length);
    if (protocol in DEFAULT_PORT) {
      if (base && base.protocol === protocol && !/^[/\\]/.test(rest) && protocol !== 'file:') {
        return resolve(rest, base, input);
      }
      // file: has an empty host in "file:///path", so it drops only two slashes.
      const auth = protocol === 'file:' ? rest.replace(/^[/\\]{2}/, '') : rest.replace(/^[/\\]*/, '');
      return parseAuthority(protocol, auth, input);
    }
    if (rest.startsWith('/')) throw new TypeError('Invalid URL: non-special URLs with a path or an authority are not supported: ' + input);
    const t = splitTail(rest);
    const rec = { protocol, username: '', password: '', hostname: '', port: '', opaque: true };
    return finish(rec, t.path, t.query, t.fragment, false);
  }
  if (!base) throw invalid(input);
  return resolve(s, base, input);
}

function serialize(r) {
  let out = r.protocol;
  if (!r.opaque) {
    out += '//';
    if (r.username || r.password) out += r.username + (r.password ? ':' + r.password : '') + '@';
    out += r.hostname + (r.port ? ':' + r.port : '');
  }
  out += r.pathname;
  if (r.query !== null) out += '?' + r.query;
  if (r.fragment !== null) out += '#' + r.fragment;
  return out;
}

// application/x-www-form-urlencoded, as URLSearchParams uses it.
function formEncode(s) {
  let out = '';
  for (const b of encoder.encode(s)) {
    const ch = String.fromCharCode(b);
    if (/[*\-._0-9A-Za-z]/.test(ch)) out += ch;
    else if (b === 0x20) out += '+';
    else out += hex(b);
  }
  return out;
}

function formParse(s) {
  const list = [];
  for (const part of s.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const name = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    list.push([percentDecode(name.replace(/\+/g, ' ')), percentDecode(value.replace(/\+/g, ' '))]);
  }
  return list;
}

export class URLSearchParams {
  #list = [];
  #url = null;

  constructor(init) {
    if (init === undefined || init === null) return;
    if (typeof init === 'string') {
      this.#list = formParse(init.startsWith('?') ? init.slice(1) : init);
    } else if (init instanceof URLSearchParams) {
      this.#list = init.#list.map((p) => [p[0], p[1]]);
    } else if (typeof init === 'object' && typeof init[Symbol.iterator] === 'function') {
      for (const pair of init) {
        const a = Array.from(pair);
        if (a.length !== 2) throw new TypeError('URLSearchParams: each pair must have two items');
        this.#list.push([String(a[0]), String(a[1])]);
      }
    } else if (typeof init === 'object') {
      for (const k of Object.keys(init)) this.#list.push([k, String(init[k])]);
    } else {
      this.#list = formParse(String(init));
    }
  }

  static _attach(params, url) {
    params.#url = url;
  }

  static _replace(params, query) {
    params.#list = query ? formParse(query) : [];
  }

  #update() {
    if (this.#url) this.#url._setQuery(this.#list.length ? this.toString() : null);
  }

  get size() {
    return this.#list.length;
  }

  append(name, value) {
    this.#list.push([String(name), String(value)]);
    this.#update();
  }

  delete(name, value) {
    name = String(name);
    this.#list = this.#list.filter((p) => !(p[0] === name && (value === undefined || p[1] === String(value))));
    this.#update();
  }

  get(name) {
    const p = this.#list.find((q) => q[0] === String(name));
    return p ? p[1] : null;
  }

  getAll(name) {
    return this.#list.filter((p) => p[0] === String(name)).map((p) => p[1]);
  }

  has(name, value) {
    name = String(name);
    return this.#list.some((p) => p[0] === name && (value === undefined || p[1] === String(value)));
  }

  set(name, value) {
    name = String(name);
    value = String(value);
    const i = this.#list.findIndex((p) => p[0] === name);
    if (i < 0) {
      this.#list.push([name, value]);
    } else {
      this.#list[i][1] = value;
      this.#list = this.#list.filter((p, j) => j <= i || p[0] !== name);
    }
    this.#update();
  }

  sort() {
    this.#list = this.#list
      .map((p, i) => [p, i])
      .sort((a, b) => (a[0][0] < b[0][0] ? -1 : a[0][0] > b[0][0] ? 1 : a[1] - b[1]))
      .map((x) => x[0]);
    this.#update();
  }

  forEach(fn, thisArg) {
    for (const [k, v] of this.#list) fn.call(thisArg, v, k, this);
  }

  *entries() {
    for (const p of this.#list) yield [p[0], p[1]];
  }

  *keys() {
    for (const p of this.#list) yield p[0];
  }

  *values() {
    for (const p of this.#list) yield p[1];
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  toString() {
    return this.#list.map((p) => formEncode(p[0]) + '=' + formEncode(p[1])).join('&');
  }
}

export class URL {
  #r;
  #params;

  constructor(input, base) {
    const b = base === undefined ? null : base instanceof URL ? base.#r : parse(String(base), null);
    this.#r = parse(String(input), b);
    this.#params = new URLSearchParams(this.#r.query || '');
    URLSearchParams._attach(this.#params, this);
  }

  static canParse(input, base) {
    try {
      new URL(input, base);
      return true;
    } catch {
      return false;
    }
  }

  _setQuery(query) {
    this.#r.query = query;
  }

  get href() {
    return serialize(this.#r);
  }

  set href(v) {
    this.#r = parse(String(v), null);
    URLSearchParams._replace(this.#params, this.#r.query);
  }

  get protocol() {
    return this.#r.protocol;
  }

  get username() {
    return this.#r.username;
  }

  get password() {
    return this.#r.password;
  }

  get hostname() {
    return this.#r.hostname;
  }

  get port() {
    return this.#r.port;
  }

  get host() {
    return this.#r.hostname + (this.#r.port ? ':' + this.#r.port : '');
  }

  get origin() {
    const r = this.#r;
    if (r.opaque || r.protocol === 'file:') return 'null';
    return r.protocol + '//' + this.host;
  }

  get pathname() {
    return this.#r.pathname;
  }

  set pathname(v) {
    if (this.#r.opaque) return;
    const p = String(v);
    this.#r.pathname = normalizePath(p.startsWith('/') ? p : '/' + p);
  }

  get search() {
    return this.#r.query ? '?' + this.#r.query : '';
  }

  set search(v) {
    let q = String(v);
    if (q.startsWith('?')) q = q.slice(1);
    this.#r.query = q === '' ? null : encodeSet(q, this.#r.protocol in DEFAULT_PORT ? SPECIAL_QUERY_SET : QUERY_SET);
    URLSearchParams._replace(this.#params, this.#r.query);
  }

  get searchParams() {
    return this.#params;
  }

  get hash() {
    return this.#r.fragment ? '#' + this.#r.fragment : '';
  }

  set hash(v) {
    let f = String(v);
    if (f.startsWith('#')) f = f.slice(1);
    this.#r.fragment = f === '' ? null : encodeSet(f, FRAGMENT_SET);
  }

  toString() {
    return this.href;
  }

  toJSON() {
    return this.href;
  }
}
```

Create `maemo-react/prelude/src/console.js`:

```js
// console.* that format objects. The host's console prints strings only;
// installConsole wraps it.

function key(k) {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
}

export function inspect(v, depth = 0, seen = new Set()) {
  switch (typeof v) {
    case 'string':
      return depth === 0 ? v : JSON.stringify(v);
    case 'function':
      return '[Function ' + (v.name || 'anonymous') + ']';
    case 'symbol':
      return v.toString();
    case 'bigint':
      return v + 'n';
    case 'object':
      break;
    default:
      return String(v);
  }
  if (v === null) return 'null';
  if (seen.has(v)) return '[Circular]';
  if (v instanceof Error) {
    const stack = v.stack ? '\n' + String(v.stack).replace(/\n$/, '') : '';
    return (v.name || 'Error') + ': ' + v.message + stack;
  }
  if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
  if (v instanceof ArrayBuffer) return 'ArrayBuffer(' + v.byteLength + ')';
  if (ArrayBuffer.isView(v)) return v.constructor.name + '(' + (v.length ?? v.byteLength) + ')';
  if (depth > 2) return Array.isArray(v) ? '[Array]' : '[Object]';
  seen.add(v);
  let out;
  if (Array.isArray(v)) {
    const items = v.slice(0, 100).map((x) => inspect(x, depth + 1, seen));
    if (v.length > 100) items.push('... ' + (v.length - 100) + ' more');
    out = items.length ? '[ ' + items.join(', ') + ' ]' : '[]';
  } else if (v instanceof Map) {
    const items = [...v].map(([k, x]) => inspect(k, depth + 1, seen) + ' => ' + inspect(x, depth + 1, seen));
    out = 'Map(' + v.size + ') ' + (items.length ? '{ ' + items.join(', ') + ' }' : '{}');
  } else if (v instanceof Set) {
    const items = [...v].map((x) => inspect(x, depth + 1, seen));
    out = 'Set(' + v.size + ') ' + (items.length ? '{ ' + items.join(', ') + ' }' : '{}');
  } else {
    const keys = Object.keys(v);
    const ctor = v.constructor;
    const name = ctor && ctor !== Object && ctor.name ? ctor.name + ' ' : '';
    out = keys.length
      ? name + '{ ' + keys.map((k) => key(k) + ': ' + inspect(v[k], depth + 1, seen)).join(', ') + ' }'
      : name + '{}';
  }
  seen.delete(v);
  return out;
}

export function format(args) {
  return args.map((a) => inspect(a)).join(' ');
}

export function installConsole(con) {
  const out = con.log;
  const err = con.error;
  for (const m of ['log', 'info', 'debug']) con[m] = (...args) => out(format(args));
  for (const m of ['warn', 'error']) con[m] = (...args) => err(format(args));
  con.trace = (...args) => err(format(args) + '\n' + new Error().stack);
  con.assert = (cond, ...args) => {
    if (!cond) err('Assertion failed' + (args.length ? ': ' + format(args) : ''));
  };
  con.dir = (v) => out(inspect(v, 1));
}
```

Create `maemo-react/prelude/src/index.js`:

```js
// The prelude: web-standard globals for maemo-react applications. The host
// runs this module before the application.
import { installConsole } from './console.js';
import { TextDecoder, TextEncoder } from './encoding.js';
import { URL, URLSearchParams } from './url.js';

installConsole(globalThis.console);

function define(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
}

define('TextEncoder', TextEncoder);
define('TextDecoder', TextDecoder);
define('URL', URL);
define('URLSearchParams', URLSearchParams);
define('queueMicrotask', function queueMicrotask(fn) {
  if (typeof fn !== 'function') throw new TypeError('queueMicrotask: the argument must be a function');
  Promise.resolve().then(() => fn());
});
```

- [ ] **Step 4: Run the Node tests**

```bash
npx vitest run prelude
```

Expected: all tests pass. These modules were checked against Node 24 when this plan was written. If a URL case differs on your Node version, the WHATWG standard changed: report the case to your human partner before you change `url.js`.

- [ ] **Step 5: Load the prelude in the host**

In `runtime/Makefile`, change `all: $(HOST)` to:

```make
PRELUDE := $(BUILD)/lib/maemo-react/prelude.js

all: $(HOST) $(PRELUDE)

$(PRELUDE): ../prelude/dist/prelude.js
	@mkdir -p $(@D)
	cp $< $@

../prelude/dist/prelude.js:
	@echo "no prelude/dist/prelude.js -- run 'npm run build:prelude' on the development computer"; exit 1
```

In `runtime/src/main.c`, add this function before `main`:

```c
/* The prelude: $MR_PRELUDE, or ../lib/maemo-react/prelude.js beside the binary. */
static gchar *prelude_path(void)
{
    const char *env = g_getenv("MR_PRELUDE");
    gchar *exe, *dir, *path;
    if (env)
        return g_strdup(env);
    exe = g_file_read_link("/proc/self/exe", NULL);
    if (!exe)
        return NULL;
    dir = g_path_get_dirname(exe);
    path = g_build_filename(dir, "..", "lib", "maemo-react", "prelude.js", NULL);
    g_free(exe);
    g_free(dir);
    return path;
}
```

In `main`, replace the line `if (mr_run_module_file(mr_ctx, argv[first]) < 0)` and the `return 1;` after it with:

```c
    {
        gchar *prelude = prelude_path();
        if (!prelude || !g_file_test(prelude, G_FILE_TEST_EXISTS)) {
            fprintf(stderr, "maemo-react-host: no prelude at %s\n", prelude ? prelude : "(unknown)");
            return 1;
        }
        if (mr_run_module_file(mr_ctx, prelude) < 0)
            return 1;
        g_free(prelude);
    }
    if (mr_run_module_file(mr_ctx, argv[first]) < 0)
        return 1;
```

- [ ] **Step 6: Build and run all tests**

```bash
npm run build:prelude
npx vitest run
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: Vitest passes. Every runtime test line is `PASS`, including `test/prelude.test.js` on both targets.

- [ ] **Step 7: Commit**

```bash
git add maemo-react/prelude maemo-react/vitest.config.ts maemo-react/package.json maemo-react/package-lock.json maemo-react/runtime
git commit -m "Add the maemo-react prelude: console, UTF-8 and URL

The host loads the prelude before the application. URL and the UTF-8
codec are tested against Node's own implementations."
```

---

### Task 9: maemo:http, curl on the GLib main loop

**Files:**
- Create: `maemo-react/runtime/src/http.c`
- Create: `maemo-react/runtime/test/server/server.py`
- Modify: `maemo-react/runtime/src/mr.h`, `src/main.c`, `maemo-react/runtime/test/run.sh`
- Test: `maemo-react/runtime/test/http.test.js`

**Interfaces:**
- Consumes: Task 2 (`mr_call`), Task 8 (the prelude's `TextEncoder`/`TextDecoder` in the test).
- Produces: JS module `maemo:http`:
  - `request(options, onEvent): number`. `options`: `{ url: string, method?: string, headers?: Array<[string, string]>, body?: ArrayBuffer | null, timeoutMs?: number, followRedirects?: boolean }` (`followRedirects` defaults to `true`). It sends `User-Agent: maemo-react/0.1.0` unless the caller gives one. Compressed responses are decoded.
  - `onEvent` gets, in this order: `{ type: 'headers', status, statusText, url, redirected, headers: Array<[name, value]> }` once; then `{ type: 'data', chunk: ArrayBuffer }` zero or more times; then `{ type: 'end' }` or `{ type: 'error', message, code }`. An `error` can also come first, with no `headers`.
  - `abort(id): void`. After `abort`, no more events come. Calling it from inside `onEvent` is safe.
  - `MR_CA_BUNDLE` (environment): a CA file to use in place of curl's built-in one. The tests use it.
- `runtime/test/run.sh` starts a local HTTPS server on `https://localhost:8443` with a self-signed certificate, and exports `MR_CA_BUNDLE`.

- [ ] **Step 1: Write the test server and start it from run.sh**

Create `maemo-react/runtime/test/server/server.py`:

```python
#!/usr/bin/env python3
"""A local HTTPS server for the maemo:http and fetch tests.

    server.py <port> <cert.pem> <key.pem>
"""
import gzip
import json
import ssl
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def send(self, status, body, ctype='application/json', extra=()):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def echo(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b''
        self.send(200, json.dumps({
            'method': self.command,
            'path': self.path,
            'headers': {k.lower(): v for k, v in self.headers.items()},
            'body': body.decode('utf-8', 'replace'),
        }).encode())

    def do_GET(self):
        if self.path == '/json':
            self.send(200, b'{"hello":"world","n":42}')
        elif self.path.startswith('/echo'):
            self.echo()
        elif self.path == '/redirect':
            self.send(302, b'', 'text/plain', [('Location', '/json')])
        elif self.path == '/slow':
            time.sleep(3)
            self.send(200, b'slow')
        elif self.path == '/big':
            self.send(200, b'x' * (1024 * 1024), 'application/octet-stream')
        elif self.path == '/gzip':
            self.send(200, gzip.compress(b'compressed text ' * 100), 'text/plain',
                      [('Content-Encoding', 'gzip')])
        elif self.path == '/status/404':
            self.send(404, b'{"error":"not found"}')
        else:
            self.send(404, b'{}')

    do_HEAD = do_GET

    def do_POST(self):
        self.echo()

    do_PUT = do_POST
    do_DELETE = do_POST


def main():
    port, cert, key = int(sys.argv[1]), sys.argv[2], sys.argv[3]
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


main()
```

In `runtime/test/run.sh`, after the line that starts Xvfb, add:

```bash
# A local HTTPS server for the http and fetch tests.
CERT=/tmp/mr-test-cert.pem
KEY=/tmp/mr-test-key.pem
[ -f "$CERT" ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout "$KEY" -out "$CERT" \
  -days 30 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 2>/dev/null
pgrep -f 'server/server.py 8443' >/dev/null || { python3 test/server/server.py 8443 "$CERT" "$KEY" & sleep 1; }
export MR_CA_BUNDLE="$CERT"
```

- [ ] **Step 2: Write the failing test**

Create `maemo-react/runtime/test/http.test.js`:

```js
import { test, assert, assertEqual, assertThrows, run } from './harness.js';
import { request, abort } from 'maemo:http';

const BASE = 'https://localhost:8443';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Run one request; resolve with every event when it ends.
function go(opts) {
  return new Promise((resolve) => {
    const r = { types: [], chunks: [] };
    request(opts, (ev) => {
      r.types.push(ev.type);
      if (ev.type === 'headers') r.head = ev;
      if (ev.type === 'data') r.chunks.push(new Uint8Array(ev.chunk));
      if (ev.type === 'end' || ev.type === 'error') {
        r.last = ev;
        resolve(r);
      }
    });
  });
}

function bytes(r) {
  let n = 0;
  for (const c of r.chunks) n += c.length;
  const all = new Uint8Array(n);
  let off = 0;
  for (const c of r.chunks) {
    all.set(c, off);
    off += c.length;
  }
  return all;
}

const text = (r) => new TextDecoder().decode(bytes(r));
const header = (r, name) => (r.head.headers.find(([k]) => k.toLowerCase() === name) || [])[1];

test('GET gives headers, data and end, in that order', async () => {
  const r = await go({ url: BASE + '/json' });
  assertEqual(r.types[0], 'headers');
  assertEqual(r.types[r.types.length - 1], 'end');
  assertEqual(r.head.status, 200);
  assertEqual(header(r, 'content-type'), 'application/json');
  assertEqual(JSON.parse(text(r)).n, 42);
});

test('POST sends the body', async () => {
  const body = new TextEncoder().encode('héllo').buffer;
  const r = await go({ url: BASE + '/echo', method: 'POST', headers: [['Content-Type', 'text/plain']], body });
  const echo = JSON.parse(text(r));
  assertEqual([echo.method, echo.body, echo.headers['content-type']], ['POST', 'héllo', 'text/plain']);
});

test('another method with a body', async () => {
  const r = await go({ url: BASE + '/echo', method: 'PUT', body: new TextEncoder().encode('x').buffer });
  assertEqual(JSON.parse(text(r)).method, 'PUT');
});

test('the default User-Agent, and one from the caller', async () => {
  let r = await go({ url: BASE + '/echo' });
  assertEqual(JSON.parse(text(r)).headers['user-agent'], 'maemo-react/0.1.0');
  r = await go({ url: BASE + '/echo', headers: [['User-Agent', 'mine']] });
  assertEqual(JSON.parse(text(r)).headers['user-agent'], 'mine');
});

test('redirects are followed', async () => {
  const r = await go({ url: BASE + '/redirect' });
  assertEqual([r.head.status, r.head.redirected], [200, true]);
  assert(r.head.url.endsWith('/json'), r.head.url);
});

test('followRedirects: false gives the 302', async () => {
  const r = await go({ url: BASE + '/redirect', followRedirects: false });
  assertEqual(r.head.status, 302);
  assertEqual(header(r, 'location'), '/json');
});

test('a 404 is a response, not an error', async () => {
  const r = await go({ url: BASE + '/status/404' });
  assertEqual([r.head.status, r.last.type], [404, 'end']);
});

test('a 1 MB body arrives complete', async () => {
  const r = await go({ url: BASE + '/big' });
  assertEqual(bytes(r).length, 1024 * 1024);
});

test('a gzip body is decoded', async () => {
  const r = await go({ url: BASE + '/gzip' });
  assert(text(r).startsWith('compressed text compressed text'));
});

test('a closed port gives an error event', async () => {
  const r = await go({ url: 'https://localhost:1/' });
  assertEqual(r.types, ['error']);
  assert(r.last.message.length > 0);
});

test('a host name that does not resolve gives an error event', async () => {
  const r = await go({ url: 'https://nonexistent.invalid/' });
  assertEqual(r.last.type, 'error');
});

test('timeoutMs stops a slow request', async () => {
  const t0 = performance.now();
  const r = await go({ url: BASE + '/slow', timeoutMs: 500 });
  assertEqual(r.last.type, 'error');
  assert(performance.now() - t0 < 2500);
});

test('abort: no more events', async () => {
  const types = [];
  const id = request({ url: BASE + '/slow' }, (ev) => types.push(ev.type));
  abort(id);
  await sleep(3500);
  assertEqual(types, []);
});

test('abort from inside the data handler', async () => {
  const types = [];
  const id = request({ url: BASE + '/big' }, (ev) => {
    types.push(ev.type);
    if (ev.type === 'data') abort(id);
  });
  await sleep(1500);
  assertEqual(types, ['headers', 'data']);
});

test('bad arguments', () => {
  assertThrows(() => request({ url: BASE }, null), /TypeError/);
  assertThrows(() => request({ url: BASE, body: 'not a buffer' }, () => {}), /TypeError/);
});

await run();
```

- [ ] **Step 3: Run it to see it fail**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/test/run.sh desktop test/http.test.js'
```

Expected: `FAIL` with `unknown native module 'maemo:http'`.

- [ ] **Step 4: Write http.c**

Create `maemo-react/runtime/src/http.c`:

```c
/* maemo:http -- HTTP requests with libcurl's multi interface on the GLib
   main loop. JavaScript gets the events headers, data, end and error. The
   prelude builds fetch() on top of it. */
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>
#include "mr.h"

typedef struct {
    int id;
    CURL *easy;
    JSValue cb;
    struct curl_slist *req_headers;
    GPtrArray *names;  /* response header names */
    GPtrArray *values; /* response header values */
    gchar *status_text;
    gboolean headers_sent;
    gboolean aborted;
    char error[CURL_ERROR_SIZE];
} Req;

typedef struct {
    GIOChannel *channel;
    guint watch;
} Sock;

static CURLM *multi;
static GHashTable *requests; /* id -> Req */
static int next_id = 1;
static guint timer_source;
static int in_callback; /* curl forbids removing a handle inside its callbacks */

static void check_done(void);

static void clear_headers(Req *r)
{
    guint i;
    for (i = 0; i < r->names->len; i++) {
        g_free(g_ptr_array_index(r->names, i));
        g_free(g_ptr_array_index(r->values, i));
    }
    g_ptr_array_set_size(r->names, 0);
    g_ptr_array_set_size(r->values, 0);
}

static void req_free(Req *r)
{
    g_hash_table_remove(requests, GINT_TO_POINTER(r->id));
    curl_multi_remove_handle(multi, r->easy);
    curl_easy_cleanup(r->easy);
    curl_slist_free_all(r->req_headers);
    clear_headers(r);
    g_ptr_array_free(r->names, TRUE);
    g_ptr_array_free(r->values, TRUE);
    g_free(r->status_text);
    JS_FreeValue(mr_ctx, r->cb);
    g_free(r);
}

static JSValue new_event(const char *type)
{
    JSValue ev = JS_NewObject(mr_ctx);
    JS_SetPropertyStr(mr_ctx, ev, "type", JS_NewString(mr_ctx, type));
    return ev;
}

/* Give an event to JavaScript. Takes ownership of ev. */
static void emit(Req *r, JSValue ev)
{
    JSValue res;
    in_callback++;
    res = mr_call(r->cb, JS_UNDEFINED, 1, (JSValueConst *)&ev);
    in_callback--;
    JS_FreeValue(mr_ctx, res);
    JS_FreeValue(mr_ctx, ev);
}

static void send_headers(Req *r)
{
    JSValue ev, list;
    char *url = NULL;
    long status = 0, redirects = 0;
    guint i;
    if (r->headers_sent)
        return;
    r->headers_sent = TRUE;
    curl_easy_getinfo(r->easy, CURLINFO_RESPONSE_CODE, &status);
    curl_easy_getinfo(r->easy, CURLINFO_EFFECTIVE_URL, &url);
    curl_easy_getinfo(r->easy, CURLINFO_REDIRECT_COUNT, &redirects);
    ev = new_event("headers");
    JS_SetPropertyStr(mr_ctx, ev, "status", JS_NewInt32(mr_ctx, (int32_t)status));
    JS_SetPropertyStr(mr_ctx, ev, "statusText", JS_NewString(mr_ctx, r->status_text ? r->status_text : ""));
    JS_SetPropertyStr(mr_ctx, ev, "url", JS_NewString(mr_ctx, url ? url : ""));
    JS_SetPropertyStr(mr_ctx, ev, "redirected", JS_NewBool(mr_ctx, redirects > 0));
    list = JS_NewArray(mr_ctx);
    for (i = 0; i < r->names->len; i++) {
        JSValue pair = JS_NewArray(mr_ctx);
        JS_SetPropertyUint32(mr_ctx, pair, 0, JS_NewString(mr_ctx, g_ptr_array_index(r->names, i)));
        JS_SetPropertyUint32(mr_ctx, pair, 1, JS_NewString(mr_ctx, g_ptr_array_index(r->values, i)));
        JS_SetPropertyUint32(mr_ctx, list, i, pair);
    }
    JS_SetPropertyStr(mr_ctx, ev, "headers", list);
    emit(r, ev);
}

static size_t on_header(char *buf, size_t size, size_t n, void *data)
{
    Req *r = data;
    size_t len = size * n;
    gchar *line = g_strndup(buf, len);
    gchar *colon;
    g_strchomp(line);
    if (g_str_has_prefix(line, "HTTP/")) {
        /* A new response (after a redirect or a 100): forget the last one. */
        gchar **parts = g_strsplit(line, " ", 3);
        clear_headers(r);
        g_free(r->status_text);
        r->status_text = g_strdup(parts[0] && parts[1] && parts[2] ? parts[2] : "");
        g_strfreev(parts);
    } else if ((colon = strchr(line, ':')) != NULL) {
        *colon = '\0';
        g_ptr_array_add(r->names, g_strdup(line));
        g_ptr_array_add(r->values, g_strdup(g_strstrip(colon + 1)));
    }
    g_free(line);
    return len;
}

static size_t on_write(char *buf, size_t size, size_t n, void *data)
{
    Req *r = data;
    JSValue ev;
    if (r->aborted)
        return 0; /* curl stops the transfer */
    send_headers(r);
    if (r->aborted)
        return 0;
    ev = new_event("data");
    JS_SetPropertyStr(mr_ctx, ev, "chunk", JS_NewArrayBufferCopy(mr_ctx, (uint8_t *)buf, size * n));
    emit(r, ev);
    return r->aborted ? 0 : size * n;
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

static void check_done(void)
{
    CURLMsg *msg;
    int left;
    while ((msg = curl_multi_info_read(multi, &left))) {
        Req *r = NULL;
        CURLcode result;
        if (msg->msg != CURLMSG_DONE)
            continue;
        result = msg->data.result;
        curl_easy_getinfo(msg->easy_handle, CURLINFO_PRIVATE, (char **)&r);
        if (!r->aborted) {
            if (result == CURLE_OK) {
                send_headers(r);
                if (!r->aborted)
                    emit(r, new_event("end"));
            } else {
                JSValue ev = new_event("error");
                const char *text = r->error[0] ? r->error : curl_easy_strerror(result);
                JS_SetPropertyStr(mr_ctx, ev, "message", JS_NewString(mr_ctx, text));
                JS_SetPropertyStr(mr_ctx, ev, "code", JS_NewInt32(mr_ctx, result));
                emit(r, ev);
            }
        }
        req_free(r);
    }
}

static gboolean free_aborted(gpointer data)
{
    Req *r = g_hash_table_lookup(requests, data);
    if (r && r->aborted)
        req_free(r);
    return FALSE;
}

/* Read a string property of options; NULL if absent. Free with JS_FreeCString. */
static const char *opt_string(JSContext *ctx, JSValueConst opts, const char *name)
{
    JSValue v = JS_GetPropertyStr(ctx, opts, name);
    const char *s = (JS_IsUndefined(v) || JS_IsNull(v)) ? NULL : JS_ToCString(ctx, v);
    JS_FreeValue(ctx, v);
    return s;
}

static int add_headers(JSContext *ctx, Req *r, JSValueConst opts)
{
    JSValue list = JS_GetPropertyStr(ctx, opts, "headers");
    gboolean has_agent = FALSE;
    uint32_t i, n = 0;
    if (JS_IsArray(ctx, list)) {
        JSValue lenv = JS_GetPropertyStr(ctx, list, "length");
        JS_ToUint32(ctx, &n, lenv);
        JS_FreeValue(ctx, lenv);
    }
    for (i = 0; i < n; i++) {
        JSValue pair = JS_GetPropertyUint32(ctx, list, i);
        JSValue k = JS_GetPropertyUint32(ctx, pair, 0);
        JSValue v = JS_GetPropertyUint32(ctx, pair, 1);
        const char *ks = JS_ToCString(ctx, k);
        const char *vs = JS_ToCString(ctx, v);
        if (ks && vs) {
            gchar *line = g_strdup_printf("%s: %s", ks, vs);
            r->req_headers = curl_slist_append(r->req_headers, line);
            g_free(line);
            if (!g_ascii_strcasecmp(ks, "user-agent"))
                has_agent = TRUE;
        }
        if (ks)
            JS_FreeCString(ctx, ks);
        if (vs)
            JS_FreeCString(ctx, vs);
        JS_FreeValue(ctx, k);
        JS_FreeValue(ctx, v);
        JS_FreeValue(ctx, pair);
    }
    JS_FreeValue(ctx, list);
    if (!has_agent)
        r->req_headers = curl_slist_append(r->req_headers, "User-Agent: maemo-react/" MR_VERSION);
    r->req_headers = curl_slist_append(r->req_headers, "Expect:"); /* no 100-continue wait */
    curl_easy_setopt(r->easy, CURLOPT_HTTPHEADER, r->req_headers);
    return 0;
}

static int set_method_and_body(JSContext *ctx, Req *r, JSValueConst opts)
{
    const char *method = opt_string(ctx, opts, "method");
    JSValue body = JS_GetPropertyStr(ctx, opts, "body");
    uint8_t *buf = NULL;
    size_t len = 0;
    int rc = 0;
    if (!JS_IsUndefined(body) && !JS_IsNull(body)) {
        buf = JS_GetArrayBuffer(ctx, &len, body); /* a TypeError if it is not one */
        if (!buf)
            rc = -1;
    }
    if (rc == 0) {
        if (method && !strcmp(method, "HEAD")) {
            curl_easy_setopt(r->easy, CURLOPT_NOBODY, 1L);
        } else if (method && !strcmp(method, "POST")) {
            /* Not CUSTOMREQUEST: then a 302 or 303 becomes a GET, as in browsers. */
            curl_easy_setopt(r->easy, CURLOPT_POST, 1L);
        } else if (method && strcmp(method, "GET")) {
            curl_easy_setopt(r->easy, CURLOPT_CUSTOMREQUEST, method);
        }
        if (buf || (method && !strcmp(method, "POST"))) {
            curl_easy_setopt(r->easy, CURLOPT_POSTFIELDSIZE_LARGE, (curl_off_t)len);
            curl_easy_setopt(r->easy, CURLOPT_COPYPOSTFIELDS, buf ? (char *)buf : "");
        }
    }
    if (method)
        JS_FreeCString(ctx, method);
    JS_FreeValue(ctx, body);
    return rc;
}

static JSValue js_request(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JSValueConst opts = argv[0];
    const char *url;
    const char *ca = g_getenv("MR_CA_BUNDLE");
    JSValue v;
    double timeout = 0;
    int follow = 1;
    Req *r;
    if (!JS_IsObject(opts) || !JS_IsFunction(ctx, argv[1]))
        return JS_ThrowTypeError(ctx, "request(options, onEvent): wrong arguments");
    if (!(url = opt_string(ctx, opts, "url")))
        return JS_ThrowTypeError(ctx, "request: options.url is missing");

    r = g_new0(Req, 1);
    r->id = next_id++;
    r->easy = curl_easy_init();
    r->cb = JS_DupValue(ctx, argv[1]);
    r->names = g_ptr_array_new();
    r->values = g_ptr_array_new();
    curl_easy_setopt(r->easy, CURLOPT_URL, url); /* curl copies strings */
    JS_FreeCString(ctx, url);

    add_headers(ctx, r, opts);
    if (set_method_and_body(ctx, r, opts) < 0) {
        g_hash_table_insert(requests, GINT_TO_POINTER(r->id), r);
        req_free(r);
        return JS_EXCEPTION;
    }
    v = JS_GetPropertyStr(ctx, opts, "timeoutMs");
    if (JS_IsNumber(v))
        JS_ToFloat64(ctx, &timeout, v);
    JS_FreeValue(ctx, v);
    v = JS_GetPropertyStr(ctx, opts, "followRedirects");
    if (JS_IsBool(v))
        follow = JS_ToBool(ctx, v);
    JS_FreeValue(ctx, v);

    if (timeout > 0)
        curl_easy_setopt(r->easy, CURLOPT_TIMEOUT_MS, (long)timeout);
    curl_easy_setopt(r->easy, CURLOPT_CONNECTTIMEOUT_MS, 30000L);
    curl_easy_setopt(r->easy, CURLOPT_FOLLOWLOCATION, (long)follow);
    curl_easy_setopt(r->easy, CURLOPT_MAXREDIRS, 20L);
    curl_easy_setopt(r->easy, CURLOPT_ACCEPT_ENCODING, ""); /* gzip and deflate */
    curl_easy_setopt(r->easy, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(r->easy, CURLOPT_ERRORBUFFER, r->error);
    curl_easy_setopt(r->easy, CURLOPT_PRIVATE, r);
    curl_easy_setopt(r->easy, CURLOPT_HEADERFUNCTION, on_header);
    curl_easy_setopt(r->easy, CURLOPT_HEADERDATA, r);
    curl_easy_setopt(r->easy, CURLOPT_WRITEFUNCTION, on_write);
    curl_easy_setopt(r->easy, CURLOPT_WRITEDATA, r);
    if (ca)
        curl_easy_setopt(r->easy, CURLOPT_CAINFO, ca);

    g_hash_table_insert(requests, GINT_TO_POINTER(r->id), r);
    curl_multi_add_handle(multi, r->easy);
    return JS_NewInt32(ctx, r->id);
}

static JSValue js_abort(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    int32_t id;
    Req *r;
    if (!JS_IsNumber(argv[0]) || JS_ToInt32(ctx, &id, argv[0]))
        return JS_UNDEFINED;
    r = g_hash_table_lookup(requests, GINT_TO_POINTER(id));
    if (!r || r->aborted)
        return JS_UNDEFINED;
    r->aborted = TRUE;
    if (in_callback)
        g_idle_add(free_aborted, GINT_TO_POINTER(id));
    else
        req_free(r);
    return JS_UNDEFINED;
}

static const JSCFunctionListEntry http_funcs[] = {
    JS_CFUNC_DEF("request", 2, js_request),
    JS_CFUNC_DEF("abort", 1, js_abort),
};

static int http_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, http_funcs, G_N_ELEMENTS(http_funcs));
}

JSModuleDef *mr_init_http(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, http_init);
    if (!m)
        return NULL;
    if (!multi) {
        curl_global_init(CURL_GLOBAL_DEFAULT);
        multi = curl_multi_init();
        curl_multi_setopt(multi, CURLMOPT_SOCKETFUNCTION, on_socket);
        curl_multi_setopt(multi, CURLMOPT_TIMERFUNCTION, on_timer);
        requests = g_hash_table_new(g_direct_hash, g_direct_equal);
    }
    JS_AddModuleExportList(ctx, m, http_funcs, G_N_ELEMENTS(http_funcs));
    return m;
}
```

Add to `mr.h` before `#endif`:

```c
/* http.c */
JSModuleDef *mr_init_http(JSContext *ctx, const char *name);
```

In `main.c`, after `mr_register_module("maemo:debug", mr_init_debug);`, add:

```c
    mr_register_module("maemo:http", mr_init_http);
```

- [ ] **Step 5: Run all runtime tests on both targets**

```bash
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: every line is `PASS`. Under qemu-user the Diablo build uses n810-modern's curl 8.22 and OpenSSL 3.5, with the test certificate from `MR_CA_BUNDLE`.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/runtime
git commit -m "Add maemo:http: curl requests on the GLib main loop

Requests run through curl's multi interface on GLib fd watches and
timers, and give headers, data, end and error events to JavaScript."
```


---

### Task 10: fetch, Headers, Response and AbortController

**Files:**
- Create: `maemo-react/prelude/src/events.js`, `prelude/src/fetch.js`
- Modify: `maemo-react/prelude/src/index.js`
- Test: `maemo-react/prelude/test/fetch.test.js`, `maemo-react/runtime/test/fetch.test.js`

**Interfaces:**
- Consumes: `maemo:http` (Task 9); `encoding.js`, `url.js` (Task 8).
- Produces: globals `fetch(input, init?)`, `Headers`, `Request` (no body), `Response` (with `Response.json`), `AbortController`, `AbortSignal` (with `AbortSignal.abort` and `AbortSignal.timeout`), `Event`, `EventTarget`, `DOMException`.
  - `fetch` accepts http and https only. `init`: `method`, `headers`, `body` (string, `URLSearchParams`, `ArrayBuffer`, typed array), `signal`, `redirect` (`'follow'` or `'manual'`).
  - Network failure: rejects with `TypeError('Failed to fetch')` whose `cause` is an `Error` with curl's message. Abort: rejects with `signal.reason` (an `AbortError` `DOMException` by default).
  - `prelude/src/fetch.js` exports `createFetch(http)`, `Headers`, `Request`, `Response`; `prelude/src/events.js` exports `Event`, `EventTarget`, `AbortController`, `AbortSignal`, `DOMException`.

- [ ] **Step 1: Write the failing tests**

Create `maemo-react/prelude/test/fetch.test.js`:

```js
import { describe, expect, test } from 'vitest';
import { AbortController } from '../src/events.js';
import { createFetch, Headers, Request, Response } from '../src/fetch.js';
import { URLSearchParams } from '../src/url.js';

// A fake maemo:http. The test sends the events itself.
function fakeHttp() {
  const http = {
    calls: [],
    aborted: [],
    request(opts, cb) {
      http.calls.push({ opts, cb });
      return http.calls.length;
    },
    abort(id) {
      http.aborted.push(id);
    },
  };
  return http;
}
const buf = (s) => new TextEncoder().encode(s).buffer;
const head = (status = 200, headers = []) => ({ type: 'headers', status, statusText: 'OK', headers, url: 'https://e.com/', redirected: false });

describe('fetch', () => {
  test('GET: options, headers, and a body in two chunks', async () => {
    const http = fakeHttp();
    const p = createFetch(http)('https://e.com/x?y=1');
    const { opts, cb } = http.calls[0];
    expect(opts).toMatchObject({ method: 'GET', url: 'https://e.com/x?y=1', body: null, followRedirects: true });
    cb(head(200, [['Content-Type', 'application/json'], ['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2']]));
    cb({ type: 'data', chunk: buf('{"a":') });
    cb({ type: 'data', chunk: buf('1}') });
    cb({ type: 'end' });
    const r = await p;
    expect([r.ok, r.status, r.headers.get('content-type')]).toEqual([true, 200, 'application/json']);
    expect(r.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await r.json()).toEqual({ a: 1 });
    await expect(r.text()).rejects.toThrow(TypeError);
  });

  test('a string body gets a content type', () => {
    const http = fakeHttp();
    createFetch(http)('https://e.com/', { method: 'post', body: 'héllo' });
    const { opts } = http.calls[0];
    expect(opts.method).toBe('POST');
    expect(new Uint8Array(opts.body).length).toBe(6);
    expect(opts.headers).toContainEqual(['content-type', 'text/plain;charset=UTF-8']);
  });

  test('a URLSearchParams body is form data', () => {
    const http = fakeHttp();
    createFetch(http)('https://e.com/', { method: 'POST', body: new URLSearchParams({ a: 'b c' }) });
    expect(http.calls[0].opts.headers).toContainEqual(['content-type', 'application/x-www-form-urlencoded;charset=UTF-8']);
  });

  test('GET with a body is refused', async () => {
    await expect(createFetch(fakeHttp())('https://e.com/', { body: 'x' })).rejects.toThrow(/GET or HEAD/);
  });

  test('an error before the headers rejects with Failed to fetch and a cause', async () => {
    const http = fakeHttp();
    const p = createFetch(http)('https://e.com/');
    http.calls[0].cb({ type: 'error', message: 'Could not resolve host: e.com' });
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(TypeError);
    expect(e.message).toBe('Failed to fetch');
    expect(e.cause.message).toMatch(/resolve/);
  });

  test('an error after the headers rejects the body', async () => {
    const http = fakeHttp();
    const p = createFetch(http)('https://e.com/');
    http.calls[0].cb(head());
    const r = await p;
    http.calls[0].cb({ type: 'error', message: 'connection reset' });
    await expect(r.text()).rejects.toThrow(TypeError);
  });

  test('abort before the headers', async () => {
    const http = fakeHttp();
    const c = new AbortController();
    const p = createFetch(http)('https://e.com/', { signal: c.signal });
    c.abort();
    const e = await p.catch((x) => x);
    expect(e.name).toBe('AbortError');
    expect(http.aborted).toEqual([1]);
  });

  test('abort after the headers rejects the body', async () => {
    const http = fakeHttp();
    const c = new AbortController();
    const p = createFetch(http)('https://e.com/', { signal: c.signal });
    http.calls[0].cb(head());
    const r = await p;
    c.abort();
    await expect(r.text()).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('a signal that is aborted already sends no request', async () => {
    const http = fakeHttp();
    const c = new AbortController();
    c.abort();
    await expect(createFetch(http)('https://e.com/', { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(http.calls).toHaveLength(0);
  });

  test('only http and https', async () => {
    await expect(createFetch(fakeHttp())('ftp://e.com/')).rejects.toThrow(/only http and https/);
  });

  test('redirect: manual', () => {
    const http = fakeHttp();
    createFetch(http)('https://e.com/', { redirect: 'manual' });
    expect(http.calls[0].opts.followRedirects).toBe(false);
  });

  test('fetch(new Request(...))', () => {
    const http = fakeHttp();
    createFetch(http)(new Request('https://e.com/r', { method: 'DELETE', headers: { 'X-A': '1' } }));
    expect(http.calls[0].opts).toMatchObject({ method: 'DELETE', url: 'https://e.com/r' });
    expect(http.calls[0].opts.headers).toContainEqual(['x-a', '1']);
  });
});

test('Headers are case-insensitive and join values', () => {
  const h = new Headers({ 'X-A': ' 1 ' });
  h.append('x-a', '2');
  expect(h.get('X-a')).toBe('1, 2');
  expect(() => h.append('bad name', 'x')).toThrow(TypeError);
});

test('Response.json', async () => {
  const r = Response.json({ x: 1 });
  expect(r.headers.get('content-type')).toBe('application/json');
  expect(await r.json()).toEqual({ x: 1 });
});
```

Create `maemo-react/runtime/test/fetch.test.js`:

```js
import { test, assert, assertEqual, assertRejects, run } from './harness.js';

const BASE = 'https://localhost:8443';

test('fetch JSON over HTTPS', async () => {
  const r = await fetch(BASE + '/json');
  assertEqual([r.ok, r.status], [true, 200]);
  assertEqual((await r.json()).hello, 'world');
});

test('fetch POST with a JSON body', async () => {
  const r = await fetch(BASE + '/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: 'ñ' }),
  });
  const echo = await r.json();
  assertEqual([echo.method, JSON.parse(echo.body).a], ['POST', 'ñ']);
});

test('a 404 resolves with ok false', async () => {
  const r = await fetch(BASE + '/status/404');
  assertEqual([r.ok, r.status], [false, 404]);
});

test('DNS failure rejects with TypeError and a cause', async () => {
  const e = await assertRejects(fetch('https://nonexistent.invalid/'), /TypeError: Failed to fetch/);
  assert(e.cause && e.cause.message.length > 0, 'no cause');
});

test('AbortSignal.timeout stops a slow request', async () => {
  await assertRejects(fetch(BASE + '/slow', { signal: AbortSignal.timeout(300) }), /TimeoutError/);
});

test('arrayBuffer of a 1 MB body', async () => {
  const r = await fetch(BASE + '/big');
  assertEqual((await r.arrayBuffer()).byteLength, 1024 * 1024);
});

await run();
```

- [ ] **Step 2: Run them to see them fail**

```bash
npx vitest run prelude/test/fetch.test.js
```

Expected: FAIL, because `prelude/src/fetch.js` does not exist.

- [ ] **Step 3: Write events.js and fetch.js**

Create `maemo-react/prelude/src/events.js`:

```js
// Event, EventTarget, AbortController, AbortSignal and DOMException: the
// parts that fetch() and common libraries use.

export class DOMException extends Error {
  constructor(message = '', name = 'Error') {
    super(message);
    this.name = name;
  }

  get code() {
    return { AbortError: 20, TimeoutError: 23 }[this.name] || 0;
  }
}

export class Event {
  constructor(type, init = {}) {
    this.type = String(type);
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.timeStamp = performance.now();
    this._stopped = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() {}

  stopImmediatePropagation() {
    this._stopped = true;
  }
}

export class EventTarget {
  #listeners = new Map();

  addEventListener(type, fn, options) {
    if (!fn) return;
    const once = typeof options === 'object' && options !== null && Boolean(options.once);
    const list = this.#listeners.get(type) || [];
    if (list.some((l) => l.fn === fn)) return;
    list.push({ fn, once });
    this.#listeners.set(type, list);
  }

  removeEventListener(type, fn) {
    const list = this.#listeners.get(type);
    if (list) this.#listeners.set(type, list.filter((l) => l.fn !== fn));
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    const handler = this['on' + event.type];
    if (typeof handler === 'function') handler.call(this, event);
    for (const l of (this.#listeners.get(event.type) || []).slice()) {
      if (l.once) this.removeEventListener(event.type, l.fn);
      if (typeof l.fn === 'function') l.fn.call(this, event);
      else l.fn.handleEvent(event);
      if (event._stopped) break;
    }
    return !event.defaultPrevented;
  }
}

const SIGNAL_KEY = Symbol('AbortSignal');

export class AbortSignal extends EventTarget {
  constructor(key) {
    super();
    if (key !== SIGNAL_KEY) throw new TypeError('AbortSignal: use AbortController');
    this.aborted = false;
    this.reason = undefined;
    this.onabort = null;
  }

  throwIfAborted() {
    if (this.aborted) throw this.reason;
  }

  static abort(reason) {
    const c = new AbortController();
    c.abort(reason);
    return c.signal;
  }

  static timeout(ms) {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return c.signal;
  }
}

export class AbortController {
  constructor() {
    this.signal = new AbortSignal(SIGNAL_KEY);
  }

  abort(reason) {
    const s = this.signal;
    if (s.aborted) return;
    s.aborted = true;
    s.reason = reason === undefined ? new DOMException('This operation was aborted', 'AbortError') : reason;
    s.dispatchEvent(new Event('abort'));
  }
}
```

Create `maemo-react/prelude/src/fetch.js`:

```js
// fetch(), Headers, Request and Response on top of the native maemo:http
// module (curl). createFetch takes that module as an argument, so the tests
// can give a fake one.
import { TextDecoder, TextEncoder } from './encoding.js';
import { URL, URLSearchParams } from './url.js';

const encoder = new TextEncoder();
const NETWORK = Symbol('network');

function headerName(name) {
  name = String(name);
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new TypeError('Headers: invalid name: ' + name);
  return name.toLowerCase();
}

function headerValue(value) {
  return String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
}

export class Headers {
  #map = new Map(); // lower-case name -> values

  constructor(init) {
    if (init === undefined || init === null) return;
    if (init instanceof Headers) {
      for (const [k, v] of init) this.append(k, v);
    } else if (typeof init[Symbol.iterator] === 'function') {
      for (const pair of init) {
        const a = Array.from(pair);
        if (a.length !== 2) throw new TypeError('Headers: each pair must have two items');
        this.append(a[0], a[1]);
      }
    } else {
      for (const k of Object.keys(init)) this.append(k, init[k]);
    }
  }

  append(name, value) {
    const k = headerName(name);
    const list = this.#map.get(k) || [];
    list.push(headerValue(value));
    this.#map.set(k, list);
  }

  set(name, value) {
    this.#map.set(headerName(name), [headerValue(value)]);
  }

  get(name) {
    const list = this.#map.get(headerName(name));
    return list ? list.join(', ') : null;
  }

  has(name) {
    return this.#map.has(headerName(name));
  }

  delete(name) {
    this.#map.delete(headerName(name));
  }

  getSetCookie() {
    return (this.#map.get('set-cookie') || []).slice();
  }

  forEach(fn, thisArg) {
    for (const [k, v] of this) fn.call(thisArg, v, k, this);
  }

  *entries() {
    for (const k of [...this.#map.keys()].sort()) {
      if (k === 'set-cookie') {
        for (const v of this.#map.get(k)) yield [k, v];
      } else {
        yield [k, this.#map.get(k).join(', ')];
      }
    }
  }

  *keys() {
    for (const [k] of this.entries()) yield k;
  }

  *values() {
    for (const [, v] of this.entries()) yield v;
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

function bodyBytes(body, headers) {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') {
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain;charset=UTF-8');
    return encoder.encode(body);
  }
  if (body instanceof URLSearchParams) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
    return encoder.encode(body.toString());
  }
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  throw new TypeError('fetch: use a string, URLSearchParams, an ArrayBuffer or a typed array as the body');
}

class Body {
  #bytes; // Promise<Uint8Array>
  #used = false;

  constructor(bytes) {
    this.#bytes = bytes;
  }

  get bodyUsed() {
    return this.#used;
  }

  #take() {
    if (this.#used) return Promise.reject(new TypeError('Body: the body was read already'));
    this.#used = true;
    return this.#bytes;
  }

  async arrayBuffer() {
    const b = await this.#take();
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }

  async bytes() {
    return new Uint8Array(await this.arrayBuffer());
  }

  async text() {
    return new TextDecoder().decode(await this.#take());
  }

  async json() {
    return JSON.parse(await this.text());
  }
}

export class Response extends Body {
  constructor(body = null, init = {}) {
    if (init && init[NETWORK]) {
      const n = init[NETWORK];
      super(n.bytes);
      this.status = n.status;
      this.statusText = n.statusText;
      this.headers = n.headers;
      this.url = n.url;
      this.redirected = n.redirected;
      this.type = 'basic';
      return;
    }
    const headers = new Headers(init.headers);
    super(Promise.resolve(bodyBytes(body, headers) || new Uint8Array(0)));
    this.status = init.status === undefined ? 200 : Number(init.status);
    if (this.status < 200 || this.status > 599) throw new RangeError('Response: the status must be 200 to 599');
    this.statusText = init.statusText === undefined ? '' : String(init.statusText);
    this.headers = headers;
    this.url = '';
    this.redirected = false;
    this.type = 'default';
  }

  get ok() {
    return this.status >= 200 && this.status <= 299;
  }

  static json(data, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(data), { ...init, headers });
  }
}

// A Request without a body: enough for fetch(new Request(url, init)).
export class Request {
  constructor(input, init = {}) {
    const src = input instanceof Request ? input : null;
    this.url = new URL(src ? src.url : String(input)).href;
    this.method = String(init.method || (src ? src.method : 'GET')).toUpperCase();
    this.headers = new Headers(init.headers || (src ? src.headers : undefined));
    this.signal = init.signal || (src ? src.signal : null);
    this.redirect = init.redirect || (src ? src.redirect : 'follow');
  }
}

export function createFetch(http) {
  return function fetch(input, init = {}) {
    return new Promise((resolve, reject) => {
      const req = input instanceof Request ? input : null;
      let url;
      try {
        url = new URL(req ? req.url : String(input));
      } catch (e) {
        reject(new TypeError('fetch: invalid URL: ' + String(input), { cause: e }));
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        reject(new TypeError('fetch: only http and https URLs are supported, not ' + url.protocol));
        return;
      }
      const method = String(init.method || (req ? req.method : 'GET')).toUpperCase();
      const headers = new Headers(init.headers || (req ? req.headers : undefined));
      let body;
      try {
        body = bodyBytes(init.body, headers);
      } catch (e) {
        reject(e);
        return;
      }
      if (body && (method === 'GET' || method === 'HEAD')) {
        reject(new TypeError('fetch: a GET or HEAD request cannot have a body'));
        return;
      }
      const signal = init.signal || (req ? req.signal : null);
      if (signal && signal.aborted) {
        reject(signal.reason);
        return;
      }

      const chunks = [];
      let size = 0;
      let done = false;
      let response = null;
      let finishBody;
      let failBody;
      const bytes = new Promise((res, rej) => {
        finishBody = res;
        failBody = rej;
      });
      bytes.catch(() => {}); // the caller may never read the body

      const fail = (err) => {
        if (done) return;
        done = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        if (response) failBody(err);
        else reject(err);
      };
      const redirect = init.redirect || (req ? req.redirect : 'follow');
      const id = http.request(
        {
          method,
          url: url.href,
          headers: [...headers],
          body: body ? body.buffer : null,
          timeoutMs: 0,
          followRedirects: redirect !== 'manual',
        },
        (ev) => {
          if (done) return;
          if (ev.type === 'headers') {
            response = new Response(null, {
              [NETWORK]: {
                status: ev.status,
                statusText: ev.statusText || '',
                headers: new Headers(ev.headers),
                url: ev.url,
                redirected: Boolean(ev.redirected),
                bytes,
              },
            });
            resolve(response);
          } else if (ev.type === 'data') {
            const c = new Uint8Array(ev.chunk);
            chunks.push(c);
            size += c.length;
          } else if (ev.type === 'end') {
            done = true;
            if (signal) signal.removeEventListener('abort', onAbort);
            const all = new Uint8Array(size);
            let off = 0;
            for (const c of chunks) {
              all.set(c, off);
              off += c.length;
            }
            finishBody(all);
          } else if (ev.type === 'error') {
            fail(new TypeError('Failed to fetch', { cause: new Error(ev.message) }));
          }
        },
      );
      function onAbort() {
        http.abort(id);
        fail(signal.reason);
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  };
}
```

- [ ] **Step 4: Install the globals**

Replace `maemo-react/prelude/src/index.js` with:

```js
// The prelude: web-standard globals for maemo-react applications. The host
// runs this module before the application.
import * as http from 'maemo:http';
import { installConsole } from './console.js';
import { TextDecoder, TextEncoder } from './encoding.js';
import { AbortController, AbortSignal, DOMException, Event, EventTarget } from './events.js';
import { createFetch, Headers, Request, Response } from './fetch.js';
import { URL, URLSearchParams } from './url.js';

installConsole(globalThis.console);

function define(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
}

define('TextEncoder', TextEncoder);
define('TextDecoder', TextDecoder);
define('URL', URL);
define('URLSearchParams', URLSearchParams);
define('Event', Event);
define('EventTarget', EventTarget);
define('AbortController', AbortController);
define('AbortSignal', AbortSignal);
define('DOMException', DOMException);
define('Headers', Headers);
define('Request', Request);
define('Response', Response);
define('fetch', createFetch(http));
define('queueMicrotask', function queueMicrotask(fn) {
  if (typeof fn !== 'function') throw new TypeError('queueMicrotask: the argument must be a function');
  Promise.resolve().then(() => fn());
});
```

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
npm run build:prelude
devhost/run.sh 'runtime/build.sh desktop && runtime/build.sh diablo && runtime/test/run.sh desktop && runtime/test/run.sh diablo'
```

Expected: Vitest passes; every runtime line is `PASS`, including `test/fetch.test.js` on both targets.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/prelude maemo-react/runtime/test/fetch.test.js
git commit -m "Add fetch, Headers, Response and AbortController to the prelude"
```


---

### Task 11: The React renderer (`@maemo-react/core`)

**Files:**
- Create: `maemo-react/packages/core/package.json`
- Create: `maemo-react/packages/core/src/bridge.ts`, `src/elements.ts`, `src/hostConfig.ts`, `src/renderer.ts`, `src/index.ts`, `src/react-reconciler.d.ts`
- Test: `maemo-react/packages/core/test/fakeBridge.ts`, `maemo-react/packages/core/test/renderer.test.tsx`

**Interfaces:**
- Consumes: `maemo:gobject` and `maemo:app` (as runtime imports in `index.ts` only); React 19.3.0, react-reconciler 0.34.0.
- Produces:
  - `createRenderer(bridge: Bridge, platform: Platform, options?: { onWindowClosed?(): void; onError?(error: unknown, componentStack: string): void }): Renderer`.
  - `Renderer`: `createRoot(): Root`, `render(element): Root` (returns after the widgets exist), `flushSync<T>(fn: () => T): T`.
  - `Root`: `render(element)`, `unmount()`.
  - From `index.ts` (the real bridge): `render`, `createRoot`, `flushSync`; closing the last window calls `quit(0)`.
  - Types: `Bridge`, `Handle`, `Platform`, `WidgetTarget` (`{ handle, get(prop) }`: the last argument of every event handler, and the value of a ref).
  - Elements: `hildon-window` (a `GtkWindow` on the desktop), `gtk-vbox`, `gtk-hbox`, `gtk-label`, `gtk-button`, `gtk-entry`, `gtk-scrolled-window`. Props in camelCase become GObject properties in kebab-case. `on<Signal>` props connect to signals once. `expand`, `fill`, `padding`, `packType` become box child properties (first values `false`, `true`, `0`, `'start'`). `text`, `value` and `active` are set only when GTK has a different value.
  - Handlers run at discrete priority, and their updates render before the signal returns.

- [ ] **Step 1: Write the package file and the fake bridge**

Create `maemo-react/packages/core/package.json`:

```json
{
  "name": "@maemo-react/core",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "peerDependencies": {
    "react": "19.3.0"
  },
  "dependencies": {
    "react-reconciler": "0.34.0"
  },
  "devDependencies": {
    "@maemo-react/types": "0.1.0"
  }
}
```

Create `maemo-react/packages/core/test/fakeBridge.ts`:

```ts
import type { Bridge, Handle } from '../src/bridge.js';

interface FakeObject {
  type: string;
  props: Record<string, unknown>;
  handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
  parent: Handle | null;
  children: Handle[];
  destroyed: boolean;
}

/** A bridge that keeps a widget tree in memory and records each operation. */
export function fakeBridge() {
  let next = 1;
  const ops: unknown[][] = [];
  const objects = new Map<Handle, FakeObject>();
  const obj = (h: Handle) => {
    const o = objects.get(h);
    if (!o || o.destroyed) throw new Error('fake bridge: invalid handle ' + h);
    return o;
  };

  const bridge: Bridge = {
    create(type) {
      const h = next++;
      objects.set(h, { type, props: {}, handlers: new Map(), parent: null, children: [], destroyed: false });
      ops.push(['create', type, h]);
      return h;
    },
    set(h, prop, value) {
      obj(h).props[prop] = value;
      ops.push(['set', h, prop, value]);
    },
    get(h, prop) {
      return obj(h).props[prop];
    },
    reset(h, prop) {
      delete obj(h).props[prop];
      ops.push(['reset', h, prop]);
    },
    connect(h, signal, fn) {
      const o = obj(h);
      if (!o.handlers.has(signal)) o.handlers.set(signal, []);
      o.handlers.get(signal)!.push(fn);
      ops.push(['connect', h, signal]);
      return o.handlers.get(signal)!.length;
    },
    childSet(parent, child, prop, value) {
      ops.push(['childSet', parent, child, prop, value]);
    },
    call(h, helper, ...args) {
      ops.push(['call', h, helper, ...args]);
      const o = obj(h);
      switch (helper) {
        case 'container.add':
        case 'scrolled.add': {
          const c = args[0] as Handle;
          o.children.push(c);
          obj(c).parent = h;
          return undefined;
        }
        case 'container.indexOf':
          return o.children.indexOf(args[0] as Handle);
        case 'box.reorder': {
          const c = args[0] as Handle;
          let pos = args[1] as number;
          o.children.splice(o.children.indexOf(c), 1);
          if (pos < 0 || pos > o.children.length) pos = o.children.length;
          o.children.splice(pos, 0, c);
          return undefined;
        }
        case 'widget.removeFromParent':
          if (o.parent !== null) {
            const list = obj(o.parent).children;
            list.splice(list.indexOf(h), 1);
            o.parent = null;
          }
          return undefined;
        default:
          return undefined;
      }
    },
    destroy(h) {
      const o = objects.get(h);
      if (!o || o.destroyed) return;
      ops.push(['destroy', h]);
      for (const fn of o.handlers.get('destroy') ?? []) fn();
      o.destroyed = true;
    },
  };

  return {
    bridge,
    ops,
    objects,
    /** Emit a signal as GTK would. Returns the last handler's result. */
    emit(h: Handle, signal: string, ...args: unknown[]) {
      let r: unknown;
      for (const fn of obj(h).handlers.get(signal) ?? []) r = fn(...args);
      return r;
    },
    /** Change a property as GTK would (for example the user types), with no op. */
    poke(h: Handle, prop: string, value: unknown) {
      obj(h).props[prop] = value;
    },
    props: (h: Handle) => obj(h).props,
    childrenOf: (h: Handle) => obj(h).children,
    typeOf: (h: Handle) => obj(h).type,
    ofType: (type: string) => [...objects].filter(([, o]) => o.type === type && !o.destroyed).map(([h]) => h),
    isDestroyed: (h: Handle) => objects.get(h)!.destroyed,
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `maemo-react/packages/core/test/renderer.test.tsx`:

```tsx
import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import type { Platform } from '../src/bridge.js';
import { createRenderer } from '../src/renderer.js';
import { fakeBridge } from './fakeBridge.js';

function setup(platform: Platform = 'hildon') {
  const fake = fakeBridge();
  const errors: string[] = [];
  let closed = 0;
  const renderer = createRenderer(fake.bridge, platform, {
    onWindowClosed: () => {
      closed++;
    },
    onError: (e) => {
      errors.push(String(e instanceof Error ? e.message : e));
    },
  });
  return { ...fake, renderer, errors, closed: () => closed };
}

describe('mount', () => {
  test('a window with a box, a label and a button', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window title="T">
        <gtk-vbox spacing={4}>
          <gtk-label>Hello</gtk-label>
          <gtk-button>Go</gtk-button>
        </gtk-vbox>
      </hildon-window>,
    );
    const [win] = t.ofType('HildonWindow');
    expect(t.props(win).title).toBe('T');
    const [box] = t.childrenOf(win);
    expect(t.typeOf(box)).toBe('GtkVBox');
    expect(t.props(box).spacing).toBe(4);
    const [label, button] = t.childrenOf(box);
    expect([t.props(label).label, t.props(button).label]).toEqual(['Hello', 'Go']);
    expect(t.ops).toContainEqual(['call', win, 'window.registerProgram']);
    expect(t.ops).toContainEqual(['call', win, 'widget.show']);
    expect(t.ops).toContainEqual(['childSet', box, label, 'expand', false]);
    expect(t.ops).toContainEqual(['childSet', box, label, 'fill', true]);
  });

  test('the desktop platform makes a GtkWindow', () => {
    const t = setup('desktop');
    t.renderer.render(<hildon-window />);
    expect(t.ofType('GtkWindow')).toHaveLength(1);
  });

  test('camelCase props become GObject property names', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-scrolled-window hscrollbarPolicy="never" />
      </hildon-window>,
    );
    const [s] = t.ofType('GtkScrolledWindow');
    expect(t.ops).toContainEqual(['set', s, 'hscrollbar-policy', 'never']);
  });

  test('text from mixed children', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-label>Count: {3}</gtk-label>
      </hildon-window>,
    );
    expect(t.props(t.ofType('GtkLabel')[0]).label).toBe('Count: 3');
  });

  test('a raw string in a box becomes a label', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-vbox>just text</gtk-vbox>
      </hildon-window>,
    );
    expect(t.props(t.ofType('GtkLabel')[0]).label).toBe('just text');
  });
});

describe('errors', () => {
  test('an element inside a label', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-label>
          <gtk-button />
        </gtk-label>
      </hildon-window>,
    );
    expect(t.errors.join()).toMatch(/<gtk-label> can contain only text/);
  });

  test('an unknown element', () => {
    const t = setup();
    // @ts-expect-error: not an element
    t.renderer.render(<gtk-nope />);
    expect(t.errors.join()).toMatch(/unknown element <gtk-nope>/);
  });

  test('a widget at the top level', () => {
    const t = setup();
    t.renderer.render(<gtk-label>x</gtk-label>);
    expect(t.errors.join()).toMatch(/only a window can/);
  });

  test('two children in a window', () => {
    const t = setup();
    t.renderer.render(
      <hildon-window>
        <gtk-label>a</gtk-label>
        <gtk-label>b</gtk-label>
      </hildon-window>,
    );
    expect(t.errors.join()).toMatch(/can contain only one child/);
  });
});

describe('updates', () => {
  function Counter() {
    const [n, setN] = useState(0);
    return (
      <hildon-window>
        <gtk-vbox>
          <gtk-label>{'n=' + n}</gtk-label>
          <gtk-button onClicked={() => setN(n + 1)}>+</gtk-button>
        </gtk-vbox>
      </hildon-window>
    );
  }

  test('a click renders before the signal returns, with the newest handler', () => {
    const t = setup();
    t.renderer.render(<Counter />);
    const [button] = t.ofType('GtkButton');
    const [label] = t.ofType('GtkLabel');
    t.emit(button, 'clicked');
    expect(t.props(label).label).toBe('n=1');
    t.emit(button, 'clicked');
    expect(t.props(label).label).toBe('n=2');
    expect(t.ops.filter((o) => o[0] === 'connect' && o[1] === button && o[2] === 'clicked')).toHaveLength(1);
  });

  test('unchanged props are not set again; a removed prop is reset', () => {
    const t = setup();
    const root = t.renderer.render(
      <hildon-window>
        <gtk-vbox spacing={4} homogeneous />
      </hildon-window>,
    );
    const [box] = t.ofType('GtkVBox');
    const before = t.ops.length;
    root.render(
      <hildon-window>
        <gtk-vbox spacing={4} />
      </hildon-window>,
    );
    const after = t.ops.slice(before);
    expect(after).not.toContainEqual(['set', box, 'spacing', 4]);
    expect(after).toContainEqual(['reset', box, 'homogeneous']);
  });

  test('a handler gets the signal arguments, then the target', () => {
    const t = setup();
    let got: unknown;
    t.renderer.render(
      <hildon-window>
        <gtk-entry onChanged={(target: { get(p: string): unknown }) => (got = target.get('text'))} />
      </hildon-window>,
    );
    const [entry] = t.ofType('GtkEntry');
    t.poke(entry, 'text', 'abc');
    t.emit(entry, 'changed');
    expect(got).toBe('abc');
  });

  test('a controlled text is not set again when GTK has it already', () => {
    const t = setup();
    function Field() {
      const [text, setText] = useState('a');
      return (
        <hildon-window>
          <gtk-entry text={text} onChanged={(target: { get(p: string): unknown }) => setText(target.get('text') as string)} />
        </hildon-window>
      );
    }
    t.renderer.render(<Field />);
    const [entry] = t.ofType('GtkEntry');
    t.poke(entry, 'text', 'ab'); // the user types
    t.emit(entry, 'changed');
    expect(t.ops.filter((o) => o[0] === 'set' && o[1] === entry && o[2] === 'text')).toEqual([['set', entry, 'text', 'a']]);
  });

  test('a keyed list keeps the widgets and changes their order', () => {
    const t = setup();
    const list = (keys: string[]) => (
      <hildon-window>
        <gtk-vbox>
          {keys.map((k) => (
            <gtk-label key={k}>{k}</gtk-label>
          ))}
        </gtk-vbox>
      </hildon-window>
    );
    const root = t.renderer.render(list(['a', 'b', 'c']));
    const [box] = t.ofType('GtkVBox');
    const order = () => t.childrenOf(box).map((h) => t.props(h).label);
    root.render(list(['c', 'a', 'b']));
    expect(order()).toEqual(['c', 'a', 'b']);
    root.render(list(['b', 'c', 'a']));
    expect(order()).toEqual(['b', 'c', 'a']);
    expect(t.ofType('GtkLabel')).toHaveLength(3);
  });

  test('a removed element and a removed text are destroyed', () => {
    const t = setup();
    const view = (show: boolean) => (
      <hildon-window>
        <gtk-vbox>
          {show ? <gtk-button>x</gtk-button> : null}
          {show ? 'text' : null}
        </gtk-vbox>
      </hildon-window>
    );
    const root = t.renderer.render(view(true));
    const [button] = t.ofType('GtkButton');
    const [text] = t.ofType('GtkLabel');
    root.render(view(false));
    expect(t.isDestroyed(button)).toBe(true);
    expect(t.isDestroyed(text)).toBe(true);
    expect(t.childrenOf(t.ofType('GtkVBox')[0])).toEqual([]);
  });

  test('a changed child prop goes to the box', () => {
    const t = setup();
    const view = (expand: boolean) => (
      <hildon-window>
        <gtk-vbox>
          <gtk-label expand={expand}>x</gtk-label>
        </gtk-vbox>
      </hildon-window>
    );
    const root = t.renderer.render(view(false));
    const [box] = t.ofType('GtkVBox');
    const [label] = t.ofType('GtkLabel');
    root.render(view(true));
    expect(t.ops[t.ops.length - 1]).toEqual(['childSet', box, label, 'expand', true]);
  });

  test('flushSync renders its updates before it returns', () => {
    const t = setup();
    let set!: (n: number) => void;
    function App() {
      const [n, setN] = useState(0);
      set = setN;
      return (
        <hildon-window>
          <gtk-label>{String(n)}</gtk-label>
        </hildon-window>
      );
    }
    t.renderer.render(<App />);
    t.renderer.flushSync(() => set(5));
    expect(t.props(t.ofType('GtkLabel')[0]).label).toBe('5');
  });
});

describe('windows', () => {
  test('the user closes the window: onWindowClosed', () => {
    const t = setup();
    t.renderer.render(<hildon-window />);
    t.bridge.destroy(t.ofType('HildonWindow')[0]);
    expect(t.closed()).toBe(1);
  });

  test('unmount destroys the window, and it is not a close', () => {
    const t = setup();
    const root = t.renderer.render(<hildon-window />);
    const [win] = t.ofType('HildonWindow');
    root.unmount();
    expect(t.isDestroyed(win)).toBe(true);
    expect(t.closed()).toBe(0);
  });

  test('a ref gives the widget target', () => {
    const t = setup();
    let target: { handle: number } | null = null;
    t.renderer.render(
      <hildon-window>
        <gtk-label ref={(r: { handle: number } | null) => (target = r)}>x</gtk-label>
      </hildon-window>,
    );
    expect(target!.handle).toBe(t.ofType('GtkLabel')[0]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

```bash
npm install
npx vitest run packages/core
```

Expected: FAIL, because `packages/core/src/renderer.ts` does not exist.

- [ ] **Step 4: Write the renderer**

Create `maemo-react/packages/core/src/bridge.ts`:

```ts
/** A GObject handle from maemo:gobject. */
export type Handle = number;

/** The parts of maemo:gobject that the renderer uses. */
export interface Bridge {
  create(type: string): Handle;
  set(h: Handle, prop: string, value: unknown): void;
  get(h: Handle, prop: string): unknown;
  reset(h: Handle, prop: string): void;
  connect(h: Handle, signal: string, fn: (...args: unknown[]) => unknown): number;
  childSet(parent: Handle, child: Handle, prop: string, value: unknown): void;
  call(h: Handle, helper: string, ...args: unknown[]): unknown;
  destroy(h: Handle): void;
}

export type Platform = 'hildon' | 'desktop';

/** The last argument of every event handler, and the value of a ref. */
export interface WidgetTarget {
  readonly handle: Handle;
  /** Read a property of the widget, by its camelCase or GObject name. */
  get(prop: string): unknown;
}
```

Create `maemo-react/packages/core/src/elements.ts`:

```ts
import type { Bridge, Handle, Platform } from './bridge.js';

/** How an element takes children. */
export type ChildModel = 'none' | 'text' | 'single' | 'box' | 'scrolled';

export interface ElementDef {
  /** The GType to create, or a function of the platform. */
  gtype: string | ((platform: Platform) => string);
  children: ChildModel;
  /** For the 'text' model: the property that gets the text. */
  textProp?: string;
  /** A top-level window. */
  toplevel?: boolean;
  /** Runs once, after create. */
  init?: (b: Bridge, h: Handle) => void;
}

/** The intrinsic elements of maemo-react, by JSX name. */
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
  'gtk-entry': { gtype: 'GtkEntry', children: 'none' },
  'gtk-scrolled-window': {
    gtype: 'GtkScrolledWindow',
    children: 'scrolled',
    init: (b, h) => {
      b.set(h, 'hscrollbar-policy', 'automatic');
      b.set(h, 'vscrollbar-policy', 'automatic');
    },
  },
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

Create `maemo-react/packages/core/src/react-reconciler.d.ts`:

```ts
// Minimal types for react-reconciler 0.34. The package has no types of its
// own, and @types/react-reconciler describes an older API.
declare module 'react-reconciler' {
  const Reconciler: (config: Record<string, unknown>) => any;
  export default Reconciler;
}
declare module 'react-reconciler/constants.js' {
  export const ConcurrentRoot: number;
  export const DefaultEventPriority: number;
  export const DiscreteEventPriority: number;
  export const NoEventPriority: number;
}
```

Create `maemo-react/packages/core/src/hostConfig.ts`:

```ts
/// <reference path="./react-reconciler.d.ts" />
import { createContext } from 'react';
import { DefaultEventPriority, DiscreteEventPriority, NoEventPriority } from 'react-reconciler/constants.js';
import type { Bridge, Handle, Platform, WidgetTarget } from './bridge.js';
import { CHILD_PROPS, ELEMENTS, RESERVED, SYNC_PROPS, kebab, type ElementDef } from './elements.js';

type Props = Record<string, unknown>;

/** One widget that React manages. */
export interface Instance {
  handle: Handle;
  type: string;
  def: ElementDef;
  props: Props;
  parent: Instance | null;
  childCount: number;
  signals: Set<string>;
  isText: boolean;
  target: WidgetTarget;
}

/** The React root container: it holds the windows. */
export interface Container {
  windows: Set<Instance>;
}

export interface HostHooks {
  /** The user closed a window that React did not remove. */
  onWindowClosed(): void;
  /** Run the synchronous React work now (set by the renderer). */
  flushSync(): void;
}

/** The text of string, number and array children; null if there is an element. */
function textOf(children: unknown): string | null {
  if (children === undefined || children === null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    let out = '';
    for (const c of children) {
      const t = textOf(c);
      if (t === null) return null;
      out += t;
    }
    return out;
  }
  return null;
}

export function createHostConfig(b: Bridge, platform: Platform, hooks: HostHooks) {
  let priority: number = NoEventPriority;
  const destroying = new Set<Handle>();

  const gtypeOf = (def: ElementDef) => (typeof def.gtype === 'function' ? def.gtype(platform) : def.gtype);
  const makeTarget = (handle: Handle): WidgetTarget => ({ handle, get: (prop) => b.get(handle, kebab(prop)) });

  /** Run fn at discrete priority, then render synchronously, as a click must. */
  function runDiscrete<T>(fn: () => T): T {
    const prev = priority;
    priority = DiscreteEventPriority;
    try {
      return fn();
    } finally {
      priority = prev;
      hooks.flushSync();
    }
  }

  function dispatch(inst: Instance, prop: string, args: unknown[]): unknown {
    const fn = inst.props[prop];
    if (typeof fn !== 'function') return undefined;
    return runDiscrete(() => fn(...args, inst.target));
  }

  function applyText(inst: Instance, prev: Props | null, next: Props) {
    if (inst.def.children !== 'text') return;
    const after = textOf(next.children);
    if (after === null) throw new Error(`<${inst.type}> can contain only text`);
    if (prev && textOf(prev.children) === after) return;
    b.set(inst.handle, inst.def.textProp!, after);
  }

  function applyProps(inst: Instance, prev: Props | null, next: Props) {
    const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
    for (const key of keys) {
      if (RESERVED.has(key) || key in CHILD_PROPS) continue;
      const value = next[key];
      if (/^on[A-Z]/.test(key)) {
        const signal = kebab(key.slice(2));
        if (typeof value === 'function' && !inst.signals.has(signal)) {
          inst.signals.add(signal);
          b.connect(inst.handle, signal, (...args) => dispatch(inst, key, args));
        }
        continue;
      }
      if (prev && key in prev && prev[key] === value) continue;
      const prop = kebab(key);
      if (value === undefined) {
        if (prev && key in prev) b.reset(inst.handle, prop);
        continue;
      }
      if (SYNC_PROPS.has(prop) && b.get(inst.handle, prop) === value) continue;
      b.set(inst.handle, prop, value);
    }
    applyText(inst, prev, next);
  }

  function applyChildProps(child: Instance, prev: Props | null) {
    const parent = child.parent;
    if (!parent || parent.def.children !== 'box') return;
    for (const key of Object.keys(CHILD_PROPS)) {
      const value = child.props[key];
      if (prev && prev[key] === value) continue;
      b.childSet(parent.handle, child.handle, CHILD_PROPS[key].name, value === undefined ? CHILD_PROPS[key].initial : value);
    }
  }

  function attach(parent: Instance, child: Instance, before: Instance | null) {
    const model = parent.def.children;
    if (model === 'none' || model === 'text') {
      throw new Error(`<${parent.type}> cannot contain <${child.type}>`);
    }
    if (child.parent === parent) {
      // React moves a child that is in this box already.
      const from = b.call(parent.handle, 'container.indexOf', child.handle) as number;
      let to = -1;
      if (before) {
        const at = b.call(parent.handle, 'container.indexOf', before.handle) as number;
        to = from < at ? at - 1 : at;
      }
      b.call(parent.handle, 'box.reorder', child.handle, to);
      return;
    }
    if ((model === 'single' || model === 'scrolled') && parent.childCount > 0) {
      throw new Error(`<${parent.type}> can contain only one child; put the children in a box`);
    }
    child.parent = parent;
    parent.childCount++;
    b.call(parent.handle, model === 'scrolled' ? 'scrolled.add' : 'container.add', child.handle);
    if (model === 'box') {
      if (before) {
        const at = b.call(parent.handle, 'container.indexOf', before.handle) as number;
        b.call(parent.handle, 'box.reorder', child.handle, at);
      }
      applyChildProps(child, null);
    }
  }

  function detach(parent: Instance, child: Instance) {
    b.call(child.handle, 'widget.removeFromParent');
    child.parent = null;
    parent.childCount--;
    // React does not call detachDeletedInstance for text instances.
    if (child.isText) b.destroy(child.handle);
  }

  function destroyInstance(inst: Instance) {
    destroying.add(inst.handle);
    try {
      b.destroy(inst.handle);
    } finally {
      destroying.delete(inst.handle);
    }
  }

  function addWindow(c: Container, win: Instance) {
    if (!win.def.toplevel) {
      throw new Error(`<${win.type}> cannot be at the top level; only a window can`);
    }
    c.windows.add(win);
    b.call(win.handle, 'window.registerProgram');
    if (win.props.visible !== false) b.call(win.handle, 'widget.show');
  }

  const config = {
    rendererPackageName: '@maemo-react/core',
    rendererVersion: '0.1.0',
    extraDevToolsConfig: null,
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    supportsMicrotasks: true,
    supportsResources: false,
    supportsSingletons: false,
    supportsTestSelectors: false,
    isPrimaryRenderer: true,
    noTimeout: -1,
    scheduleMicrotask: (fn: () => void) => queueMicrotask(fn),
    scheduleTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    cancelTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),

    getRootHostContext: () => null,
    getChildHostContext: (parent: unknown) => parent,
    getPublicInstance: (inst: Instance) => inst.target,
    prepareForCommit: () => null,
    resetAfterCommit: () => {},
    preparePortalMount: () => {},

    shouldSetTextContent: (type: string) => ELEMENTS[type]?.children === 'text',

    createInstance(type: string, props: Props): Instance {
      const def = ELEMENTS[type];
      if (!def) throw new Error(`unknown element <${type}>; the known elements are ${Object.keys(ELEMENTS).join(', ')}`);
      const handle = b.create(gtypeOf(def));
      const inst: Instance = {
        handle, type, def, props, parent: null, childCount: 0, signals: new Set(), isText: false, target: makeTarget(handle),
      };
      def.init?.(b, handle);
      if (def.toplevel) {
        b.connect(handle, 'destroy', () => {
          if (!destroying.has(handle)) hooks.onWindowClosed();
        });
      }
      applyProps(inst, null, props);
      if (!def.toplevel && props.visible !== false) b.call(handle, 'widget.show');
      return inst;
    },

    createTextInstance(text: string): Instance {
      const handle = b.create('GtkLabel');
      b.set(handle, 'label', text);
      b.call(handle, 'widget.show');
      return {
        handle, type: '#text', def: ELEMENTS['gtk-label'], props: {}, parent: null, childCount: 0, signals: new Set(), isText: true, target: makeTarget(handle),
      };
    },

    appendInitialChild: (p: Instance, c: Instance) => attach(p, c, null),
    appendChild: (p: Instance, c: Instance) => attach(p, c, null),
    insertBefore: (p: Instance, c: Instance, before: Instance) => attach(p, c, before),
    removeChild: (p: Instance, c: Instance) => detach(p, c),
    appendChildToContainer: (c: Container, win: Instance) => addWindow(c, win),
    insertInContainerBefore: (c: Container, win: Instance) => addWindow(c, win),
    removeChildFromContainer(c: Container, win: Instance) {
      c.windows.delete(win);
      destroyInstance(win);
    },

    finalizeInitialChildren: () => false,
    commitMount: () => {},
    commitUpdate(inst: Instance, _type: string, prev: Props, next: Props) {
      inst.props = next;
      applyProps(inst, prev, next);
      applyChildProps(inst, prev);
    },
    commitTextUpdate: (inst: Instance, _prev: string, next: string) => b.set(inst.handle, 'label', next),
    resetTextContent: () => {},
    clearContainer: () => {},
    hideInstance: (inst: Instance) => b.call(inst.handle, 'widget.hide'),
    unhideInstance: (inst: Instance) => b.call(inst.handle, 'widget.show'),
    hideTextInstance: (inst: Instance) => b.call(inst.handle, 'widget.hide'),
    unhideTextInstance: (inst: Instance) => b.call(inst.handle, 'widget.show'),
    detachDeletedInstance: (inst: Instance) => destroyInstance(inst),

    getInstanceFromNode: () => null,
    beforeActiveInstanceBlur: () => {},
    afterActiveInstanceBlur: () => {},
    prepareScopeUpdate: () => {},
    getInstanceFromScope: () => null,

    setCurrentUpdatePriority: (p: number) => {
      priority = p;
    },
    getCurrentUpdatePriority: () => priority,
    resolveUpdatePriority: () => (priority !== NoEventPriority ? priority : DefaultEventPriority),
    trackSchedulerEvent: () => {},
    resolveEventType: () => null,
    resolveEventTimeStamp: () => -1.1,
    shouldAttemptEagerTransition: () => false,
    requestPostPaintCallback: () => {},
    maySuspendCommit: () => false,
    maySuspendCommitOnUpdate: () => false,
    maySuspendCommitInSyncRender: () => false,
    preloadInstance: () => true,
    startSuspendingCommit: () => {},
    suspendInstance: () => {},
    waitForCommitToBeReady: () => null,
    getSuspendedCommitReason: () => null,
    NotPendingTransition: null,
    HostTransitionContext: createContext(null),
    resetFormInstance: () => {},
    bindToConsole: (method: 'log' | 'warn' | 'error', args: unknown[]) =>
      Function.prototype.bind.call(console[method], console, ...args),
  };

  return { config, runDiscrete };
}
```

Create `maemo-react/packages/core/src/renderer.ts`:

```ts
/// <reference path="./react-reconciler.d.ts" />
import type { ReactNode } from 'react';
import Reconciler from 'react-reconciler';
import { ConcurrentRoot } from 'react-reconciler/constants.js';
import type { Bridge, Platform } from './bridge.js';
import { createHostConfig, type Container } from './hostConfig.js';

export interface Root {
  render(element: ReactNode): void;
  unmount(): void;
}

export interface Renderer {
  createRoot(): Root;
  /** Make a root and render into it. Returns when the widgets exist. */
  render(element: ReactNode): Root;
  /** Run fn as an event handler: its updates render before flushSync returns. */
  flushSync<T>(fn: () => T): T;
}

export interface RendererOptions {
  /** The user closed a window. Default: nothing. */
  onWindowClosed?: () => void;
  /** An error that no error boundary caught. Default: console.error. */
  onError?: (error: unknown, componentStack: string) => void;
}

function printError(error: unknown, componentStack: string) {
  console.error('Uncaught error in a React component:', error, componentStack ? '\n' + componentStack : '');
}

export function createRenderer(bridge: Bridge, platform: Platform, options: RendererOptions = {}): Renderer {
  const onError = options.onError ?? printError;
  // eslint-disable-next-line prefer-const
  let reconciler: any;
  const host = createHostConfig(bridge, platform, {
    onWindowClosed: options.onWindowClosed ?? (() => {}),
    flushSync: () => reconciler.flushSyncWork(),
  });
  reconciler = Reconciler(host.config);

  const report = (error: unknown, info?: { componentStack?: string }) => onError(error, info?.componentStack ?? '');

  function createRoot(): Root {
    const container: Container = { windows: new Set() };
    const fiberRoot = reconciler.createContainer(
      container, ConcurrentRoot, null, false, null, '', report, report, report, () => {},
    );
    return {
      render(element) {
        reconciler.updateContainerSync(element, fiberRoot, null, null);
        reconciler.flushSyncWork();
      },
      unmount() {
        reconciler.updateContainerSync(null, fiberRoot, null, null);
        reconciler.flushSyncWork();
      },
    };
  }

  return {
    createRoot,
    render(element) {
      const root = createRoot();
      root.render(element);
      return root;
    },
    flushSync: (fn) => host.runDiscrete(fn),
  };
}
```

Create `maemo-react/packages/core/src/index.ts`:

```ts
import { platform, quit } from 'maemo:app';
import * as gobject from 'maemo:gobject';
import type { Bridge } from './bridge.js';
import { createRenderer } from './renderer.js';

export type { Bridge, Handle, Platform, WidgetTarget } from './bridge.js';
export type { Renderer, RendererOptions, Root } from './renderer.js';
export { createRenderer } from './renderer.js';

const renderer = createRenderer(gobject as Bridge, platform, { onWindowClosed: () => quit(0) });

/** Render an element tree. The application runs until its window closes. */
export const render = renderer.render;
export const createRoot = renderer.createRoot;
/** Run fn like an event handler: its updates render before flushSync returns. */
export const flushSync = renderer.flushSync;
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run packages/core
```

Expected: 20 tests pass. They pass with React's development build (the Vitest default) and with the production build.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/packages/core maemo-react/package-lock.json
git commit -m "Add the maemo-react renderer

A react-reconciler 0.34 host config over the maemo:gobject bridge, with
tests against a fake bridge that keeps a widget tree in memory."
```

---

### Task 12: Widget types from the tablet's GTK (`typegen`)

**Files:**
- Create: `maemo-react/typegen/typegen.c`, `maemo-react/typegen/run.sh`, `maemo-react/typegen/emit.mjs`
- Modify: `maemo-react/runtime/Makefile` (a `typegen` target)
- Create (generated, committed): `maemo-react/packages/types/generated/gtk.json`, `maemo-react/packages/types/generated/intrinsics.d.ts`
- Test: `maemo-react/typegen/test/emit.test.mjs`

**Interfaces:**
- Consumes: `runtime/src/gtype.c` (Task 6), the Diablo sysroot (Task 1).
- Produces:
  - `typegen <Class>...` prints JSON: `{ gtk: "2.10.12", classes: [{ name, parent, abstract, properties, childProperties, signals }] }`. Each class comes with its parents up to `GtkWidget`. A property: `{ name, value: { type, kind, values? }, readable, writable, constructOnly }`, with `kind` one of `boolean`, `number`, `string`, `enum`, `flags`, `object`, `color`, `other`. A signal: `{ name, returns, params }`. A class lists the signals of the interfaces that it adds (so `GtkEntry` has `changed` from `GtkEditable`).
  - `typegen/emit.mjs` exports `emit(data, elements?)`, `tsType(value)`, `camel(s)`, `pascal(s)`, `ELEMENTS`. Run directly, it writes `intrinsics.d.ts` from `gtk.json`.
  - `intrinsics.d.ts` exports `Handle`, `WidgetTarget`, `CommonProps`, a `<Class>Props` interface for each class, and `MaemoIntrinsicElements`. Read-only, construct-only and `other` properties are left out, and so are `parent`, `child` and `user-data`.

- [ ] **Step 1: Write the failing test**

Create `maemo-react/typegen/test/emit.test.mjs`:

```js
import { expect, test } from 'vitest';
import { camel, emit, pascal, tsType } from '../emit.mjs';

const prop = (name, value, extra = {}) => ({ name, value, readable: true, writable: true, constructOnly: false, ...extra });
const DATA = {
  gtk: '2.10.12',
  classes: [
    {
      name: 'GtkWidget',
      parent: null,
      abstract: true,
      properties: [
        prop('visible', { type: 'gboolean', kind: 'boolean' }),
        prop('parent', { type: 'GtkContainer', kind: 'object' }),
      ],
      childProperties: [],
      signals: [{ name: 'show', returns: { type: 'void', kind: 'other' }, params: [] }],
    },
    {
      name: 'GtkLabel',
      parent: 'GtkWidget',
      abstract: false,
      properties: [
        prop('label', { type: 'gchararray', kind: 'string' }),
        prop('max-width-chars', { type: 'gint', kind: 'number' }),
        prop('justify', { type: 'GtkJustification', kind: 'enum', values: ['left', 'right'] }),
        prop('cursor-position', { type: 'gint', kind: 'number' }, { writable: false }),
        prop('pattern', { type: 'gchararray', kind: 'string' }, { constructOnly: true }),
        prop('attributes', { type: 'PangoAttrList', kind: 'other' }),
      ],
      childProperties: [],
      signals: [
        { name: 'populate-popup', returns: { type: 'void', kind: 'other' }, params: [{ type: 'GtkMenu', kind: 'object' }] },
        { name: 'activate-link', returns: { type: 'gboolean', kind: 'boolean' }, params: [] },
      ],
    },
  ],
};

test('emit writes a props interface for each class', () => {
  const out = emit(DATA, { 'gtk-label': ['GtkLabel', 'text'] });
  expect(out).toContain('export interface GtkWidgetProps extends CommonProps {');
  expect(out).toContain('export interface GtkLabelProps extends GtkWidgetProps {');
  expect(out).toContain('  label?: string | null;');
  expect(out).toContain('  maxWidthChars?: number;');
  expect(out).toContain('  justify?: "left" | "right";');
  expect(out).toContain('  onShow?: (target: WidgetTarget) => void;');
  expect(out).toContain('  onPopulatePopup?: (arg0: Handle | null, target: WidgetTarget) => void;');
  expect(out).toContain('  onActivateLink?: (target: WidgetTarget) => boolean | void;');
  expect(out).toContain("  'gtk-label': GtkLabelProps & { children?: string | number | Array<string | number> };");
});

test('emit leaves out what JSX cannot set', () => {
  const out = emit(DATA, { 'gtk-label': ['GtkLabel', 'text'] });
  expect(out).not.toContain('parent?:');
  expect(out).not.toContain('cursorPosition');
  expect(out).not.toContain('pattern?:');
  expect(out).not.toContain('attributes?:');
});

test('emit refuses an element whose class is missing', () => {
  expect(() => emit(DATA, { 'gtk-nope': ['GtkNope', 'none'] })).toThrow(/no class GtkNope/);
});

test('names and types', () => {
  expect(camel('hscrollbar-policy')).toBe('hscrollbarPolicy');
  expect(pascal('delete-event')).toBe('DeleteEvent');
  expect(tsType({ kind: 'flags', values: ['a', 'b'] })).toBe('Array<"a" | "b">');
  expect(tsType({ kind: 'color' })).toBe('string');
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run typegen
```

Expected: FAIL, because `typegen/emit.mjs` does not exist.

- [ ] **Step 3: Write emit.mjs**

Create `maemo-react/typegen/emit.mjs`:

```js
// Turn packages/types/generated/gtk.json (made by typegen on Diablo) into
// packages/types/generated/intrinsics.d.ts: the JSX types of the
// maemo-react intrinsic elements.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** JSX element name -> [GTK class, children model]. Keep it equal to packages/core/src/elements.ts. */
export const ELEMENTS = {
  'hildon-window': ['HildonWindow', 'node'],
  'gtk-vbox': ['GtkVBox', 'node'],
  'gtk-hbox': ['GtkHBox', 'node'],
  'gtk-label': ['GtkLabel', 'text'],
  'gtk-button': ['GtkButton', 'text'],
  'gtk-entry': ['GtkEntry', 'none'],
  'gtk-scrolled-window': ['GtkScrolledWindow', 'node'],
};

// Properties that the renderer manages, or that make no sense in JSX.
const SKIP_PROPS = new Set(['parent', 'child', 'user-data']);

const CHILDREN = {
  node: 'children?: ReactNode',
  text: 'children?: string | number | Array<string | number>',
  none: 'children?: never',
};

export const camel = (s) => s.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());
export const pascal = (s) => {
  const c = camel(s);
  return c[0].toUpperCase() + c.slice(1);
};

export function tsType(v) {
  switch (v.kind) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'string | null';
    case 'enum':
      return v.values.map((x) => JSON.stringify(x)).join(' | ');
    case 'flags':
      return 'Array<' + v.values.map((x) => JSON.stringify(x)).join(' | ') + '>';
    case 'object':
      return 'Handle | null';
    case 'color':
      return 'string';
    default:
      return v.type === 'void' ? 'void' : 'unknown';
  }
}

export function emit(data, elements = ELEMENTS) {
  const names = new Set(data.classes.map((c) => c.name));
  const out = [
    `// Generated by typegen/emit.mjs from GTK ${data.gtk} (typegen on the target). Do not edit.`,
    `import type { ReactNode } from 'react';`,
    '',
    '/** A GObject handle from maemo:gobject. */',
    'export type Handle = number;',
    '',
    '/** The last argument of every event handler, and the value of a ref. */',
    'export interface WidgetTarget {',
    '  readonly handle: Handle;',
    '  get(prop: string): unknown;',
    '}',
    '',
    "/** Props of every element: React's own, and the child properties in a box. */",
    'export interface CommonProps {',
    '  key?: string | number | null;',
    '  ref?: ((target: WidgetTarget | null) => void) | { current: WidgetTarget | null } | null;',
    '  /** In a box: take extra space. Default false. */',
    '  expand?: boolean;',
    '  /** In a box: fill the space given. Default true. */',
    '  fill?: boolean;',
    '  /** In a box: pixels around the child. Default 0. */',
    '  padding?: number;',
    "  /** In a box: pack from the start or the end. Default 'start'. */",
    "  packType?: 'start' | 'end';",
    '}',
    '',
  ];
  for (const c of data.classes) {
    const parent = c.parent && names.has(c.parent) ? `${c.parent}Props` : 'CommonProps';
    out.push(`export interface ${c.name}Props extends ${parent} {`);
    for (const p of c.properties) {
      if (!p.writable || p.constructOnly || p.value.kind === 'other' || SKIP_PROPS.has(p.name)) continue;
      out.push(`  ${camel(p.name)}?: ${tsType(p.value)};`);
    }
    for (const s of c.signals) {
      const params = s.params.map((v, i) => `arg${i}: ${tsType(v)}`).concat('target: WidgetTarget').join(', ');
      const ret = tsType(s.returns);
      out.push(`  on${pascal(s.name)}?: (${params}) => ${ret === 'void' ? 'void' : ret + ' | void'};`);
    }
    out.push('}', '');
  }
  out.push('/** The JSX intrinsic elements of maemo-react. */', 'export interface MaemoIntrinsicElements {');
  for (const [el, [cls, model]] of Object.entries(elements)) {
    if (!names.has(cls)) throw new Error(`the typegen data has no class ${cls}`);
    out.push(`  '${el}': ${cls}Props & { ${CHILDREN[model]} };`);
  }
  out.push('}', '');
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../packages/types/generated/', import.meta.url);
  const data = JSON.parse(readFileSync(new URL('gtk.json', dir), 'utf8'));
  writeFileSync(new URL('intrinsics.d.ts', dir), emit(data));
  console.log(`wrote packages/types/generated/intrinsics.d.ts from GTK ${data.gtk}`);
}
```

Run `npx vitest run typegen`. Expected: 4 tests pass.

- [ ] **Step 4: Write typegen.c and its build target**

Create `maemo-react/typegen/typegen.c`:

```c
/* typegen: write the properties, child properties and signals of GTK and
   Hildon classes as JSON, for the TypeScript types. typegen/run.sh runs it
   on the Diablo libraries under qemu-user, so the types match the tablet.

     typegen GtkLabel GtkButton ... > gtk.json

   Each class comes with its parents up to GtkWidget. A class lists only the
   properties and signals that it adds, and the signals of the interfaces
   that it adds. */
#include <stdio.h>
#include <string.h>
#include <gtk/gtk.h>
#include "mr.h"

static void json_string(const char *s)
{
    putchar('"');
    for (; s && *s; s++) {
        if (*s == '"' || *s == '\\')
            printf("\\%c", *s);
        else if ((unsigned char)*s < 0x20)
            printf("\\u%04x", *s);
        else
            putchar(*s);
    }
    putchar('"');
}

static const char *kind_of(GType t)
{
    if (t == GDK_TYPE_COLOR)
        return "color";
    switch (G_TYPE_FUNDAMENTAL(t)) {
    case G_TYPE_BOOLEAN: return "boolean";
    case G_TYPE_CHAR: case G_TYPE_UCHAR: case G_TYPE_INT: case G_TYPE_UINT:
    case G_TYPE_LONG: case G_TYPE_ULONG: case G_TYPE_INT64: case G_TYPE_UINT64:
    case G_TYPE_FLOAT: case G_TYPE_DOUBLE: return "number";
    case G_TYPE_STRING: return "string";
    case G_TYPE_ENUM: return "enum";
    case G_TYPE_FLAGS: return "flags";
    case G_TYPE_OBJECT: return "object";
    default: return "other";
    }
}

static void type_json(GType t)
{
    guint i, n = 0;
    printf("{\"type\":");
    json_string(t == G_TYPE_NONE ? "void" : g_type_name(t));
    printf(",\"kind\":\"%s\"", kind_of(t));
    if (G_TYPE_FUNDAMENTAL(t) == G_TYPE_ENUM) {
        GEnumClass *ec = g_type_class_ref(t);
        printf(",\"values\":[");
        for (i = 0; i < ec->n_values; i++) {
            if (i)
                putchar(',');
            json_string(ec->values[i].value_nick);
        }
        putchar(']');
        g_type_class_unref(ec);
    } else if (G_TYPE_FUNDAMENTAL(t) == G_TYPE_FLAGS) {
        GFlagsClass *fc = g_type_class_ref(t);
        printf(",\"values\":[");
        for (i = 0; i < fc->n_values; i++) {
            if (!fc->values[i].value)
                continue;
            if (n++)
                putchar(',');
            json_string(fc->values[i].value_nick);
        }
        putchar(']');
        g_type_class_unref(fc);
    }
    putchar('}');
}

static void props_json(GParamSpec **ps, guint n, GType owner)
{
    guint i, k = 0;
    putchar('[');
    for (i = 0; i < n; i++) {
        if (ps[i]->owner_type != owner)
            continue;
        if (k++)
            putchar(',');
        printf("{\"name\":");
        json_string(ps[i]->name);
        printf(",\"value\":");
        type_json(G_PARAM_SPEC_VALUE_TYPE(ps[i]));
        printf(",\"readable\":%s,\"writable\":%s,\"constructOnly\":%s}",
               ps[i]->flags & G_PARAM_READABLE ? "true" : "false",
               ps[i]->flags & G_PARAM_WRITABLE ? "true" : "false",
               ps[i]->flags & G_PARAM_CONSTRUCT_ONLY ? "true" : "false");
    }
    putchar(']');
}

static int signals_of(GType t, int count)
{
    guint n, i, j;
    guint *ids = g_signal_list_ids(t, &n);
    for (i = 0; i < n; i++) {
        GSignalQuery q;
        g_signal_query(ids[i], &q);
        if (count++)
            putchar(',');
        printf("{\"name\":");
        json_string(q.signal_name);
        printf(",\"returns\":");
        type_json(q.return_type & ~G_SIGNAL_TYPE_STATIC_SCOPE);
        printf(",\"params\":[");
        for (j = 0; j < q.n_params; j++) {
            if (j)
                putchar(',');
            type_json(q.param_types[j] & ~G_SIGNAL_TYPE_STATIC_SCOPE);
        }
        printf("]}");
    }
    g_free(ids);
    return count;
}

static void signals_json(GType t)
{
    GType parent = g_type_parent(t);
    GType *ifaces;
    guint n, i;
    int count;
    putchar('[');
    count = signals_of(t, 0);
    ifaces = g_type_interfaces(t, &n);
    for (i = 0; i < n; i++)
        if (!g_type_is_a(parent, ifaces[i]))
            count = signals_of(ifaces[i], count);
    g_free(ifaces);
    putchar(']');
}

int main(int argc, char **argv)
{
    GPtrArray *order = g_ptr_array_new();
    GHashTable *seen = g_hash_table_new(g_direct_hash, g_direct_equal);
    guint k;
    int i;
    gtk_init_check(&argc, &argv); /* some class_init functions use GDK */
    for (i = 1; i < argc; i++) {
        GType t = mr_type_from_name(argv[i]);
        GPtrArray *chain = g_ptr_array_new();
        if (!t) {
            fprintf(stderr, "typegen: unknown type %s\n", argv[i]);
            return 1;
        }
        for (; t && t != GTK_TYPE_OBJECT; t = g_type_parent(t))
            g_ptr_array_add(chain, GSIZE_TO_POINTER(t));
        while (chain->len) {
            gpointer c = g_ptr_array_index(chain, chain->len - 1);
            g_ptr_array_remove_index(chain, chain->len - 1);
            if (!g_hash_table_lookup(seen, c)) {
                g_hash_table_insert(seen, c, c);
                g_ptr_array_add(order, c);
            }
        }
        g_ptr_array_free(chain, TRUE);
    }
    printf("{\"gtk\":\"%d.%d.%d\",\"classes\":[", gtk_major_version, gtk_minor_version, gtk_micro_version);
    for (k = 0; k < order->len; k++) {
        GType t = GPOINTER_TO_SIZE(g_ptr_array_index(order, k));
        GObjectClass *klass = g_type_class_ref(t);
        GParamSpec **ps;
        guint n;
        if (k)
            putchar(',');
        printf("\n{\"name\":");
        json_string(g_type_name(t));
        printf(",\"parent\":");
        if (t == GTK_TYPE_WIDGET)
            printf("null");
        else
            json_string(g_type_name(g_type_parent(t)));
        printf(",\"abstract\":%s,\"properties\":", G_TYPE_IS_ABSTRACT(t) ? "true" : "false");
        ps = g_object_class_list_properties(klass, &n);
        props_json(ps, n, t);
        g_free(ps);
        printf(",\"childProperties\":");
        if (g_type_is_a(t, GTK_TYPE_CONTAINER)) {
            ps = gtk_container_class_list_child_properties(klass, &n);
            props_json(ps, n, t);
            g_free(ps);
        } else {
            printf("[]");
        }
        printf(",\"signals\":");
        signals_json(t);
        putchar('}');
        g_type_class_unref(klass);
    }
    printf("\n]}\n");
    return 0;
}
```

In `runtime/Makefile`, add before `clean:`:

```make
TYPEGEN := $(BUILD)/bin/typegen

typegen: $(TYPEGEN)

$(TYPEGEN): ../typegen/typegen.c $(BUILD)/obj/gtype.o src/mr.h
	@mkdir -p $(@D)
	$(CC) $(HOST_CFLAGS) $(LDFLAGS) -o $@ ../typegen/typegen.c $(BUILD)/obj/gtype.o $(GTK_LIBS) -ldl
```

and change `.PHONY: all clean` to `.PHONY: all clean typegen`.

Create `maemo-react/typegen/run.sh` (executable):

```bash
#!/usr/bin/env bash
# Build typegen for Diablo, run it under qemu-user on the tablet's GTK 2.10
# and Hildon 2.0, and write packages/types/generated/gtk.json. Run it in the
# dev container: devhost/run.sh typegen/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
CLASSES="HildonWindow GtkWindow GtkVBox GtkHBox GtkLabel GtkButton GtkEntry GtkScrolledWindow
         GtkTreeView GtkTextView GtkImage GtkCheckButton GtkToggleButton GtkHScale GtkVScale
         GtkComboBox GtkProgressBar"
runtime/build.sh diablo typegen
export DISPLAY=:99
pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 800x480x16 >/dev/null 2>&1 & sleep 1; }
OUT=packages/types/generated/gtk.json
mkdir -p "$(dirname "$OUT")"
# shellcheck disable=SC2086  # CLASSES is a list of words
qemu-arm -L /work/sysroot-diablo runtime/build/diablo/bin/typegen $CLASSES > "$OUT.tmp"
python3 -c "import json, sys; d = json.load(open(sys.argv[1])); assert d['gtk'].startswith('2.10.'), d['gtk']" "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "wrote $OUT ($(wc -c < "$OUT") bytes, GTK $(python3 -c "import json; print(json.load(open('$OUT'))['gtk'])"))"
```

The classes after `GtkScrolledWindow` are for M2. Their types cost nothing now.

- [ ] **Step 5: Generate the types from Diablo**

```bash
devhost/run.sh typegen/run.sh
npm run typegen:emit
```

Expected: `wrote packages/types/generated/gtk.json (... bytes, GTK 2.10.12)`, then `wrote packages/types/generated/intrinsics.d.ts from GTK 2.10.12`. Check two facts in the output: `grep -c "export interface" packages/types/generated/intrinsics.d.ts` gives about 30, and `grep "'gtk-entry'" packages/types/generated/intrinsics.d.ts` shows `GtkEntryProps & { children?: never }`.

When this plan was written, the same `typegen.c` ran on desktop GTK 2.24.33 and gave 12 classes for the 7 elements, with `changed` in the `GtkEntry` signals.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/typegen maemo-react/runtime/Makefile maemo-react/packages/types/generated
git commit -m "Add typegen: widget types from the tablet's GTK 2.10

typegen reads the GObject properties and signals of the GTK and Hildon
classes under qemu-user, and emit.mjs turns them into JSX types."
```

---

### Task 13: The types package and the widgets

**Files:**
- Create: `maemo-react/packages/types/package.json`, `packages/types/index.d.ts`, `globals.d.ts`, `modules.d.ts`, `jsx.d.ts`
- Create: `maemo-react/packages/types/test/check.tsx`, `packages/types/test/tsconfig.json`
- Create: `maemo-react/tsconfig.base.json`
- Create: `maemo-react/packages/widgets/package.json`, `packages/widgets/src/index.tsx`
- Test: `maemo-react/packages/widgets/test/widgets.test.tsx`, and `npm run typecheck`

**Interfaces:**
- Consumes: `packages/types/generated/intrinsics.d.ts` (Task 12); `createRenderer` and the fake bridge (Task 11).
- Produces:
  - `@maemo-react/types`: put it in `compilerOptions.types` of an application. It declares the web-global subset (spec section 7), the modules `maemo:app`, `maemo:gobject`, `maemo:http`, `maemo:debug`, and adds `MaemoIntrinsicElements` to React's JSX.
  - `@maemo-react/widgets`: `Window`, `Box` (`vertical?: boolean`), `Label`, `Button` (`onClick?: () => void`), `Entry` (`value?: string`, `onChangeText?: (text: string) => void`), `ScrolledWindow`, and a `<Name>Props` type for each.
  - `npm run typecheck` compiles `packages/types/test/check.tsx`, which uses all of these, and fails if a line marked as an expected error compiles.

- [ ] **Step 1: Write the failing widget test and the type check**

Create `maemo-react/packages/widgets/test/widgets.test.tsx`:

```tsx
import { describe, expect, test } from 'vitest';
import { createRenderer } from '../../core/src/renderer.js';
import { fakeBridge } from '../../core/test/fakeBridge.js';
import { Box, Button, Entry, Label, ScrolledWindow, Window } from '../src/index.js';

function setup() {
  const fake = fakeBridge();
  const renderer = createRenderer(fake.bridge, 'hildon', { onError: (e) => { throw e; } });
  return { ...fake, renderer };
}

describe('widgets', () => {
  test('Box is a row by default and a column when vertical', () => {
    const t = setup();
    t.renderer.render(
      <Window>
        <Box vertical spacing={2}>
          <Box />
        </Box>
      </Window>,
    );
    expect(t.ofType('GtkVBox')).toHaveLength(1);
    expect(t.ofType('GtkHBox')).toHaveLength(1);
    expect(t.props(t.ofType('GtkVBox')[0]).spacing).toBe(2);
  });

  test('Button calls onClick on clicked', () => {
    const t = setup();
    let n = 0;
    t.renderer.render(
      <Window>
        <Button onClick={() => n++}>Go</Button>
      </Window>,
    );
    const [b] = t.ofType('GtkButton');
    expect(t.props(b).label).toBe('Go');
    t.emit(b, 'clicked');
    expect(n).toBe(1);
  });

  test('Entry gives the new text to onChangeText', () => {
    const t = setup();
    let got = '';
    t.renderer.render(
      <Window>
        <Entry value="a" onChangeText={(s) => (got = s)} />
      </Window>,
    );
    const [e] = t.ofType('GtkEntry');
    expect(t.props(e).text).toBe('a');
    t.poke(e, 'text', 'ab');
    t.emit(e, 'changed');
    expect(got).toBe('ab');
  });

  test('Label and ScrolledWindow pass their props', () => {
    const t = setup();
    t.renderer.render(
      <Window title="w">
        <ScrolledWindow vscrollbarPolicy="always">
          <Label wrap>hello</Label>
        </ScrolledWindow>
      </Window>,
    );
    const [s] = t.ofType('GtkScrolledWindow');
    expect(t.props(s)['vscrollbar-policy']).toBe('always');
    expect(t.props(t.ofType('GtkLabel')[0])).toMatchObject({ label: 'hello', wrap: true });
    expect(t.props(t.ofType('HildonWindow')[0]).title).toBe('w');
  });
});
```

Create `maemo-react/packages/types/test/check.tsx`:

```tsx
// Compile-time checks of the types. tsc must accept this file, and each line
// that is marked as an expected error must really be an error.
import { useState } from 'react';
import { render } from '@maemo-react/core';
import { Box, Button, Entry, Label, ScrolledWindow, Window } from '@maemo-react/widgets';
import { request } from 'maemo:http';
import { quit } from 'maemo:app';

function App() {
  const [n, setN] = useState(0);
  const [text, setText] = useState('');
  return (
    <Window title="t">
      <Box vertical spacing={4} homogeneous>
        <Label wrap expand>
          Count {n}
        </Label>
        <Button onClick={() => setN(n + 1)}>+</Button>
        <Entry value={text} onChangeText={setText} maxLength={20} />
        <ScrolledWindow hscrollbarPolicy="never">
          <gtk-vbox />
        </ScrolledWindow>
        <gtk-entry text="x" onChanged={(t) => console.log(t.get('text'))} />
        {/* @ts-expect-error: GtkLabel has no such property */}
        <gtk-label nope />
        {/* @ts-expect-error: not a GtkPolicyType */}
        <gtk-scrolled-window hscrollbarPolicy="sometimes" />
        {/* @ts-expect-error: spacing is a number */}
        <gtk-vbox spacing="4" />
        {/* @ts-expect-error: an entry has no children */}
        <gtk-entry>text</gtk-entry>
      </Box>
    </Window>
  );
}

render(<App />);
fetch('https://example.com/').then((r) => r.json());
const u: URL = new URL('https://example.com/');
request({ url: u.href }, (ev) => {
  if (ev.type === 'data') console.log(ev.chunk.byteLength);
});
quit(0);
// @ts-expect-error: there is no DOM on the tablet
document.title = 'x';
```

Create `maemo-react/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "lib": ["es2023"],
    "types": []
  }
}
```

Create `maemo-react/packages/types/test/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "files": ["../index.d.ts", "check.tsx"]
}
```

The `typecheck` script in `maemo-react/package.json` (Task 5) runs this check.

- [ ] **Step 2: Run them to see them fail**

```bash
npx vitest run packages/widgets
npm run typecheck
```

Expected: Vitest fails because `packages/widgets/src/index.tsx` does not exist; `tsc` fails because `@maemo-react/types` and `@maemo-react/widgets` cannot be found.

- [ ] **Step 3: Write the types package**

Create `maemo-react/packages/types/package.json`:

```json
{
  "name": "@maemo-react/types",
  "version": "0.1.0",
  "types": "index.d.ts",
  "files": ["*.d.ts", "generated/*.d.ts"]
}
```

Create `maemo-react/packages/types/index.d.ts`:

```ts
/// <reference path="./globals.d.ts" />
/// <reference path="./modules.d.ts" />
/// <reference path="./jsx.d.ts" />
export * from './generated/intrinsics.js';
```

Create `maemo-react/packages/types/globals.d.ts`:

```ts
// The web-standard globals that maemo-react-host gives. This is a subset of
// lib.dom on purpose: an application that uses anything else does not compile,
// because the tablet does not have it.
declare global {
  interface Console {
    log(...data: unknown[]): void;
    info(...data: unknown[]): void;
    debug(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
    trace(...data: unknown[]): void;
    assert(condition?: boolean, ...data: unknown[]): void;
    dir(item?: unknown): void;
  }
  var console: Console;

  interface Performance {
    now(): number;
  }
  var performance: Performance;

  function setTimeout<A extends unknown[]>(handler: (...args: A) => void, timeout?: number, ...args: A): number;
  function setInterval<A extends unknown[]>(handler: (...args: A) => void, timeout?: number, ...args: A): number;
  function clearTimeout(id?: number): void;
  function clearInterval(id?: number): void;
  function queueMicrotask(callback: () => void): void;

  class TextEncoder {
    readonly encoding: 'utf-8';
    encode(input?: string): Uint8Array;
  }

  class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
    readonly encoding: 'utf-8';
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    decode(input?: ArrayBuffer | ArrayBufferView): string;
  }

  class URLSearchParams implements Iterable<[string, string]> {
    constructor(init?: string | Record<string, string> | Iterable<[string, string]> | URLSearchParams);
    readonly size: number;
    append(name: string, value: string): void;
    delete(name: string, value?: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string, value?: string): boolean;
    set(name: string, value: string): void;
    sort(): void;
    forEach(fn: (value: string, key: string, parent: URLSearchParams) => void, thisArg?: unknown): void;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
    toString(): string;
  }

  class URL {
    constructor(url: string | URL, base?: string | URL);
    static canParse(url: string | URL, base?: string | URL): boolean;
    href: string;
    readonly protocol: string;
    readonly username: string;
    readonly password: string;
    readonly host: string;
    readonly hostname: string;
    readonly port: string;
    readonly origin: string;
    pathname: string;
    search: string;
    readonly searchParams: URLSearchParams;
    hash: string;
    toString(): string;
    toJSON(): string;
  }

  class Event {
    constructor(type: string, init?: { bubbles?: boolean; cancelable?: boolean });
    readonly type: string;
    readonly bubbles: boolean;
    readonly cancelable: boolean;
    readonly defaultPrevented: boolean;
    readonly target: EventTarget | null;
    readonly currentTarget: EventTarget | null;
    readonly timeStamp: number;
    preventDefault(): void;
    stopPropagation(): void;
    stopImmediatePropagation(): void;
  }

  type EventListenerOrObject = ((event: Event) => void) | { handleEvent(event: Event): void };

  class EventTarget {
    addEventListener(type: string, listener: EventListenerOrObject | null, options?: { once?: boolean } | boolean): void;
    removeEventListener(type: string, listener: EventListenerOrObject | null): void;
    dispatchEvent(event: Event): boolean;
  }

  class DOMException extends Error {
    constructor(message?: string, name?: string);
    readonly code: number;
  }

  class AbortSignal extends EventTarget {
    readonly aborted: boolean;
    readonly reason: unknown;
    onabort: ((event: Event) => void) | null;
    throwIfAborted(): void;
    static abort(reason?: unknown): AbortSignal;
    static timeout(ms: number): AbortSignal;
  }

  class AbortController {
    readonly signal: AbortSignal;
    abort(reason?: unknown): void;
  }

  type HeadersInit = Headers | Record<string, string> | Iterable<[string, string]>;

  class Headers implements Iterable<[string, string]> {
    constructor(init?: HeadersInit);
    append(name: string, value: string): void;
    set(name: string, value: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    delete(name: string): void;
    getSetCookie(): string[];
    forEach(fn: (value: string, key: string, parent: Headers) => void, thisArg?: unknown): void;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
  }

  type BodyInit = string | URLSearchParams | ArrayBuffer | ArrayBufferView;

  interface RequestInit {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
    signal?: AbortSignal | null;
    redirect?: 'follow' | 'manual';
  }

  class Request {
    constructor(input: string | URL | Request, init?: RequestInit);
    readonly url: string;
    readonly method: string;
    readonly headers: Headers;
    readonly signal: AbortSignal | null;
    readonly redirect: 'follow' | 'manual';
  }

  interface ResponseInit {
    status?: number;
    statusText?: string;
    headers?: HeadersInit;
  }

  class Response {
    constructor(body?: BodyInit | null, init?: ResponseInit);
    static json(data: unknown, init?: ResponseInit): Response;
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly url: string;
    readonly redirected: boolean;
    readonly type: string;
    readonly bodyUsed: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    bytes(): Promise<Uint8Array>;
    text(): Promise<string>;
    json(): Promise<any>;
  }

  function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export {};
```

Create `maemo-react/packages/types/modules.d.ts`:

```ts
// The native modules of maemo-react-host.

declare module 'maemo:app' {
  /** Stop the application with an exit code. */
  export function quit(code?: number): void;
  /** The path of the application module, then its arguments. */
  export const args: string[];
  /** The maemo-react version, for example "0.1.0". */
  export const version: string;
  /** 'hildon' on the tablet, 'desktop' in the desktop dev host. */
  export const platform: 'hildon' | 'desktop';
}

declare module 'maemo:gobject' {
  export type Handle = number;
  export function create(type: string): Handle;
  export function set(h: Handle, prop: string, value: unknown): void;
  export function get(h: Handle, prop: string): unknown;
  export function reset(h: Handle, prop: string): void;
  export function connect(h: Handle, signal: string, fn: (...args: any[]) => unknown): number;
  export function childSet(parent: Handle, child: Handle, prop: string, value: unknown): void;
  export function childGet(parent: Handle, child: Handle, prop: string): unknown;
  export function call(h: Handle, helper: string, ...args: unknown[]): unknown;
  export function destroy(h: Handle): void;
}

declare module 'maemo:http' {
  export interface RequestOptions {
    url: string;
    method?: string;
    headers?: Array<[string, string]>;
    body?: ArrayBuffer | null;
    timeoutMs?: number;
    followRedirects?: boolean;
  }
  export type HttpEvent =
    | { type: 'headers'; status: number; statusText: string; url: string; redirected: boolean; headers: Array<[string, string]> }
    | { type: 'data'; chunk: ArrayBuffer }
    | { type: 'end' }
    | { type: 'error'; message: string; code: number };
  export function request(options: RequestOptions, onEvent: (event: HttpEvent) => void): number;
  export function abort(id: number): void;
}

declare module 'maemo:debug' {
  export function stats(): { handles: number; closures: number; jsMallocSize: number };
  /** Milliseconds spent in GTK setters and layout helpers since the last call. */
  export function bridgeTime(): number;
  /** Paint all pending changes now, and wait for the X server. */
  export function flushPaint(): void;
  export function cpu(): { governor: string; kHz: number | null } | null;
  export function gc(): void;
}
```

Create `maemo-react/packages/types/jsx.d.ts`:

```ts
// Add the maemo-react elements to React's JSX.
import type { MaemoIntrinsicElements } from './generated/intrinsics.js';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends MaemoIntrinsicElements {}
  }
}
```

- [ ] **Step 4: Write the widgets**

Create `maemo-react/packages/widgets/package.json`:

```json
{
  "name": "@maemo-react/widgets",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.tsx",
  "types": "src/index.tsx",
  "peerDependencies": {
    "react": "19.3.0"
  },
  "devDependencies": {
    "@maemo-react/core": "0.1.0",
    "@maemo-react/types": "0.1.0"
  }
}
```

Create `maemo-react/packages/widgets/src/index.tsx`:

```tsx
// Typed components with friendly names over the maemo-react elements.
import type { ReactNode } from 'react';
import type { MaemoIntrinsicElements, WidgetTarget } from '@maemo-react/types';

type El<K extends keyof MaemoIntrinsicElements> = MaemoIntrinsicElements[K];

export type WindowProps = El<'hildon-window'>;

/** A top-level window: a HildonWindow on the tablet. It takes one child. */
export function Window(props: WindowProps) {
  return <hildon-window {...props} />;
}

export type BoxProps = Omit<El<'gtk-vbox'>, 'children'> & {
  /** Put the children in a column. Default: a row. */
  vertical?: boolean;
  children?: ReactNode;
};

/** A row or a column of children. */
export function Box({ vertical = false, ...rest }: BoxProps) {
  return vertical ? <gtk-vbox {...rest} /> : <gtk-hbox {...rest} />;
}

export type LabelProps = El<'gtk-label'>;

/** Text. The children must be text. */
export function Label(props: LabelProps) {
  return <gtk-label {...props} />;
}

export type ButtonProps = Omit<El<'gtk-button'>, 'onClicked'> & {
  onClick?: () => void;
};

/** A push button. The children are its label. */
export function Button({ onClick, ...rest }: ButtonProps) {
  return <gtk-button {...rest} onClicked={onClick ? () => onClick() : undefined} />;
}

export type EntryProps = Omit<El<'gtk-entry'>, 'text' | 'onChanged'> & {
  /** The text. Give it to make a controlled entry. */
  value?: string;
  /** Called with the new text after each change. */
  onChangeText?: (text: string) => void;
};

/** A one-line text field. */
export function Entry({ value, onChangeText, ...rest }: EntryProps) {
  return (
    <gtk-entry
      {...rest}
      text={value}
      onChanged={onChangeText ? (target: WidgetTarget) => onChangeText(String(target.get('text') ?? '')) : undefined}
    />
  );
}

export type ScrolledWindowProps = El<'gtk-scrolled-window'>;

/** Scroll bars around one child. */
export function ScrolledWindow(props: ScrolledWindowProps) {
  return <gtk-scrolled-window {...props} />;
}
```

- [ ] **Step 5: Run the tests and the type check**

```bash
npm install
npx vitest run
npm run typecheck
```

Expected: all Vitest tests pass (including 4 widget tests), and `tsc` prints nothing and exits 0. When this plan was written, the same files compiled against types generated from desktop GTK 2.24.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/packages maemo-react/tsconfig.base.json maemo-react/package.json maemo-react/package-lock.json
git commit -m "Add @maemo-react/types and @maemo-react/widgets

Types for the web globals, the maemo:* modules and the JSX elements,
and typed components with friendly names over the elements."
```

---

### Task 14: React on the real bridge

**Files:**
- Create: `maemo-react/runtime/test/bundles/react-gtk.jsx`
- Test: `maemo-react/runtime/test/generated/react-gtk.test.js` (generated)

**Interfaces:**
- Consumes: everything before. This is the first test of the whole stack: React 19, the renderer, the widgets, the bridge and GTK, on both targets.
- Produces: no new interfaces.

- [ ] **Step 1: Write the test**

Create `maemo-react/runtime/test/bundles/react-gtk.jsx`. Its last test covers Review Focus item 5:

```jsx
import { useState } from 'react';
import { render } from '@maemo-react/core';
import { Box, Button, Entry, Label, Window } from '@maemo-react/widgets';
import { call, get, set } from 'maemo:gobject';
import { stats } from 'maemo:debug';
import { test, assertEqual, run } from '../harness.js';

const refs = {};
const before = stats().handles;

function App() {
  const [n, setN] = useState(0);
  const [text, setText] = useState('');
  const [gone, setGone] = useState(false);
  return (
    <Window title="react-gtk test">
      <Box vertical spacing={4}>
        <Label ref={(r) => (refs.count = r)}>{'count ' + n}</Label>
        <Button ref={(r) => (refs.inc = r)} onClick={() => setN(n + 1)}>
          +1
        </Button>
        <Entry ref={(r) => (refs.entry = r)} value={text} onChangeText={setText} />
        <Label ref={(r) => (refs.echo = r)}>{'echo ' + text}</Label>
        {gone ? null : (
          <Button ref={(r) => (refs.gone = r)} onClick={() => setGone(true)}>
            remove me
          </Button>
        )}
      </Box>
    </Window>
  );
}

const root = render(<App />);

test('the tree is made of GTK widgets', () => {
  assertEqual(get(refs.count.handle, 'label'), 'count 0');
  assertEqual(get(refs.inc.handle, 'label'), '+1');
});

test('a click updates the label before the click returns', () => {
  call(refs.inc.handle, 'button.clicked');
  assertEqual(get(refs.count.handle, 'label'), 'count 1');
  call(refs.inc.handle, 'button.clicked');
  assertEqual(get(refs.count.handle, 'label'), 'count 2');
});

test('typing goes through React state', () => {
  set(refs.entry.handle, 'text', 'abc'); // GTK emits "changed"
  assertEqual(get(refs.echo.handle, 'label'), 'echo abc');
  assertEqual(get(refs.entry.handle, 'text'), 'abc');
});

test('a button that removes itself in its click handler', () => {
  const h = refs.gone.handle;
  const handles = stats().handles;
  call(h, 'button.clicked');
  assertEqual(refs.gone, null);
  assertEqual(stats().handles, handles - 1);
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

Expected: every line is `PASS`, including `test/generated/react-gtk.test.js` on both targets. If "a button that removes itself" crashes with a GTK critical, the widget was freed during its own `clicked` emission: check that `js_call` in `bridge.c` holds its reference (`g_object_ref`) during the helper.

- [ ] **Step 3: Commit**

```bash
git add maemo-react/runtime/test/bundles/react-gtk.jsx
git commit -m "Test React on the real bridge on both targets"
```


---

### Task 15: The command line tool (`@maemo-react/cli`)

**Files:**
- Create: `maemo-react/packages/cli/package.json`, `packages/cli/tsconfig.json`
- Create: `maemo-react/packages/cli/src/tar.ts`, `ar.ts`, `deb.ts`, `png.ts`, `app.ts`, `build.ts`, `package.ts`, `deploy.ts`, `templates.ts`, `create.ts`, `index.ts`
- Modify: `maemo-react/package.json` (scripts `build:cli` and `typecheck`)
- Test: `maemo-react/packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: esbuild 0.28.2. The application packages (`@maemo-react/core`, `@maemo-react/widgets`) only at application build time.
- Produces:
  - The command `maemo-react` (`packages/cli/dist/cli.js`, made by `npm run build:cli`): `create <dir> [--id] [--name]`, `build`, `package`, `deploy [file.deb] [--host] [--port] [--user]`.
  - `app.json`: `{ id, name, version, description?, maintainer?, icon?, deploy?: { host?, port?, user? } }`.
  - `build` writes `dist/app.js` (ES module, ES2020, minified, `maemo:*` external). `package` writes `dist/<id>_<version>_all.deb` with the bundle in `/opt/n810-modern/share/maemo-react/apps/<id>/app.js`, a menu entry, an icon in three sizes, `Depends: maemo-react-runtime (>= 0.1.0)`, a `postinst` that compiles the bytecode, and a `postrm` that removes it.
  - `deploy` copies the `.deb` with `scp` and runs `dpkg -i` through `sudo gainroot` (the default port is 2222, the default user is `user`).
  - Library functions (for tests): `writeTar`, `writeTarGz`, `writeAr`, `readAr`, `buildDeb`, `iconPng`, `colorFor`, `readManifest`, `buildApp`, `packageApp`, `deploy(deb, target, run?)`, `createApp(dir, id, name)`.

- [ ] **Step 1: Write the package files and the failing test**

Create `maemo-react/packages/cli/package.json`:

```json
{
  "name": "@maemo-react/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "maemo-react": "dist/cli.js"
  },
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --packages=external --banner:js=\"#!/usr/bin/env node\" --outfile=dist/cli.js --log-level=warning && chmod +x dist/cli.js"
  },
  "dependencies": {
    "esbuild": "0.28.2"
  },
  "engines": {
    "node": ">=22.2"
  }
}
```

Create `maemo-react/packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src"]
}
```

In `maemo-react/package.json`, add the script `"build:cli": "npm run build -w @maemo-react/cli"`, and change `typecheck` to `"tsc -p packages/types/test && tsc -p packages/cli"`.

Create `maemo-react/packages/cli/test/cli.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { readManifest } from '../src/app.js';
import { readAr, writeAr } from '../src/ar.js';
import { createApp } from '../src/create.js';
import { buildDeb } from '../src/deb.js';
import { deploy } from '../src/deploy.js';
import { packageApp } from '../src/package.js';
import { iconPng } from '../src/png.js';
import { writeTar } from '../src/tar.js';

const temp = () => mkdtempSync(join(tmpdir(), 'maemo-react-cli-'));

/** Extract a tar with the system tar, and return the folder. */
function untar(buf: Buffer): string {
  const dir = temp();
  execFileSync('tar', ['-xf', '-', '-C', dir], { input: buf });
  return dir;
}

describe('tar', () => {
  test('the system tar extracts files, folders, modes and long paths', () => {
    const long = 'd'.repeat(90) + '/' + 'f'.repeat(60) + '.txt';
    const dir = untar(
      writeTar([
        { path: './a/', type: 'dir', mode: 0o755 },
        { path: './a/run.sh', type: 'file', mode: 0o755, data: Buffer.from('#!/bin/sh\n') },
        { path: './' + long, type: 'file', mode: 0o644, data: Buffer.from('x'.repeat(1000)) },
      ]),
    );
    expect(readFileSync(join(dir, 'a/run.sh'), 'utf8')).toBe('#!/bin/sh\n');
    expect(statSync(join(dir, 'a/run.sh')).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(dir, long), 'utf8')).toHaveLength(1000);
  });
});

describe('ar', () => {
  test('round trip, with an odd size', () => {
    const entries = [
      { name: 'debian-binary', data: Buffer.from('2.0\n') },
      { name: 'odd', data: Buffer.from('abc') },
      { name: 'last', data: Buffer.from('z') },
    ];
    const back = readAr(writeAr(entries));
    expect(back.map((e) => [e.name, Buffer.from(e.data).toString()])).toEqual([
      ['debian-binary', '2.0\n'],
      ['odd', 'abc'],
      ['last', 'z'],
    ]);
  });
});

describe('deb', () => {
  test('the members, the control file and the scripts', () => {
    const deb = buildDeb({
      control: [['Package', 'x'], ['Description', 'Short\nLong line.\n\nNext paragraph.']],
      files: [{ path: '/opt/x/app.js', data: Buffer.from('1') }],
      scripts: { postinst: '#!/bin/sh\nexit 0\n' },
    });
    const members = readAr(deb);
    expect(members.map((m) => m.name)).toEqual(['debian-binary', 'control.tar.gz', 'data.tar.gz']);
    const control = untar(gunzipSync(members[1].data));
    expect(readFileSync(join(control, 'control'), 'utf8')).toBe(
      'Package: x\nDescription: Short\n Long line.\n .\n Next paragraph.\nInstalled-Size: 1\n',
    );
    expect(statSync(join(control, 'postinst')).mode & 0o777).toBe(0o755);
    const data = untar(gunzipSync(members[2].data));
    expect(readFileSync(join(data, 'opt/x/app.js'), 'utf8')).toBe('1');
  });

  test('a relative path is refused', () => {
    expect(() => buildDeb({ control: [], files: [{ path: 'opt/x', data: Buffer.from('') }] })).toThrow(/absolute/);
  });
});

describe('manifest', () => {
  const write = (m: object) => {
    const dir = temp();
    writeFileSync(join(dir, 'app.json'), JSON.stringify(m));
    return dir;
  };
  test('a valid manifest', () => {
    expect(readManifest(write({ id: 'hello', name: 'Hello', version: '0.1.0' })).id).toBe('hello');
  });
  test.each([
    [{ id: 'Hello', name: 'H', version: '1' }, /Debian package name/],
    [{ id: 'hello', name: '', version: '1' }, /"name" is missing/],
    [{ id: 'hello', name: 'H', version: 'v1' }, /must start with a digit/],
  ])('an invalid manifest: %j', (m, pattern) => {
    expect(() => readManifest(write(m))).toThrow(pattern);
  });
});

describe('create and package', () => {
  test('create makes an application that package turns into a .deb', () => {
    const dir = join(temp(), 'my-app');
    createApp(dir, 'my-app', 'My App');
    for (const f of ['app.json', 'package.json', 'tsconfig.json', 'src/main.tsx', 'src/App.tsx', 'icon.png']) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
    expect(readManifest(dir)).toMatchObject({ id: 'my-app', name: 'My App', version: '0.1.0' });

    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist/app.js'), 'console.log(1);\n');
    const deb = packageApp(dir);
    expect(deb).toBe(join(dir, 'dist/my-app_0.1.0_all.deb'));
    const members = readAr(readFileSync(deb));
    const data = untar(gunzipSync(members[2].data));
    const desktop = readFileSync(join(data, 'usr/share/applications/hildon/my-app.desktop'), 'utf8');
    expect(desktop).toContain('Exec=/opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/my-app/app.js');
    expect(existsSync(join(data, 'usr/share/icons/hicolor/64x64/hildon/my-app.png'))).toBe(true);
    const control = untar(gunzipSync(members[1].data));
    expect(readFileSync(join(control, 'control'), 'utf8')).toContain('Depends: maemo-react-runtime (>= 0.1.0)');
    expect(readFileSync(join(control, 'postinst'), 'utf8')).toContain('--compile /opt/n810-modern/share/maemo-react/apps/my-app/app.js');
  });

  test('create refuses a folder that is not empty', () => {
    const dir = temp();
    writeFileSync(join(dir, 'x'), '');
    expect(() => createApp(dir, 'x-app', 'X')).toThrow(/not empty/);
  });

  test('package needs a build first', () => {
    const dir = temp();
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ id: 'abc', name: 'A', version: '1' }));
    expect(() => packageApp(dir)).toThrow(/run "maemo-react build" first/);
  });
});

test('deploy copies, then installs as root', () => {
  const calls: string[][] = [];
  deploy('/tmp/x/app_0.1.0_all.deb', { host: 'tablet', port: 2222, user: 'user' }, (cmd, args) => {
    calls.push([cmd, ...args]);
  });
  expect(calls).toEqual([
    ['ssh', '-p', '2222', '-o', 'BatchMode=yes', 'user@tablet', 'mkdir -p .maemo-react/incoming'],
    ['scp', '-P', '2222', '-o', 'BatchMode=yes', '/tmp/x/app_0.1.0_all.deb', 'user@tablet:.maemo-react/incoming/'],
    ['ssh', '-p', '2222', '-o', 'BatchMode=yes', 'user@tablet', "echo 'dpkg -i /home/user/.maemo-react/incoming/app_0.1.0_all.deb' | sudo gainroot"],
  ]);
});

test('the icon is a PNG of the given size', () => {
  const png = iconPng(64, [10, 20, 30]);
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([64, 64]);
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm install
npx vitest run packages/cli
```

Expected: FAIL, because the modules in `packages/cli/src/` do not exist.

If Vitest fails with `Cannot find native binding` after an `npm install`, npm hit its optional-dependency bug (npm/cli#4828). Delete `node_modules` and `package-lock.json` and run `npm install` again.

- [ ] **Step 3: Write the archive writers**

Create `maemo-react/packages/cli/src/tar.ts`:

```ts
// A ustar writer for package archives: every entry belongs to root.
import { gzipSync } from 'node:zlib';

export interface TarEntry {
  /** "./opt/x/" for a folder, "./opt/x/file" for a file. */
  path: string;
  type: 'file' | 'dir';
  mode: number;
  data?: Uint8Array;
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function header(e: TarEntry, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(512, 0);
  let name = e.path;
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 154);
    prefix = name.slice(0, cut);
    name = name.slice(cut + 1);
    if (cut < 0 || Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) {
      throw new Error('tar: the path is too long: ' + e.path);
    }
  }
  h.write(name, 0, 100, 'utf8');
  h.write(octal(e.mode, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(mtime, 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write(e.type === 'dir' ? '5' : '0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write('root', 265, 32, 'ascii');
  h.write('root', 297, 32, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

export function writeTar(entries: TarEntry[], mtime = Math.floor(Date.now() / 1000)): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = e.type === 'file' ? Buffer.from(e.data ?? new Uint8Array(0)) : Buffer.alloc(0);
    parts.push(header(e, data.length, mtime), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** Gzip, because Diablo's dpkg 1.14 cannot read xz or zstd. */
export function writeTarGz(entries: TarEntry[], mtime?: number): Buffer {
  return gzipSync(writeTar(entries, mtime), { level: 9 });
}
```

Create `maemo-react/packages/cli/src/ar.ts`:

```ts
// The common ar format of .deb files.

export interface ArEntry {
  name: string;
  data: Uint8Array;
}

function field(s: string, width: number): string {
  if (s.length > width) throw new Error('ar: the field is too long: ' + s);
  return s.padEnd(width, ' ');
}

export function writeAr(entries: ArEntry[], mtime = Math.floor(Date.now() / 1000)): Buffer {
  const parts = [Buffer.from('!<arch>\n', 'ascii')];
  for (const e of entries) {
    const head =
      field(e.name, 16) + field(String(mtime), 12) + field('0', 6) + field('0', 6) +
      field('100644', 8) + field(String(e.data.length), 10) + '`\n';
    parts.push(Buffer.from(head, 'ascii'), Buffer.from(e.data));
    if (e.data.length % 2) parts.push(Buffer.from('\n', 'ascii'));
  }
  return Buffer.concat(parts);
}

/** Read an ar archive (for tests). */
export function readAr(buf: Buffer): ArEntry[] {
  if (buf.subarray(0, 8).toString('ascii') !== '!<arch>\n') throw new Error('ar: not an ar archive');
  const out: ArEntry[] = [];
  let off = 8;
  while (off < buf.length) {
    const name = buf.subarray(off, off + 16).toString('ascii').trim();
    const size = Number(buf.subarray(off + 48, off + 58).toString('ascii').trim());
    out.push({ name, data: buf.subarray(off + 60, off + 60 + size) });
    off += 60 + size + (size % 2);
  }
  return out;
}
```

Create `maemo-react/packages/cli/src/deb.ts`:

```ts
// Build a .deb in memory: debian-binary, control.tar.gz, data.tar.gz.
import { writeAr } from './ar.js';
import { writeTarGz, type TarEntry } from './tar.js';

export interface DebFile {
  /** The install path, for example /opt/n810-modern/bin/x. */
  path: string;
  data: Uint8Array;
  mode?: number;
}

export interface DebSpec {
  /** Control fields in order. A multi-line value is folded as Debian wants. */
  control: Array<[string, string]>;
  files: DebFile[];
  scripts?: { postinst?: string; prerm?: string; postrm?: string };
}

function controlText(fields: Array<[string, string]>): string {
  return (
    fields
      .map(([k, v]) => `${k}: ` + v.split('\n').map((line, i) => (i === 0 ? line : ' ' + (line === '' ? '.' : line))).join('\n'))
      .join('\n') + '\n'
  );
}

export function buildDeb(spec: DebSpec, mtime?: number): Buffer {
  const dirs = new Set<string>();
  for (const f of spec.files) {
    if (!f.path.startsWith('/')) throw new Error('deb: the path must be absolute: ' + f.path);
    const parts = f.path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const data: TarEntry[] = [{ path: './', type: 'dir', mode: 0o755 }];
  for (const d of [...dirs].sort()) data.push({ path: './' + d + '/', type: 'dir', mode: 0o755 });
  for (const f of spec.files) data.push({ path: '.' + f.path, type: 'file', mode: f.mode ?? 0o644, data: f.data });

  const size = Math.max(1, Math.ceil(spec.files.reduce((n, f) => n + f.data.length, 0) / 1024));
  const control: TarEntry[] = [
    { path: './', type: 'dir', mode: 0o755 },
    { path: './control', type: 'file', mode: 0o644, data: Buffer.from(controlText([...spec.control, ['Installed-Size', String(size)]])) },
  ];
  for (const [name, body] of Object.entries(spec.scripts ?? {})) {
    if (body) control.push({ path: './' + name, type: 'file', mode: 0o755, data: Buffer.from(body) });
  }
  return writeAr(
    [
      { name: 'debian-binary', data: Buffer.from('2.0\n') },
      { name: 'control.tar.gz', data: writeTarGz(control, mtime) },
      { name: 'data.tar.gz', data: writeTarGz(data, mtime) },
    ],
    mtime,
  );
}
```

When this plan was written, `dpkg-deb -I`, `-c`, `-x` and `-e` read a package from this code correctly, including a path longer than 100 characters.

- [ ] **Step 4: Write the application functions**

Create `maemo-react/packages/cli/src/png.ts`:

```ts
// A one-color PNG icon with round corners, for new applications.
import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}

export function iconPng(size: number, rgb: [number, number, number]): Buffer {
  const r = Math.round(size / 6);
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0, then RGBA
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x, x - (size - 1 - r), 0);
      const dy = Math.max(r - y, y - (size - 1 - r), 0);
      row.set([rgb[0], rgb[1], rgb[2], dx * dx + dy * dy <= r * r ? 255 : 0], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A color made from the application id, so each new application has its own. */
export function colorFor(id: string): [number, number, number] {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = (h % 360) / 60;
  const c = 0.55 * 255;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = 0.5 * 255 - c / 2;
  const [r, g, b] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round(r + m), Math.round(g + m), Math.round(b + m)];
}
```

Create `maemo-react/packages/cli/src/app.ts`:

```ts
// The application manifest (app.json) and the install paths on the tablet.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PREFIX = '/opt/n810-modern';
export const HOST = `${PREFIX}/bin/maemo-react-host`;
export const APPS = `${PREFIX}/share/maemo-react/apps`;
export const RUNTIME_DEPENDS = 'maemo-react-runtime (>= 0.1.0)';

export interface AppManifest {
  /** The Debian package name: a-z, 0-9, "+", "-" and ".". */
  id: string;
  /** The name in the menu. */
  name: string;
  version: string;
  description?: string;
  maintainer?: string;
  /** A PNG file, relative to the application folder. */
  icon?: string;
  deploy?: { host?: string; port?: number; user?: string };
}

export function readManifest(dir: string): AppManifest {
  const path = join(dir, 'app.json');
  let m: AppManifest;
  try {
    m = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read ${path}: ${(e as Error).message}`);
  }
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9+.-]+$/.test(m.id)) {
    throw new Error(`app.json: "id" must be a Debian package name (a-z, 0-9, + - .), not ${JSON.stringify(m.id)}`);
  }
  if (typeof m.name !== 'string' || m.name === '') throw new Error('app.json: "name" is missing');
  if (typeof m.version !== 'string' || !/^[0-9][A-Za-z0-9.+~-]*$/.test(m.version)) {
    throw new Error(`app.json: "version" must start with a digit, not ${JSON.stringify(m.version)}`);
  }
  return m;
}
```

Create `maemo-react/packages/cli/src/build.ts`:

```ts
// Bundle an application: src/main.tsx -> dist/app.js, an ES module for
// maemo-react-host with React inside and the maemo:* modules outside.
import { build } from 'esbuild';
import { join } from 'node:path';

export async function buildApp(dir: string): Promise<string> {
  const outfile = join(dir, 'dist', 'app.js');
  await build({
    entryPoints: [join(dir, 'src', 'main.tsx')],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    external: ['maemo:*'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    outfile,
    logLevel: 'warning',
  });
  return outfile;
}
```

Create `maemo-react/packages/cli/src/package.ts`:

```ts
// Make the .deb of an application from dist/app.js and app.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPS, HOST, RUNTIME_DEPENDS, readManifest, type AppManifest } from './app.js';
import { buildDeb } from './deb.js';
import { colorFor, iconPng } from './png.js';

export function desktopEntry(m: AppManifest): string {
  return [
    '[Desktop Entry]',
    'Encoding=UTF-8',
    'Version=1.0',
    `Name=${m.name}`,
    `Comment=${m.description ?? m.name}`,
    `Exec=${HOST} ${APPS}/${m.id}/app.js`,
    `Icon=${m.id}`,
    'Terminal=false',
    'Type=Application',
    '',
  ].join('\n');
}

export function postinst(id: string): string {
  return `#!/bin/sh
# postinst for ${id}, made by maemo-react. It is safe to run again.
set -e
# Compile the bytecode here, so it matches the QuickJS of the runtime.
${HOST} --compile ${APPS}/${id}/app.js || true
[ -x /usr/bin/gtk-update-icon-cache ] && \\
	/usr/bin/gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
exit 0
`;
}

export function postrm(id: string): string {
  return `#!/bin/sh
# postrm for ${id}, made by maemo-react.
set -e
if [ "$1" = remove ] || [ "$1" = purge ]; then
	rm -f ${APPS}/${id}/app.qbc
	rmdir ${APPS}/${id} 2>/dev/null || true
fi
[ -x /usr/bin/gtk-update-icon-cache ] && \\
	/usr/bin/gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
exit 0
`;
}

/** Make dist/<id>_<version>_all.deb. Returns its path. */
export function packageApp(dir: string): string {
  const m = readManifest(dir);
  const appJs = join(dir, 'dist', 'app.js');
  if (!existsSync(appJs)) throw new Error(`no ${appJs}: run "maemo-react build" first`);
  const icon = m.icon ? readFileSync(join(dir, m.icon)) : iconPng(64, colorFor(m.id));
  const deb = buildDeb({
    control: [
      ['Package', m.id],
      ['Version', m.version],
      ['Architecture', 'all'],
      ['Maintainer', m.maintainer ?? 'maemo-react application <nobody@example.invalid>'],
      ['Section', 'user/other'],
      ['Priority', 'optional'],
      ['Depends', RUNTIME_DEPENDS],
      ['Description', m.name + (m.description ? '\n' + m.description : '')],
    ],
    files: [
      { path: `${APPS}/${m.id}/app.js`, data: readFileSync(appJs) },
      { path: `/usr/share/applications/hildon/${m.id}.desktop`, data: Buffer.from(desktopEntry(m)) },
      ...[26, 40, 64].map((n) => ({ path: `/usr/share/icons/hicolor/${n}x${n}/hildon/${m.id}.png`, data: icon })),
    ],
    scripts: { postinst: postinst(m.id), postrm: postrm(m.id) },
  });
  const out = join(dir, 'dist', `${m.id}_${m.version}_all.deb`);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(out, deb);
  return out;
}
```

Create `maemo-react/packages/cli/src/deploy.ts`:

```ts
// Copy a .deb to the tablet over SSH and install it as root.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

export interface Target {
  host: string;
  port: number;
  user: string;
}

export type Runner = (cmd: string, args: string[]) => void;

const defaultRunner: Runner = (cmd, args) => {
  execFileSync(cmd, args, { stdio: 'inherit' });
};

export function deploy(deb: string, t: Target, run: Runner = defaultRunner): void {
  const ssh = ['-p', String(t.port), '-o', 'BatchMode=yes', `${t.user}@${t.host}`];
  const dir = '.maemo-react/incoming';
  run('ssh', [...ssh, `mkdir -p ${dir}`]);
  run('scp', ['-P', String(t.port), '-o', 'BatchMode=yes', deb, `${t.user}@${t.host}:${dir}/`]);
  // sudo gainroot needs R&D mode on the tablet; see the n810-modern README.
  run('ssh', [...ssh, `echo 'dpkg -i /home/${t.user}/${dir}/${basename(deb)}' | sudo gainroot`]);
}
```

Create `maemo-react/packages/cli/src/templates.ts`:

```ts
// The files of a new application.

export function templateFiles(id: string, name: string): Record<string, string> {
  return {
    'app.json': JSON.stringify({ id, name, version: '0.1.0', description: `${name}, made with maemo-react` }, null, 2) + '\n',
    'package.json':
      JSON.stringify(
        {
          name: id,
          version: '0.1.0',
          private: true,
          type: 'module',
          scripts: {
            build: 'maemo-react build',
            package: 'maemo-react package',
            deploy: 'maemo-react deploy',
            typecheck: 'tsc',
          },
          dependencies: {
            '@maemo-react/core': '^0.1.0',
            '@maemo-react/widgets': '^0.1.0',
            react: '19.3.0',
          },
          devDependencies: {
            '@maemo-react/cli': '^0.1.0',
            '@maemo-react/types': '^0.1.0',
            '@types/react': '19.3.0',
            typescript: '5.9.3',
          },
        },
        null,
        2,
      ) + '\n',
    'tsconfig.json':
      JSON.stringify(
        {
          compilerOptions: {
            target: 'es2020',
            module: 'esnext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            lib: ['es2023'],
            types: ['@maemo-react/types'],
          },
          include: ['src'],
        },
        null,
        2,
      ) + '\n',
    'src/main.tsx': `import { render } from '@maemo-react/core';
import { App } from './App.js';

render(<App />);
`,
    'src/App.tsx': `import { useState } from 'react';
import { Box, Button, Label, Window } from '@maemo-react/widgets';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <Window title=${JSON.stringify(name)}>
      <Box vertical spacing={8}>
        <Label>Hello from ${name.replace(/[{}<>]/g, '')}!</Label>
        <Label>{'Clicks: ' + count}</Label>
        <Button onClick={() => setCount(count + 1)}>Click me</Button>
      </Box>
    </Window>
  );
}
`,
  };
}
```

Create `maemo-react/packages/cli/src/create.ts`:

```ts
// maemo-react create: make a new application folder.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { iconPng, colorFor } from './png.js';
import { templateFiles } from './templates.js';

export function createApp(dir: string, id: string, name: string): void {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} is not empty`);
  if (!/^[a-z0-9][a-z0-9+.-]+$/.test(id)) throw new Error(`the id must be a Debian package name (a-z, 0-9, + - .), not ${id}`);
  for (const [path, text] of Object.entries(templateFiles(id, name))) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  writeFileSync(join(dir, 'icon.png'), iconPng(64, colorFor(id)));
}
```

Create `maemo-react/packages/cli/src/index.ts`:

```ts
// The maemo-react command line tool.
//   maemo-react create <dir> [--id <id>] [--name <name>]
//   maemo-react build
//   maemo-react package
//   maemo-react deploy [file.deb] [--host <host>] [--port <port>] [--user <user>]
import { basename } from 'node:path';
import { readManifest } from './app.js';
import { buildApp } from './build.js';
import { createApp } from './create.js';
import { deploy } from './deploy.js';
import { packageApp } from './package.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function usage(): never {
  console.error(`usage:
  maemo-react create <dir> [--id <id>] [--name <name>]
  maemo-react build
  maemo-react package
  maemo-react deploy [file.deb] [--host <host>] [--port <port>] [--user <user>]`);
  process.exit(2);
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  const cwd = process.cwd();
  switch (cmd) {
    case 'create': {
      const dir = args[0];
      if (!dir || dir.startsWith('--')) usage();
      const id = flag(args, '--id') ?? basename(dir).toLowerCase().replace(/[^a-z0-9+.-]/g, '-');
      createApp(dir, id, flag(args, '--name') ?? id);
      console.log(`created ${dir}. Next: cd ${dir} && npm install && npm run build`);
      return;
    }
    case 'build':
      console.log(await buildApp(cwd));
      return;
    case 'package':
      await buildApp(cwd);
      console.log(packageApp(cwd));
      return;
    case 'deploy': {
      const m = readManifest(cwd);
      let deb = args.find((a) => a.endsWith('.deb'));
      if (!deb) {
        await buildApp(cwd);
        deb = packageApp(cwd);
      }
      const host = flag(args, '--host') ?? m.deploy?.host;
      if (!host) throw new Error('give --host, or "deploy": { "host": ... } in app.json');
      deploy(deb, {
        host,
        port: Number(flag(args, '--port') ?? m.deploy?.port ?? 2222),
        user: flag(args, '--user') ?? m.deploy?.user ?? 'user',
      });
      return;
    }
    default:
      usage();
  }
}

main(process.argv.slice(2)).catch((e: Error) => {
  console.error('maemo-react: ' + e.message);
  process.exit(1);
});
```

- [ ] **Step 5: Run the tests, build the tool, type-check**

```bash
npx vitest run packages/cli
npm run build:cli
npm run typecheck
```

Expected: 13 CLI tests pass; `packages/cli/dist/cli.js` exists and is executable; `tsc` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add maemo-react/packages/cli maemo-react/package.json maemo-react/package-lock.json
git commit -m "Add the maemo-react command line tool

create, build, package and deploy. The tool writes .deb files itself
(ar, ustar, gzip), so packaging needs no Docker or dpkg-deb."
```

---

### Task 16: The runtime package, the examples, and the checks on the targets

**Files:**
- Create: `maemo-react/runtime/pkg/control`, `runtime/pkg/postinst`, `runtime/pkg/postrm`
- Modify: `maemo-react/runtime/Makefile` (a `deb` target)
- Create: `maemo-react/examples/hello/{app.json,package.json,tsconfig.json,src/main.tsx,src/App.tsx}`
- Create: `maemo-react/examples/bench/{app.json,package.json,tsconfig.json,src/main.tsx,src/App.tsx}`
- Create: `maemo-react/docs/benchmarks.md`
- Modify: `maemo-react/README.md` (the application workflow)

**Interfaces:**
- Consumes: everything before; `devhost/emulator-run.sh` (Task 3); the tablet (SSH on port 2222, R&D mode for `sudo gainroot`).
- Produces:
  - `runtime/build.sh diablo deb` → `runtime/dist/maemo-react-runtime_0.1.0_armel.deb` (`Depends: n810-modern-tls (>= 1.1), libgtk2.0-0, libhildon1`). Its `postinst` compiles the prelude and every installed application again.
  - `examples/hello`: fetches `https://api.github.com/repos/mitoyarzun/n810-modern` and shows the name, the description and the stars. With `--smoke` it prints `HELLO-SMOKE ok <full_name>` or `HELLO-SMOKE error <message>`, then quits after 2 s (with `--stay`, it stays).
  - `examples/bench`: the frame benchmark of spec section 11. It prints a line `BENCH {json}` for each mode; with `--auto` it runs both modes and quits.
  - `docs/benchmarks.md` with the tablet results of M1.

- [ ] **Step 1: Write the runtime package files**

Create `maemo-react/runtime/pkg/control`:

```
Package: maemo-react-runtime
Version: @VERSION@
Architecture: armel
Maintainer: maemo-react <maemo-react@users.noreply.github.com>
Section: libs
Priority: optional
Depends: n810-modern-tls (>= 1.1), libgtk2.0-0, libhildon1
Description: maemo-react runtime: React applications on GTK 2 and Hildon
 maemo-react-host runs applications that are made with maemo-react. It
 contains QuickJS, a GObject bridge, and fetch() over the TLS stack of
 n810-modern-tls.
```

Create `maemo-react/runtime/pkg/postinst`:

```sh
#!/bin/sh
# postinst for maemo-react-runtime. It is safe to run again.
set -e
H=/opt/n810-modern/bin/maemo-react-host
# Compile the prelude and every installed application again: the bytecode
# must match the QuickJS of this runtime.
$H --compile /opt/n810-modern/lib/maemo-react/prelude.js || true
for app in /opt/n810-modern/share/maemo-react/apps/*/app.js; do
	[ -f "$app" ] && $H --compile "$app" || true
done
exit 0
```

Create `maemo-react/runtime/pkg/postrm`:

```sh
#!/bin/sh
# postrm for maemo-react-runtime.
set -e
if [ "$1" = remove ] || [ "$1" = purge ]; then
	rm -f /opt/n810-modern/lib/maemo-react/prelude.qbc
	rmdir /opt/n810-modern/lib/maemo-react 2>/dev/null || true
fi
exit 0
```

In `runtime/Makefile`, add before `clean:`:

```make
MR_VERSION := $(shell sed -n 's/^\#define MR_VERSION "\(.*\)"/\1/p' src/mr.h)
DEB_ROOT   := $(BUILD)/deb
RUNTIME_DEB := dist/maemo-react-runtime_$(MR_VERSION)_armel.deb

deb: $(HOST) $(PRELUDE)
ifneq ($(TARGET),diablo)
	@echo "the runtime package is for TARGET=diablo"; exit 1
endif
	rm -rf $(DEB_ROOT)
	mkdir -p $(DEB_ROOT)/DEBIAN $(DEB_ROOT)/opt/n810-modern/bin \
	         $(DEB_ROOT)/opt/n810-modern/lib/maemo-react $(DEB_ROOT)/opt/n810-modern/share/maemo-react/apps
	$(STRIP) -o $(DEB_ROOT)/opt/n810-modern/bin/maemo-react-host $(HOST)
	cp $(PRELUDE) $(DEB_ROOT)/opt/n810-modern/lib/maemo-react/
	sed 's/@VERSION@/$(MR_VERSION)/' pkg/control > $(DEB_ROOT)/DEBIAN/control
	install -m 755 pkg/postinst pkg/postrm $(DEB_ROOT)/DEBIAN/
	mkdir -p dist
	dpkg-deb -Zgzip --root-owner-group --build $(DEB_ROOT) $(RUNTIME_DEB)
```

Change `.PHONY: all clean typegen` to `.PHONY: all clean typegen deb`, and add `runtime/dist/` to `maemo-react/.gitignore`. `$(STRIP)` comes from `tools/env.sh`.

Build it and look at it:

```bash
devhost/run.sh 'runtime/build.sh diablo deb && dpkg-deb -I runtime/dist/maemo-react-runtime_0.1.0_armel.deb && dpkg-deb -c runtime/dist/maemo-react-runtime_0.1.0_armel.deb'
```

Expected: the control fields above, and three files: `maemo-react-host`, `prelude.js`, and the empty `apps` folder.

- [ ] **Step 2: Write the hello example**

Create `maemo-react/examples/hello/app.json`:

```json
{
  "id": "maemo-react-hello",
  "name": "React Hello",
  "version": "0.1.0",
  "description": "Fetches JSON over HTTPS with maemo-react"
}
```

Create `maemo-react/examples/hello/package.json`:

```json
{
  "name": "maemo-react-hello",
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

Create `maemo-react/examples/hello/tsconfig.json`:

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

Create `maemo-react/examples/hello/src/main.tsx`:

```tsx
import { render } from '@maemo-react/core';
import { App } from './App.js';

render(<App />);
```

Create `maemo-react/examples/hello/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { args, quit } from 'maemo:app';
import { Box, Button, Label, Window } from '@maemo-react/widgets';

const SOURCE = 'https://api.github.com/repos/mitoyarzun/n810-modern';
const SMOKE = args.includes('--smoke');
const STAY = args.includes('--stay');

interface Repo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; repo: Repo; ms: number };

function describe(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  return e.message + (e.cause instanceof Error ? ': ' + e.cause.message : '');
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const t0 = performance.now();
    setState({ kind: 'loading' });
    fetch(SOURCE, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json() as Promise<Repo>;
      })
      .then((repo) => {
        if (live) setState({ kind: 'done', repo, ms: performance.now() - t0 });
      })
      .catch((e: unknown) => {
        if (live) setState({ kind: 'error', message: describe(e) });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!SMOKE || state.kind === 'loading') return;
    console.log(state.kind === 'done' ? 'HELLO-SMOKE ok ' + state.repo.full_name : 'HELLO-SMOKE error ' + state.message);
    if (!STAY) setTimeout(() => quit(0), 2000);
  }, [state]);

  return (
    <Window title="React Hello">
      <Box vertical spacing={8}>
        <Label>{'GET ' + SOURCE}</Label>
        {state.kind === 'loading' ? <Label>Loading…</Label> : null}
        {state.kind === 'error' ? <Label wrap>{'Error: ' + state.message}</Label> : null}
        {state.kind === 'done' ? (
          <Box vertical spacing={4}>
            <Label>{state.repo.full_name}</Label>
            <Label wrap>{state.repo.description ?? ''}</Label>
            <Label>{'Stars: ' + state.repo.stargazers_count + ' (in ' + Math.round(state.ms) + ' ms)'}</Label>
          </Box>
        ) : null}
        <Button onClick={() => setAttempt(attempt + 1)}>Reload</Button>
      </Box>
    </Window>
  );
}
```

- [ ] **Step 3: Write the bench example**

Create `maemo-react/examples/bench/app.json`:

```json
{
  "id": "maemo-react-bench",
  "name": "React Bench",
  "version": "0.1.0",
  "description": "The maemo-react frame benchmark"
}
```

Create `maemo-react/examples/bench/package.json`:

```json
{
  "name": "maemo-react-bench",
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

Create `maemo-react/examples/bench/tsconfig.json`:

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

Create `maemo-react/examples/bench/src/main.tsx`:

```tsx
import { render } from '@maemo-react/core';
import { App } from './App.js';

render(<App />);
```

Create `maemo-react/examples/bench/src/App.tsx`. It follows the benchmark rules of spec section 11: it starts after the first paint, makes one update every 50 ms from a timer, and measures from the click to the end of the paint:

```tsx
import { useEffect, useRef, useState } from 'react';
import { args, quit } from 'maemo:app';
import { call } from 'maemo:gobject';
import { bridgeTime, cpu, flushPaint } from 'maemo:debug';
import type { WidgetTarget } from '@maemo-react/types';
import { Box, Button, Label, ScrolledWindow, Window } from '@maemo-react/widgets';

type Mode = 'counter' | 'list';
const ROWS = 200;

function Counter({ n }: { n: number }) {
  return <Label>{'Count: ' + n}</Label>;
}

function List({ n }: { n: number }) {
  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push(
      <Box key={i} spacing={4}>
        <Label>{'Node !' + (0x1000 + i).toString(16)}</Label>
        <Label>{'heard ' + ((i * 7 + n) % 60) + ' min ago'}</Label>
      </Box>,
    );
  }
  return (
    <ScrolledWindow expand>
      <Box vertical spacing={2}>
        {rows}
      </Box>
    </ScrolledWindow>
  );
}

function stat(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 10) / 10;
  return { median: r(s[s.length >> 1]), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s[s.length - 1]) };
}

export function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [n, setN] = useState(0);
  const [report, setReport] = useState('Press a button. One update every 50 ms, timed from click to paint.');
  const step = useRef<WidgetTarget | null>(null);

  function run(m: Mode, count: number, then?: () => void) {
    setMode(m);
    setN(0);
    setTimeout(() => {
      flushPaint(); // the first paint of the new screen
      const total: number[] = [];
      const js: number[] = [];
      const gtk: number[] = [];
      const paint: number[] = [];
      let i = 0;
      const id = setInterval(() => {
        bridgeTime();
        const t0 = performance.now();
        call(step.current!.handle, 'button.clicked'); // renders before it returns
        const t1 = performance.now();
        const g = bridgeTime();
        flushPaint();
        const t2 = performance.now();
        total.push(t2 - t0);
        js.push(t1 - t0 - g);
        gtk.push(g);
        paint.push(t2 - t1);
        if (++i < count) return;
        clearInterval(id);
        const result = { mode: m, n: count, cpu: cpu(), total: stat(total), js: stat(js), gtk: stat(gtk), paint: stat(paint) };
        console.log('BENCH ' + JSON.stringify(result));
        setReport(
          `${m}: click to paint ${result.total.median} ms median ` +
            `(JS ${result.js.median}, GTK ${result.gtk.median}, paint ${result.paint.median})`,
        );
        then?.();
      }, 50);
    }, 500);
  }

  useEffect(() => {
    if (args.includes('--auto')) run('counter', 100, () => run('list', 10, () => quit(0)));
  }, []);

  return (
    <Window title="React Bench">
      <Box vertical spacing={6}>
        <Box spacing={6}>
          <Button onClick={() => run('counter', 100)}>Counter x100</Button>
          <Button onClick={() => run('list', 10)}>List of 200 x10</Button>
        </Box>
        <Label wrap>{report}</Label>
        <Button ref={step} onClick={() => setN((x) => x + 1)}>
          {'Step ' + n}
        </Button>
        {mode === 'counter' ? <Counter n={n} /> : null}
        {mode === 'list' ? <List n={n} /> : null}
      </Box>
    </Window>
  );
}
```

Add `"typecheck"` coverage for the examples to the root script: change it to `"tsc -p packages/types/test && tsc -p packages/cli && tsc -p examples/hello && tsc -p examples/bench"`.

- [ ] **Step 4: Build and package the examples, and type-check**

```bash
npm install
npm run build:cli
npm run typecheck
(cd examples/hello && npm run package)
(cd examples/bench && npm run package)
```

Expected: `tsc` prints nothing; `examples/hello/dist/maemo-react-hello_0.1.0_all.deb` and `examples/bench/dist/maemo-react-bench_0.1.0_all.deb` exist.

- [ ] **Step 5: Run hello under qemu-user, with the real internet**

```bash
devhost/run.sh 'export DISPLAY=:99; (Xvfb :99 >/dev/null 2>&1 &); sleep 1; MR_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt qemu-arm -L /work/sysroot-diablo -E LD_LIBRARY_PATH=/work/out/opt/n810-modern/lib -E MR_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt runtime/build/diablo/bin/maemo-react-host examples/hello/dist/app.js --smoke'
```

Expected: `HELLO-SMOKE ok mitoyarzun/n810-modern`. This is the whole Diablo stack (QuickJS, React, GTK 2.10, Hildon, curl 8.22, OpenSSL 3.5, TLS 1.3) on a real HTTPS server.

- [ ] **Step 6: Install and run in the emulator**

The emulator has no network, so here the check is the installation with Diablo's own dpkg 1.14, the start from the installed paths, and the error path of `fetch`:

```bash
devhost/run.sh 'cp examples/hello/dist/maemo-react-hello_0.1.0_all.deb runtime/dist/ && SHOT=docs/hello-emulator.png MR_DEBS="/work/rel-1.2/n810-modern-tls_1.1_armel.deb runtime/dist/maemo-react-runtime_0.1.0_armel.deb runtime/dist/maemo-react-hello_0.1.0_all.deb" devhost/emulator-run.sh runtime/test/emulator "/opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/maemo-react-hello/app.js --smoke --stay"'
```

Expected, after about 5 minutes: the three `dpkg -i` runs end with `Setting up ...` and no dependency errors; a line `HELLO-SMOKE error Failed to fetch: ...` (no network); `MR-END rc=0`. Open `docs/hello-emulator.png`: it shows the "React Hello" window with the error text. Send the screenshot to your human partner.

- [ ] **Step 7: Install and run on the tablet**

This step needs the tablet on the network, with the n810-modern SSH server and R&D mode. Ask your human partner to turn it on, and to give its address if it is not `<tablet-ip>`.

```bash
cd examples/hello
npx maemo-react deploy ../../runtime/dist/maemo-react-runtime_0.1.0_armel.deb --host <tablet-ip>
npm run deploy -- --host <tablet-ip>
ssh -p 2222 user@<tablet-ip> '. /etc/osso-af-init/af-defines.sh; DISPLAY=:0 /opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/maemo-react-hello/app.js --smoke'
```

Expected: both installs end with `Setting up ...`; then `HELLO-SMOKE ok mitoyarzun/n810-modern`, and the window shows the repository data on the tablet for 2 s. Then ask your human partner to open "React Hello" from the Extras menu and to press Reload. This meets the M1 condition of spec section 13.

- [ ] **Step 8: Run the benchmark on the tablet and record it**

```bash
cd examples/bench
npm run deploy -- --host <tablet-ip>
B='. /etc/osso-af-init/af-defines.sh; DISPLAY=:0 /opt/n810-modern/bin/maemo-react-host /opt/n810-modern/share/maemo-react/apps/maemo-react-bench/app.js --auto'
G=/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
ssh -p 2222 user@<tablet-ip> "$B" | grep '^BENCH'
ssh -p 2222 user@<tablet-ip> "echo 'echo performance > $G' | sudo gainroot; $B | grep '^BENCH'; echo 'echo ondemand > $G' | sudo gainroot"
```

Expected: four `BENCH` lines (counter and list, at `ondemand` and at `performance`). Create `maemo-react/docs/benchmarks.md` from this template. Write the date of the run in the heading, and copy the median and p95 values of the four `BENCH` lines into the empty table cells:

```markdown
# maemo-react benchmarks

Measured on a Nokia N810 (RX-44, Diablo-Turbo, n810-modern PREEMPT backport
kernel) with `examples/bench --auto`. One update every 50 ms from a timer,
timed from the click to the end of the paint (spec section 11).

## M1, measured on <the date of the run, YYYY-MM-DD>

| Test | Governor | Total median | Total p95 | JS median | GTK median | Paint median |
| --- | --- | --- | --- | --- | --- | --- |
| Counter x100 | ondemand | | | | | |
| Counter x100 | performance | | | | | |
| List of 200 x10 | ondemand | | | | | |
| List of 200 x10 | performance | | | | | |

The probe (spec appendix A) measured the counter at 12.6 ms (400 MHz) and
31.8 ms (165 MHz), and the list at 635 ms.
```

Compare the result with the probe. If the counter at `ondemand` is slower than 50 ms (the target in the spec's risk table), tell your human partner before you continue.

- [ ] **Step 9: Document the application workflow**

Add this section to `maemo-react/README.md`:

````markdown
## Make an application

```sh
npm run build:cli
npx maemo-react create ../my-app --id my-app --name "My App"
cd ../my-app && npm install
npm run typecheck
npm run deploy -- --host <tablet address>
```

The tablet needs `maemo-react-runtime` once:
`npx maemo-react deploy <path>/maemo-react-runtime_0.1.0_armel.deb --host <tablet address>`.
Deploy uses SSH on port 2222 and `sudo gainroot`, so the tablet must be in
R&D mode. The application appears in the Extras menu.

See `examples/hello` (fetch over HTTPS) and `examples/bench` (the frame
benchmark). `docs/benchmarks.md` has the results from a real N810.
````

- [ ] **Step 10: Commit**

```bash
git add maemo-react/runtime/pkg maemo-react/runtime/Makefile maemo-react/.gitignore maemo-react/examples maemo-react/docs maemo-react/README.md maemo-react/package.json maemo-react/package-lock.json
git commit -m "Add the runtime package, hello and bench, and the M1 results

The runtime installs as maemo-react-runtime. The hello example fetches
JSON over HTTPS on the N810, and the bench example records the frame
times in docs/benchmarks.md."
```
