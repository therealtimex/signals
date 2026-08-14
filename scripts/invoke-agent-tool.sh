#!/usr/bin/env bash
set -euo pipefail

# Invoke a Signals agent tool from shell / RTX runCommand nodes.
# Usage:
#   ./scripts/invoke-agent-tool.sh create_contact '{"name":"Alex","company":"Acme"}'
#   SIGNALS_BASE_URL=http://localhost:3010 ./scripts/invoke-agent-tool.sh query_contacts '{}'

BASE_URL="${SIGNALS_BASE_URL:-http://localhost:3010}"
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
