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
# The source changes with the same size and time, so a used cache would print
# the old text, and only a rejected cache prints the new text.
printf 'X' | dd of="$T/app.qbc" bs=1 seek=8 conv=notrunc status=none
cp -p "$T/app.js" "$T/app.js.orig"
sed -i 's/version ONE/version TWO/' "$T/app.js"
touch -r "$T/app.js.orig" "$T/app.js"
out=$($HOST_RUN "$T/app.js" 2>&1)
[ "$out" = "version TWO" ] || fail "a cache with a wrong version was used: $out"

# A cut cache file is ignored.
$HOST_RUN "$T/app.js" >/dev/null 2>&1
truncate -s 60 "$T/app.qbc"
out=$($HOST_RUN "$T/app.js" 2>&1)
[ "$out" = "version TWO" ] || fail "a cut cache broke the run: $out"

# --compile writes the cache, and needs no display.
rm -f "$T/app.qbc"
env -u DISPLAY $HOST_RUN --compile "$T/app.js" >/dev/null || fail "--compile failed"
[ -s "$T/app.qbc" ] || fail "--compile wrote no app.qbc"

# A folder that the user cannot write: the run works, and writes no cache.
rm -f "$T/app.qbc"
chmod 555 "$T"
out=$(setpriv --reuid=65534 --regid=65534 --clear-groups $HOST_RUN "$T/app.js" 2>&1)
chmod 755 "$T"
[ "$out" = "version TWO" ] || fail "the run in a read-only folder failed: $out"
[ ! -e "$T/app.qbc" ] || fail "a cache was written in a read-only folder"
echo ok
