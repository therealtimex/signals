#!/usr/bin/env bash
set -euo pipefail

# Invoke a Signals agent tool.
# Usage:
#   invoke-tool.sh create_contact '{"name":"Alex","company":"Acme"}'
#   invoke-tool.sh query_contacts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

if [[ -x "${REPO_ROOT}/scripts/invoke-agent-tool.sh" ]]; then
  export SIGNALS_BASE_URL="${SIGNALS_BASE_URL:-$("${SCRIPT_DIR}/resolve-base-url.sh")}"
  exec "${REPO_ROOT}/scripts/invoke-agent-tool.sh" "$@"
fi

BASE_URL="${SIGNALS_BASE_URL:-$("${SCRIPT_DIR}/resolve-base-url.sh")}"
TOOL="${1:?tool name required}"
INPUT="${2:-"{}"}"

if [[ -n "${SIGNALS_AGENT_TOOL_TOKEN:-}" ]]; then
  curl -sS -X POST "${BASE_URL}/api/agent-tools/invoke" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${SIGNALS_AGENT_TOOL_TOKEN}" \
    -d "{\"tool\":\"${TOOL}\",\"input\":${INPUT}}"
else
  curl -sS -X POST "${BASE_URL}/api/agent-tools/invoke" \
    -H "Content-Type: application/json" \
    -d "{\"tool\":\"${TOOL}\",\"input\":${INPUT}}"
fi
