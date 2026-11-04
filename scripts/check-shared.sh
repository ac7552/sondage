#!/usr/bin/env bash
# Fails if the copies of shared/ in the two apps have drifted from the originals.
# Run scripts/sync-shared.sh to fix. Used by CI.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
status=0
for f in chain.js recorder.js transfer.js call.js timeline.js; do
  for copy in "desktop/src/shared/$f" "web/public/sondage/$f"; do
    if ! cmp -s "$root/shared/$f" "$root/$copy"; then
      echo "Out of date: $copy differs from shared/$f"
      status=1
    fi
  done
done
if ! cmp -s "$root/web/app/assets/stylesheets/timeline.css" "$root/desktop/src/renderer/timeline.css"; then
  echo "Out of date: desktop/src/renderer/timeline.css differs from web/app/assets/stylesheets/timeline.css"
  status=1
fi
[ $status -eq 0 ] && echo "Shared copies match." || echo "Run scripts/sync-shared.sh, then commit."
exit $status
