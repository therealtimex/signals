#!/usr/bin/env bash
# Stage and zip the com.realtimex.signals workspace-provision plugin for RTX install / marketplace publish.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC="${ROOT}/realtimex-plugin"
STAGING="${ROOT}/dist/realtimex-plugin-staging"
OUT="${1:-${ROOT}/dist/com.realtimex.signals-plugin.zip}"
RELEASE_MANIFEST="${ROOT}/marketplace/release-manifest.json"
VALIDATOR="${ROOT}/../../.claude/skills/realtimex-plugin-developer/scripts/validate-plugin.cjs"

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

echo "==> Copying workspace skills (excluding node_modules, .mjs)..."
mkdir -p "$STAGING/skills"
rsync -a --exclude node_modules --exclude '*.mjs' \
  "${ROOT}/.claude/skills/realtimex-signals/" "$STAGING/skills/realtimex-signals/"
rsync -a --exclude node_modules --exclude '*.mjs' \
  "${ROOT}/.claude/skills/signals-publish/" "$STAGING/skills/signals-publish/"

chmod +x "$STAGING/skills/realtimex-signals/scripts/"*.sh 2>/dev/null || true

if [[ -f "$STAGING/skills/realtimex-signals/SKILL.md" ]]; then
  perl -pi -e 's|\.claude/skills/realtimex-signals|skills/realtimex-signals|g' \
    "$STAGING/skills/realtimex-signals/SKILL.md"
fi

cp "$RELEASE_MANIFEST" "$STAGING/marketplace/release-manifest.json"

if [[ -f "$VALIDATOR" ]]; then
  echo "==> Running RealtimeX plugin validator on staging directory..."
  node "$VALIDATOR" "$STAGING"
else
  echo "Warning: validate-plugin.cjs not found at ${VALIDATOR}; skipping official validator" >&2
fi

rm -f "$OUT"
(
  cd "$STAGING"
  zip -rq "$OUT" .
)

echo "Wrote ${OUT}"
echo "Install: realtimex-pp-cli install-plugin <zip>  (or RTX Admin → Plugins → Upload)"
