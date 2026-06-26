#!/usr/bin/env bash
#
# Generates the AppIcon PNG sizes from the master assets/icon.icns into the
# asset catalog. The PNGs are gitignored (derived), so this regenerates them.
#
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="assets/icon.icns"
OUT="apps/desktop/Sources/Assets.xcassets/AppIcon.appiconset"
TMP="$(mktemp -d)/AppIcon.iconset"

iconutil -c iconset "$SRC" -o "$TMP"
cp "$TMP"/*.png "$OUT/"
rm -rf "$(dirname "$TMP")"

echo "[build-icon] -> $OUT"
