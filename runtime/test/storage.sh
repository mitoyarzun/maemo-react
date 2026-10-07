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

# A top-level throw: the items set before it must reach the file.
rm -rf "$D/storage-sh"
$HOST_RUN --test test/storage/throw.js > /dev/null 2>&1 && { echo "throw.js did not fail"; exit 1; }
out=$($HOST_RUN --test test/storage/read.js 2>&1) || { echo "read after throw failed: $out"; exit 1; }
[ "$(stat -c %a "$F")" = 600 ] || { echo "the mode after throw is not 600"; exit 1; }

# A symbolic link in the place of the temporary file is not followed.
echo victim > "$D/victim"
ln -s "$D/victim" "$F.tmp"
$HOST_RUN --test test/storage/write.js > /dev/null 2>&1
[ "$(cat "$D/victim")" = victim ] || { echo "the write followed the link of the temporary file"; exit 1; }
rm -f "$F.tmp"

# An unsafe MR_APP_ID gives a safe id; the data folder stays inside MR_DATA_DIR.
out=$(MR_APP_ID=../x $HOST_RUN --test test/storage/id.js 2>&1) || { echo "id check failed: $out"; exit 1; }
out=$(MR_APP_ID= $HOST_RUN --test test/storage/id.js 2>&1) || { echo "empty id check failed: $out"; exit 1; }
# A relative path to the module still gives the base name.
out=$(cd test/storage && MR_APP_ID= $HOST_RUN --test id.js 2>&1) || { echo "relative id failed: $out"; exit 1; }
rm -rf "$D"
