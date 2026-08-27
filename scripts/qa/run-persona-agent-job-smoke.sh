#!/usr/bin/env bash
set -euo pipefail

# Manual smoke test for PersonaAgentJob (#317):
#   prepare full per-contact prompt -> paste into fresh RTX agent session ->
#   verify/apply structured JSON response.
#
# This exercises the agent-path contract before PersonaAgentJob is wired into
# generatePersona. It does NOT call generate_persona or llm.chat.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TS_ENTRY="$ROOT/scripts/qa/persona-agent-job-smoke.ts"

usage() {
  cat <<'EOF'
Usage:
  scripts/qa/run-persona-agent-job-smoke.sh prepare --contact-id <id> [--out FILE]
  scripts/qa/run-persona-agent-job-smoke.sh verify --response FILE
  scripts/qa/run-persona-agent-job-smoke.sh apply --contact-id <id> --response FILE \\
    [--meta FILE | --prompt FILE] [--dry-run]

Environment:
  SIGNALS_BASE_URL           Signals API base (default: http://127.0.0.1:3000)
  SIGNALS_AGENT_TOOL_TOKEN   Bearer token when agent-tools API is not localhost-only

Examples:
  scripts/qa/run-persona-agent-job-smoke.sh prepare \\
    --contact-id CONTACT_ID \\
    --out /tmp/persona-agent-job.txt

  scripts/qa/run-persona-agent-job-smoke.sh verify --response /tmp/persona-response.json
  scripts/qa/run-persona-agent-job-smoke.sh apply \\
    --contact-id CONTACT_ID \\
    --response /tmp/persona-response.json \\
    --prompt /tmp/persona-agent-job.txt

Prerequisites:
  1. Signals running (standalone or Local App)
  2. Contact has sufficient persona evidence
  3. apply requires the prepare sidecar (.meta.json) from the same run
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" || "${1:-}" == "" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$TS_ENTRY" ]]; then
  echo "Missing entrypoint: $TS_ENTRY" >&2
  exit 1
fi

cd "$ROOT"
exec npx vite-node "$TS_ENTRY" "$@"
