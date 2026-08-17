#!/usr/bin/env bash
# Stage and zip the com.realtimex.signals workspace-provision plugin for RTX install / marketplace publish.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC="${ROOT}/realtimex-plugin"
STAGING="${ROOT}/dist/realtimex-plugin-staging"
OUT="${1:-${ROOT}/dist/com.realtimex.signals-plugin.zip}"
RELEASE_MANIFEST="${ROOT}/marketplace/release-manifest.json"

resolve_validator() {
  if [[ -n "${REALTIMEX_PLUGIN_VALIDATOR:-}" && -f "${REALTIMEX_PLUGIN_VALIDATOR}" ]]; then
    return 0
  fi

  local candidate
  for candidate in \
    "${ROOT}/scripts/vendor/validate-plugin.cjs" \
    "${ROOT}/.claude/skills/realtimex-plugin-developer/scripts/validate-plugin.cjs"; do
    if [[ -f "$candidate" ]]; then
      REALTIMEX_PLUGIN_VALIDATOR="$candidate"
      return 0
    fi
  done

  local dir="$ROOT"
  while [[ "$dir" != "/" ]]; do
    candidate="${dir}/.claude/skills/realtimex-plugin-developer/scripts/validate-plugin.cjs"
    if [[ -f "$candidate" ]]; then
      REALTIMEX_PLUGIN_VALIDATOR="$candidate"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

if [[ ! -f "${PLUGIN_SRC}/realtimex.plugin.json" ]]; then
  echo "Missing ${PLUGIN_SRC}/realtimex.plugin.json" >&2
  exit 1
fi

if [[ ! -f "$RELEASE_MANIFEST" ]]; then
  echo "Missing ${RELEASE_MANIFEST}. Run: npm run build:standalone-artifact" >&2
  exit 1
fi

CHECKSUM="$(node -p "JSON.parse(require('fs').readFileSync('${RELEASE_MANIFEST}','utf8')).checksumSha256 || ''")"
if [[ -z "$CHECKSUM" ]]; then
  echo "release-manifest.json missing checksumSha256. Run: npm run build:standalone-artifact" >&2
  exit 1
fi

if ! resolve_validator; then
  echo "RealtimeX plugin validator not found." >&2
  echo "Set REALTIMEX_PLUGIN_VALIDATOR or vendor scripts/vendor/validate-plugin.cjs" >&2
  exit 1
fi

rm -rf "$STAGING"
mkdir -p "$STAGING"

echo "==> Copying plugin manifest, templates, marketplace specs..."
cp "${PLUGIN_SRC}/realtimex.plugin.json" "$STAGING/"
cp -R "${PLUGIN_SRC}/templates" "$STAGING/"
cp -R "${PLUGIN_SRC}/marketplace" "$STAGING/"

echo "==> Copying agent flows..."
mkdir -p "$STAGING/flows"
cp "${ROOT}/flows/signals-crm-agent-task.agent-flow.json" "$STAGING/flows/"
cp "${ROOT}/flows/signals-create-enrich-contact.agent-flow.json" "$STAGING/flows/"

echo "==> Copying workspace skills..."
mkdir -p "$STAGING/skills"
rsync -a --exclude node_modules --exclude '*.mjs' \
  "${ROOT}/.claude/skills/realtimex-signals/" "$STAGING/skills/realtimex-signals/"
rsync -a --exclude node_modules --exclude '*.mjs' \
  "${ROOT}/.claude/skills/signals-publish/" "$STAGING/skills/signals-publish/"

chmod +x "$STAGING/skills/realtimex-signals/scripts/"*.sh 2>/dev/null || true
chmod +x "$STAGING/skills/signals-publish/scripts/"*.cjs 2>/dev/null || true

if [[ -f "$STAGING/skills/realtimex-signals/SKILL.md" ]]; then
  perl -pi -e 's|\.claude/skills/realtimex-signals|skills/realtimex-signals|g' \
    "$STAGING/skills/realtimex-signals/SKILL.md"
fi

if [[ -f "$STAGING/skills/signals-publish/SKILL.md" ]]; then
  perl -pi -e 's|\.claude/skills/signals-publish|skills/signals-publish|g' \
    "$STAGING/skills/signals-publish/SKILL.md"
fi

echo "==> Installing signals-publish skill runtime dependencies..."
(
  cd "$STAGING/skills/signals-publish"
  npm install --omit=dev --no-audit --no-fund --no-bin-links
  rm -rf node_modules/.bin 2>/dev/null || true
)

cp "$RELEASE_MANIFEST" "$STAGING/marketplace/release-manifest.json"

echo "==> Running RealtimeX plugin validator on staging directory..."
node "$REALTIMEX_PLUGIN_VALIDATOR" "$STAGING"

rm -f "$OUT"
(
  cd "$STAGING"
  zip -rq "$OUT" .
)

echo "Wrote ${OUT}"
echo "Install: realtimex-pp-cli install-plugin <zip>  (or RTX Admin → Plugins → Upload)"
