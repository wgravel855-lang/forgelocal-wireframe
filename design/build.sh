#!/usr/bin/env bash
# Rebuilds every .dc.html artboard from parts/*.body.html + the shared head/foot.
set -euo pipefail
cd "$(dirname "$0")"
for f in parts/*.body.html; do
  n="$(basename "$f" .body.html)"
  cat head.part "$f" foot.part > "$n.dc.html"
done
echo "built: $(ls -1 *.dc.html | tr '\n' ' ')"
