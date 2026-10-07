#!/usr/bin/env bash
# The host must explain a missing display, and exit with code 1.
# HOST_RUN is set by test/run.sh: the command that starts the host.
set -uo pipefail
out=$(env -u DISPLAY $HOST_RUN test/app.test.js 2>&1); rc=$?
[ $rc -eq 1 ] || { echo "expected exit 1, got $rc: $out"; exit 1; }
echo "$out" | grep -q 'cannot open the display' || { echo "no message: $out"; exit 1; }
