#!/usr/bin/env bash
set -euo pipefail

# Resolve the Signals Local App base URL (stdout only).
# Order: SIGNALS_BASE_URL → RTX_PORT/PORT → health probe on common ports.

probe_health() {
  local base="$1"
  local body
  body="$(curl -sS -m 2 "${base}/api/health" 2>/dev/null || true)"
  if [[ -n "$body" ]] && echo "$body" | grep -q '"app"[[:space:]]*:[[:space:]]*"signals"'; then
    echo "$base"
    return 0
  fi
  return 1
}

if [[ -n "${SIGNALS_BASE_URL:-}" ]]; then
  base="${SIGNALS_BASE_URL%/}"
  if probe_health "$base" >/dev/null; then
    echo "$base"
    exit 0
  fi
  echo "SIGNALS_BASE_URL is set but /api/health did not return app=signals: ${base}" >&2
  exit 1
fi

candidates=()
if [[ -n "${RTX_PORT:-}" ]]; then
  candidates+=("http://localhost:${RTX_PORT}")
fi
if [[ -n "${PORT:-}" ]]; then
  candidates+=("http://localhost:${PORT}")
fi
candidates+=(
  "http://localhost:3010"
  "http://localhost:3000"
  "http://127.0.0.1:3010"
  "http://127.0.0.1:3000"
)

seen=""
for base in "${candidates[@]}"; do
  [[ " $seen " == *" $base "* ]] && continue
  seen="$seen $base"
  if resolved="$(probe_health "$base")"; then
    echo "$resolved"
    exit 0
  fi
done

echo "Could not find a running Signals instance. Set SIGNALS_BASE_URL or start the Local App." >&2
exit 1
