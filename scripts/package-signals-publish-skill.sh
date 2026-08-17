#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${ROOT}/.claude/skills/signals-publish"
OUT="${1:-/tmp/signals-publish.zip}"

if [[ ! -f "${SKILL_DIR}/SKILL.md" ]]; then
  echo "Skill not found at ${SKILL_DIR}" >&2
  exit 1
fi

chmod +x "${SKILL_DIR}"/scripts/*.mjs 2>/dev/null || true
rm -f "${OUT}"

(
  cd "$(dirname "${SKILL_DIR}")"
  zip -r "${OUT}" "$(basename "${SKILL_DIR}")"
)

echo "Wrote ${OUT}"
