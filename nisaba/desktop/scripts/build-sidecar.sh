#!/usr/bin/env bash
# Compile the Node service into a single self-contained binary (via Bun) and
# place it where Tauri's externalBin expects it, so `build:bundled` can ship a
# .deb/.AppImage that needs no separate Node install.
#
# Requires Bun (https://bun.sh):  curl -fsSL https://bun.sh/install | bash
set -euo pipefail

cd "$(dirname "$0")/.."   # nisaba/desktop

if ! command -v bun >/dev/null; then
  echo "Error: bun not found. Install it: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
if ! command -v rustc >/dev/null; then
  echo "Error: rustc not found (needed to detect the target triple)." >&2
  exit 1
fi

TRIPLE="$(rustc -Vv | sed -n 's/^host: //p')"
OUT="src-tauri/binaries/nisaba-service-$TRIPLE"
mkdir -p src-tauri/binaries

echo "Compiling service → $OUT"
bun build ../service/src/main.js --compile --outfile "$OUT"
chmod +x "$OUT"
echo "Done. Now: npm run build:bundled"
