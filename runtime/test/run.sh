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

# A local HTTPS server for the http and fetch tests.
CERT=/tmp/mr-test-cert.pem
KEY=/tmp/mr-test-key.pem
[ -f "$CERT" ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout "$KEY" -out "$CERT" \
  -days 30 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 2>/dev/null
pgrep -f 'server/server.py 8443' >/dev/null || { python3 test/server/server.py 8443 "$CERT" "$KEY" >/tmp/mr-test-server.log 2>&1 & sleep 1; }
# The WebSocket test servers: wss on 8444, ws on 8445.
pgrep -f 'server/wsserver.py 8444' >/dev/null || { PYTHONPATH=test/server python3 test/server/wsserver.py 8444 "$CERT" "$KEY" >/tmp/mr-test-wsserver.log 2>&1 & sleep 1; }
pgrep -f 'server/wsserver.py 8445' >/dev/null || { PYTHONPATH=test/server python3 test/server/wsserver.py 8445 >/tmp/mr-test-wsserver-plain.log 2>&1 & sleep 1; }
export MR_CA_BUNDLE="$CERT"

if [ "$TARGET" = diablo ]; then
  HOST_RUN="qemu-arm -L /work/sysroot-diablo -E LD_LIBRARY_PATH=/work/out/opt/n810-modern/lib $PWD/$HOST"
else
  HOST_RUN="$PWD/$HOST"
fi
export HOST_RUN
# localStorage of the tests goes to a fresh folder, not to $HOME.
export MR_DATA_DIR=$(mktemp -d /tmp/mr-test-data.XXXXXX)
trap 'rm -rf "$MR_DATA_DIR"' EXIT

FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then
  FILES=(test/*.test.js test/generated/*.test.js test/*.sh test/expect-fail/*.js)
fi

fail=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  # The glob test/*.sh also matches this runner. Do not run it again.
  [ "$f" = test/run.sh ] && continue
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
