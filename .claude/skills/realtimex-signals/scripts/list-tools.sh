#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="$("${SCRIPT_DIR}/resolve-base-url.sh")"

if [[ -n "${SIGNALS_AGENT_TOOL_TOKEN:-}" ]]; then
  curl -sS "${BASE_URL}/api/agent-tools" \
    -H "Authorization: Bearer ${SIGNALS_AGENT_TOOL_TOKEN}"
else
  curl -sS "${BASE_URL}/api/agent-tools"
fi
