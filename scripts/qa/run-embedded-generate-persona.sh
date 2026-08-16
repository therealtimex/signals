#!/usr/bin/env bash
set -euo pipefail

# Embedded-host QA for generate_persona (#64).
# Requires an owned RTX worktree dev session (rtxtest dev up) with llm.chat granted
# for the Signals Local App and a working chat provider on that host.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RTXTEST="${RTXTEST:-$ROOT/../../.claude/skills/rtx-test-runner/scripts/bin/rtxtest}"
RTX_REPO="${RTX_REPO:-$ROOT/../../worktrees/realtimex-ai-app-issue-64-sdk-llm-chat-provenance}"
SIGNALS_APP_ID="${RTX_APP_ID:-47e45f71-3279-42f5-8e95-731de01b6eae}"

resolve_server_url() {
  if [[ -n "${SERVER_URL:-}" ]]; then
    printf '%s\n' "$SERVER_URL"
    return
  fi
  local endpoints_file="$RTX_REPO/tmp/dev-runtime/endpoints.json"
  if [[ -f "$endpoints_file" ]]; then
    node -e "const fs=require('node:fs'); const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(j.endpoints?.serverUrl || '');" "$endpoints_file"
    return
  fi
  printf '%s\n' "http://127.0.0.1:3101"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/qa/run-embedded-generate-persona.sh [--prime-llm]

Options:
  --prime-llm   Persist LiteLLM virtual key from canonical dev sign-in, restart RTX dev, then run tests

Environment:
  RTX_REPO          RTX worktree with issue-64-sdk-llm-chat-provenance (default: sibling worktree)
  RTX_APP_ID        Signals Local App UUID (default: dev Signals app)
  SERVER_URL        RTX API base (default: read from RTX_REPO/tmp/dev-runtime/endpoints.json)
  SIGNALS_DATA_DIR  Optional isolated Signals DB directory for the run

Prerequisites:
  1. Canonical dev app signed in (main checkout yarn dev:all)
  2. RTXTEST_TARGET=local rtxtest dev up --repo "$RTX_REPO" --electron-no-sandbox
  3. Signals Local App has llm.chat (and llm.embed) granted
  4. Working chat provider on host (use --prime-llm or node "$RTX_REPO/scripts/qa/persist-embedded-llm-credentials.mjs")
EOF
  exit 0
fi

PRIME_LLM=false
if [[ "${1:-}" == "--prime-llm" ]]; then
  PRIME_LLM=true
fi

if [[ "$PRIME_LLM" == true ]]; then
  echo "Persisting LiteLLM credentials into worktree database..."
  node "$RTX_REPO/scripts/qa/persist-embedded-llm-credentials.mjs"
  echo "Restarting owned RTX dev session..."
  RTXTEST_TARGET=local node "$RTXTEST" dev down --repo "$RTX_REPO" || true
  RTXTEST_TARGET=local node "$RTXTEST" dev up --repo "$RTX_REPO" --electron-no-sandbox
fi

# Resolve SERVER_URL from the owned worktree endpoints file unless explicitly set.
unset SERVER_URL
SERVER_URL="$(resolve_server_url)"
if [[ -z "$SERVER_URL" ]]; then
  echo "Could not resolve SERVER_URL; start RTX dev or set SERVER_URL explicitly." >&2
  exit 1
fi

echo "RTX repo:      $RTX_REPO"
echo "SERVER_URL:    $SERVER_URL"
echo "RTX_APP_ID:    $SIGNALS_APP_ID"
echo "Signals repo:  $ROOT"

cd "$ROOT"
export SIGNALS_EMBEDDED_QA=1
export RTX_APP_ID="$SIGNALS_APP_ID"
export SERVER_URL

npx vitest run --project embedded src/lib/workflows/generate-persona.embedded.test.ts
