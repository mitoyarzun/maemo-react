#!/usr/bin/env bash
# Run a command in the maemo-react dev container.
#
#   devhost/run.sh 'runtime/build.sh desktop'
#
# The container sees this repository at /repo, an n810-modern checkout at /n810
# (read-only; its tools/env.sh and tools/mk-sysroot.sh), and the n810-build
# volume at /work (the Diablo sysroot, the n810-modern curl build, the
# emulator). It starts in /repo. The image is built once from devhost/Dockerfile.
# Set N810_MODERN to the n810-modern checkout; the default is ../n810-modern.
# Set PORTS, for example PORTS='-p 127.0.0.1:5902:5902', to publish a port.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
N810_MODERN="${N810_MODERN:-$REPO/../n810-modern}"
IMAGE="${IMAGE:-maemo-react-dev}"
VOLUME="${VOLUME:-n810-build}"
PORTS="${PORTS:-}"

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
[ -f "$N810_MODERN/tools/env.sh" ] ||
  { echo "no n810-modern checkout at $N810_MODERN -- clone https://github.com/mitoyarzun/n810-modern there, or set N810_MODERN"; exit 1; }
N810_MODERN="$(cd "$N810_MODERN" && pwd)"
docker volume inspect "$VOLUME" >/dev/null 2>&1 ||
  { echo "no '$VOLUME' volume -- run tools/build-in-docker.sh in n810-modern first"; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
  docker build -q -t "$IMAGE" "$HERE" >/dev/null

TTY=""
[ -t 0 ] && [ -t 1 ] && TTY="-t"
# shellcheck disable=SC2086  # PORTS and TTY are empty or whole options
exec docker run --rm -i $TTY $PORTS \
  -v "$VOLUME:/work" -v "$REPO:/repo" -v "$N810_MODERN:/n810:ro" -w /repo \
  "$IMAGE" bash -c "$*"
