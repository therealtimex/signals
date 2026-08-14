#!/usr/bin/env bash
set -euo pipefail

# Package realtimex-signals for RTX workspace upload (preserves script execute bits).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${ROOT}/.claude/skills/realtimex-signals"
OUT="${1:-/tmp/realtimex-signals.zip}"

if [[ ! -f "${SKILL_DIR}/SKILL.md" ]]; then
  echo "Skill not found at ${SKILL_DIR}" >&2
  exit 1
fi

chmod +x "${SKILL_DIR}"/scripts/*.sh 2>/dev/null || true
rm -f "${OUT}"

(
  cd "$(dirname "${SKILL_DIR}")"
  # zip stores Unix mode bits when source files are executable
  zip -r "${OUT}" "$(basename "${SKILL_DIR}")"
)

echo "Wrote ${OUT}"
echo "Upload: curl -X POST http://127.0.0.1:3101/api/workspace/signals/agent-skills \\"
echo "  -F zip_file=@${OUT} -F type=zip -F display_name='RealtimeX Signals' -F name=realtimex-signals"
