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
# Stop QEMU when the script ends for any reason, also after an error or Ctrl-C.
trap 'kill $QPID 2>/dev/null || true' EXIT

shot_done=0
for _ in $(seq 1 "$TIMEOUT"); do
  sleep 1
  if [ -n "${SHOT:-}" ] && [ $shot_done -eq 0 ] && grep -q '^MR-SHOT' "$LOG" 2>/dev/null; then
    rm -f /tmp/mr-shot.ppm # a stale file must not pass as the new screenshot
    echo "screendump /tmp/mr-shot.ppm" | socat - "UNIX-CONNECT:$MON" >/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s /tmp/mr-shot.ppm ] && break; sleep 1; done
    [ -s /tmp/mr-shot.ppm ] || { echo "no screenshot from QEMU"; exit 1; }
    sleep 1
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

# The serial console writes CR LF: remove the CR.
tr -d '\r' < "$LOG" | sed -n '/^MR-BEGIN/,/^MR-END/p'
rc=$(tr -d '\r' < "$LOG" | sed -n 's/^MR-END rc=//p')
[ -n "$rc" ] || { echo "the emulator did not reach MR-END in $TIMEOUT s"; exit 1; }
exit "$rc"
