#!/usr/bin/env bash
# Fail if a Diablo binary needs a glibc symbol newer than 2.5, or if its ABI
# tag is not 2.6.8. The tablet's loader refuses both (see tools/env.sh in n810-modern).
set -euo pipefail
BIN="$1"
vers=$(arm-linux-gnueabi-readelf -V "$BIN" | grep -o 'GLIBC_[0-9.]*' | sort -uV)
bad=$(echo "$vers" | awk -F_ '{ split($2, v, "."); if (v[1] > 2 || (v[1] == 2 && v[2] > 5)) print }')
[ -z "$bad" ] || { echo "$BIN needs $bad; the tablet has glibc 2.5"; exit 1; }
abi=$(arm-linux-gnueabi-readelf -n "$BIN" | awk '/OS: Linux, ABI:/ { print $NF }')
[ "$abi" = "2.6.8" ] || { echo "$BIN has ABI tag $abi; it must be 2.6.8"; exit 1; }
echo "$BIN: $(echo $vers | tr ' ' ','), ABI $abi: ok"
