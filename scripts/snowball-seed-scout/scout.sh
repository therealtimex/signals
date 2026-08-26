#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/browser.sh
source "${ROOT_DIR}/lib/browser.sh"
# shellcheck source=lib/extract.sh
source "${ROOT_DIR}/lib/extract.sh"
# shellcheck source=lib/enqueue.sh
source "${ROOT_DIR}/lib/enqueue.sh"

CONFIG_PATH="${ROOT_DIR}/scout.json"
DRY_RUN=0

for arg in "$@"; do
  case "${arg}" in
    --dry-run)
      DRY_RUN=1
      ;;
  esac
done

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "{\"error\":\"scout.json not found — deploy Snowball Seed Scout from Signals first\"}" >&2
  exit 1
fi

CONFIG_JSON="$(cat "${CONFIG_PATH}")"
# Deploy records the Local App origin in scout.json: RealTimeX assigns Local App
# ports dynamically and this shell is workspace-scoped, so it cannot inherit one.
SIGNALS_BASE_URL="$(python3 "${ROOT_DIR}/lib/resolve.py" signals-base-url "${CONFIG_JSON}" "${SIGNALS_BASE_URL:-}")"
export SIGNALS_BASE_URL
PRODUCER_RUN_ID="scout-$(date -u +%Y%m%dT%H%M%SZ)-$$"

PLATFORM="$(scout_pick_platform "${CONFIG_JSON}")"

if [[ -z "${PLATFORM}" ]]; then
  DRY_RUN_FLAG="false"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    DRY_RUN_FLAG="true"
  fi
  echo "{\"queued\":0,\"platform\":null,\"dryRun\":${DRY_RUN_FLAG},\"candidates\":[],\"message\":\"no eligible platforms — configure harvest targets for at least one enabled platform\"}"
  exit 0
fi

URLS="$(scout_extract_urls "${CONFIG_JSON}" "${PLATFORM}")"

if [[ -z "${URLS}" ]]; then
  DRY_RUN_FLAG="false"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    DRY_RUN_FLAG="true"
  fi
  echo "{\"queued\":0,\"platform\":\"${PLATFORM}\",\"dryRun\":${DRY_RUN_FLAG},\"candidates\":[],\"message\":\"no post URLs harvested — navigation pages are not queued as Snowball seeds\"}"
  exit 0
fi

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "{\"queued\":0,\"platform\":\"${PLATFORM}\",\"dryRun\":true,\"candidates\":$(printf '%s\n' "${URLS}" | jq -R -s -c 'split("\n") | map(select(length>0))')}"
  exit 0
fi

# enqueue.sh prints its error JSON to stdout before exiting non-zero. Capture it
# in the `if` condition (where `set -e` is suspended) so the diagnostic survives
# instead of being swallowed by the failing assignment.
RESULT=""
if ! RESULT="$(scout_enqueue_urls "${CONFIG_JSON}" "${URLS}" "${PLATFORM}" "${PRODUCER_RUN_ID}" "${SIGNALS_BASE_URL}")"; then
  if [[ -n "${RESULT}" ]]; then
    echo "${RESULT}" >&2
  else
    echo "{\"error\":\"enqueue failed\",\"platform\":\"${PLATFORM}\",\"queued\":0}" >&2
  fi
  exit 1
fi

# Partial failures are reported, not retried. Signals posts to /api/calendar-events,
# which does NOT apply the queueMeta.dedupeKey check, so exiting nonzero here would
# have the heartbeat re-run the whole batch and duplicate the seeds that succeeded.
# Surface the detail on stderr instead; a total failure already exits 1 above.
FAILED_COUNT="$(printf '%s' "${RESULT}" | python3 -c '
import json, sys
try:
    print(int(json.load(sys.stdin).get("failed") or 0))
except Exception:
    print(0)
' 2>/dev/null || echo 0)"

# Deduped seeds are the expected steady state once a feed stops producing new
# posts, so report them without treating the run as degraded.
DEDUPED_COUNT="$(printf '%s' "${RESULT}" | python3 -c '
import json, sys
try:
    print(int(json.load(sys.stdin).get("deduped") or 0))
except Exception:
    print(0)
' 2>/dev/null || echo 0)"

if [[ "${DEDUPED_COUNT}" != "0" ]]; then
  echo "snowball-seed-scout: ${DEDUPED_COUNT} seed(s) already queued, skipped" >&2
fi

# Seeds left unattempted because the batch ran out of time. They were never
# claimed, so the next tick picks them up untouched.
DEFERRED_COUNT="$(printf '%s' "${RESULT}" | python3 -c '
import json, sys
try:
    print(int(json.load(sys.stdin).get("deferred") or 0))
except Exception:
    print(0)
' 2>/dev/null || echo 0)"

if [[ "${DEFERRED_COUNT}" != "0" ]]; then
  echo "snowball-seed-scout: ${DEFERRED_COUNT} seed(s) deferred to the next run (batch budget)" >&2
fi

if [[ "${FAILED_COUNT}" != "0" ]]; then
  echo "snowball-seed-scout: ${FAILED_COUNT} seed(s) failed to enqueue: ${RESULT}" >&2
fi

echo "${RESULT}"
