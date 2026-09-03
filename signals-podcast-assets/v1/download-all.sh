#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="${MANIFEST:-$DIR/podcast-manifest.json}"
TMP="${TMPDIR:-/tmp}/suno-podcast-wav-$$"
mkdir -p "$TMP"

if ! command -v suno-pp-cli >/dev/null 2>&1; then
  echo "suno-pp-cli not found" >&2
  exit 1
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "Missing manifest: $MANIFEST" >&2
  exit 1
fi

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "Refreshing Suno auth and syncing metadata…"
suno-pp-cli auth login --chrome --no-input 2>/dev/null || true
suno-pp-cli sync

echo "Downloading WAV masters (Suno Pro) to $DIR …"
fail=0
count=0
while IFS=$'\t' read -r id fname; do
  [[ -z "$id" ]] && continue
  count=$((count + 1))
  dest="$DIR/$fname"
  echo "  $fname"
  rm -f "$TMP"/*.wav
  if ! suno-pp-cli download "$id" --format wav --out "$TMP" --agent --no-input; then
    echo "    suno-pp-cli download failed for $id" >&2
    fail=1
    continue
  fi
  wav="$(find "$TMP" -maxdepth 1 -name '*.wav' -print -quit)"
  if [[ -z "$wav" || ! -s "$wav" ]]; then
    echo "    no wav written for $id" >&2
    fail=1
    continue
  fi
  mv -f "$wav" "$dest"
done < <(python3 - "$MANIFEST" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    for e in json.load(f):
        print(f"{e['id']}\t{e['suggested_filename']}")
PY
)

echo "Processed $count clip(s)."
if [[ "$fail" -ne 0 ]]; then
  echo "One or more downloads failed." >&2
  exit 4
fi

echo "Done."
ls -la "$DIR"/*.wav
