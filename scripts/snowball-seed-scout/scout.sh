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
SIGNALS_BASE_URL="${SIGNALS_BASE_URL:-http://127.0.0.1:3010}"
PRODUCER_RUN_ID="scout-$(date -u +%Y%m%dT%H%M%SZ)-$$"

PLATFORM="$(scout_pick_platform "${CONFIG_JSON}")"
URLS="$(scout_extract_urls "${CONFIG_JSON}" "${PLATFORM}")"

if [[ -z "${URLS}" ]]; then
  echo "{\"queued\":0,\"platform\":\"${PLATFORM}\",\"candidates\":[],\"message\":\"no candidate URLs\"}"
  exit 0
fi

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "{\"queued\":0,\"platform\":\"${PLATFORM}\",\"dryRun\":true,\"candidates\":$(printf '%s\n' "${URLS}" | jq -R -s -c 'split("\n") | map(select(length>0))')}"
  exit 0
fi

RESULT="$(scout_enqueue_urls "${CONFIG_JSON}" "${URLS}" "${PLATFORM}" "${PRODUCER_RUN_ID}" "${SIGNALS_BASE_URL}")"
echo "${RESULT}"
