#!/usr/bin/env bash
# Copies the shared recorder, transfer and hash-chain code into both apps.
# Edit files in shared/, then run this.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/desktop/src/shared" "$root/web/public/sondage"
for f in chain.js recorder.js transfer.js call.js timeline.js; do
  cp "$root/shared/$f" "$root/desktop/src/shared/$f"
  cp "$root/shared/$f" "$root/web/public/sondage/$f"
done
cp "$root/web/app/assets/stylesheets/timeline.css" "$root/desktop/src/renderer/timeline.css"
echo "Shared code synced."
