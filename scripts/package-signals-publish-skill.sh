#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${ROOT}/.claude/skills/signals-publish"
OUT="${1:-/tmp/signals-publish.zip}"

if [[ ! -f "${SKILL_DIR}/SKILL.md" ]]; then
  echo "Skill not found at ${SKILL_DIR}" >&2
  exit 1
fi

chmod +x "${SKILL_DIR}"/scripts/*.cjs 2>/dev/null || true
rm -f "${OUT}"

(
  cd "${SKILL_DIR}"
  npm install --omit=dev --no-audit --no-fund
)

(
  cd "$(dirname "${SKILL_DIR}")"
  zip -r "${OUT}" "$(basename "${SKILL_DIR}")"
)

echo "Wrote ${OUT}"
echo "Upload: curl -X POST http://127.0.0.1:3101/api/workspace/signals/agent-skills \\"
echo "  -F zip_file=@${OUT} -F type=zip -F display_name='Signals Publish' -F name=signals-publish"
