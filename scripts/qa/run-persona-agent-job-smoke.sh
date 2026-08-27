#!/usr/bin/env bash
set -euo pipefail

# Manual smoke test for PersonaAgentJob (#317):
#   prepare full per-contact prompt -> paste into fresh RTX agent session ->
#   verify/apply structured JSON response.
#
# This exercises the agent-path contract before PersonaAgentJob is wired into
# generatePersona. It does NOT call generate_persona or llm.chat.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_HELPER="$ROOT/scripts/qa/persona-agent-job-smoke.mjs"

usage() {
  cat <<'EOF'
Usage:
  scripts/qa/run-persona-agent-job-smoke.sh prepare --contact-id <id> [--out FILE]
  scripts/qa/run-persona-agent-job-smoke.sh verify --response FILE
  scripts/qa/run-persona-agent-job-smoke.sh apply --contact-id <id> --response FILE [--dry-run]

Environment:
  SIGNALS_BASE_URL           Signals API base (default: http://127.0.0.1:3000)
  SIGNALS_AGENT_TOOL_TOKEN   Bearer token when agent-tools API is not localhost-only

Examples:
  # Build prompt from live evidence
  scripts/qa/run-persona-agent-job-smoke.sh prepare \
    --contact-id CONTACT_ID \
    --out /tmp/persona-agent-job.txt

  # Paste /tmp/persona-agent-job.txt into a fresh RTX terminal-agent session.
  # Save JSON-only agent output to /tmp/persona-response.json

  scripts/qa/run-persona-agent-job-smoke.sh verify --response /tmp/persona-response.json
  scripts/qa/run-persona-agent-job-smoke.sh apply \
    --contact-id CONTACT_ID \
    --response /tmp/persona-response.json

Prerequisites:
  1. Signals running (standalone or Local App)
  2. Contact has sufficient persona evidence (platform identity, content, or interactions)
  3. For apply: shared-scope persona allowed (no active local_only persona)

Notes:
  - Use a fresh agent session per contact to avoid context bleed.
  - Do not call generate_persona during this smoke; that is the structured llm.chat path.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" || "${1:-}" == "" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$NODE_HELPER" ]]; then
  echo "Missing helper: $NODE_HELPER" >&2
  exit 1
fi

exec node "$NODE_HELPER" "$@"
