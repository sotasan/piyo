#!/usr/bin/env bash
#
# Builds the bundled zmx session multiplexer from the vendor/zmx submodule
# using the Zig toolchain pinned in mise.toml. Output: Resources/bin/zmx.
#
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="vendor/zmx"
OUT="Resources/bin"

if [ ! -e "$SRC/build.zig" ]; then
    echo "[build-zmx] submodule missing — run: git submodule update --init $SRC"
    exit 1
fi

echo "[build-zmx] building zmx with zig $(zig version)…"
( cd "$SRC" && zig build -Doptimize=ReleaseFast )

mkdir -p "$OUT"
cp "$SRC/zig-out/bin/zmx" "$OUT/zmx"
echo "[build-zmx] -> $OUT/zmx ($("$OUT/zmx" version 2>/dev/null || echo ok))"
