#!/usr/bin/env bash
# Build typegen for Diablo, run it under qemu-user on the tablet's GTK 2.10
# and Hildon 2.0, and write packages/types/generated/gtk.json. Run it in the
# dev container: devhost/run.sh typegen/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
CLASSES="HildonWindow GtkWindow GtkVBox GtkHBox GtkLabel GtkButton GtkEntry GtkScrolledWindow
         GtkTreeView GtkTextView GtkImage GtkCheckButton GtkToggleButton GtkHScale GtkVScale
         GtkComboBox GtkProgressBar GtkMenu GtkMenuItem GtkSeparatorMenuItem"
runtime/build.sh diablo typegen
export DISPLAY=:99
pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 800x480x16 >/dev/null 2>&1 & sleep 1; }
OUT=packages/types/generated/gtk.json
trap 'rm -f "$OUT.tmp"' EXIT
mkdir -p "$(dirname "$OUT")"
# shellcheck disable=SC2086  # CLASSES is a list of words
qemu-arm -L /work/sysroot-diablo runtime/build/diablo/bin/typegen $CLASSES > "$OUT.tmp"
python3 -c "import json, sys; d = json.load(open(sys.argv[1])); assert d['gtk'].startswith('2.10.'), d['gtk']" "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "wrote $OUT ($(wc -c < "$OUT") bytes, GTK $(python3 -c "import json; print(json.load(open('$OUT'))['gtk'])"))"
