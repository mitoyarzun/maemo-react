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
need "desktop libcurl 8.22 with WebSocket" sh -c 'curl-config --protocols | grep -q WSS'
need "emulator kernel"           sh -c 'ls /work/emulator/unpacked/kernel_* >/dev/null'
need "emulator stock root fs"    test -d /work/emulator/rootfs.clean
need "emulator stock initfs"     test -f /work/emulator/stock-initfs.jffs2
exit $fail
