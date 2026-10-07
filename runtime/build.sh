#!/usr/bin/env bash
# Build maemo-react-host for one target. Run it in the dev container.
#   runtime/build.sh desktop   native, GTK 2.24, for development and tests
#   runtime/build.sh diablo    Maemo 4.1 on ARMv6, glibc 2.5
set -euo pipefail
MR_TARGET="${1:-desktop}"
shift || true
cd "$(dirname "$0")"
if [ "$MR_TARGET" = diablo ]; then
  # n810-modern's tools/env.sh (mounted at /n810) sets CC, CFLAGS and LDFLAGS for the sysroot, glibc 2.5 and
  # ARMv6. Its comments explain each flag. It also sets TARGET, so the
  # build target is in MR_TARGET.
  . /n810/tools/env.sh /work/sysroot-diablo >/dev/null
  export PKG_CONFIG_LIBDIR=/work/sysroot-diablo/usr/lib/pkgconfig:/work/sysroot-diablo/usr/share/pkgconfig
  export PKG_CONFIG_SYSROOT_DIR=/work/sysroot-diablo
fi
exec make -j"$(nproc)" TARGET="$MR_TARGET" "$@"
