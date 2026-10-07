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
