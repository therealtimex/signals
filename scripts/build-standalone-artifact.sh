#!/usr/bin/env bash
# Build Next.js standalone output and zip for RealtimeX marketplace local app artifact.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
DIST="${ROOT}/dist"
ARTIFACT_NAME="signals-${VERSION}-standalone.zip"
STAGING="${DIST}/standalone-staging"
STANDALONE="${ROOT}/.next/standalone"

cd "$ROOT"

echo "==> Building Next.js (standalone)..."
npm run build

if [[ ! -f "${STANDALONE}/server.js" ]]; then
  echo "Expected ${STANDALONE}/server.js after build. Is output: 'standalone' set in next.config.mjs?" >&2
  exit 1
fi

rm -rf "$STAGING"
mkdir -p "$STAGING"

echo "==> Staging standalone artifact..."
# Next's file tracer can conservatively copy repository source, tests, docs, and
# previous build output into .next/standalone. Stage an explicit runtime
# allowlist so release contents do not depend on whatever happened to exist in
# the build workspace.
for required in server.js package.json node_modules .next; do
  if [[ ! -e "${STANDALONE}/${required}" ]]; then
    echo "Expected ${STANDALONE}/${required} after build" >&2
    exit 1
  fi
done

cp "${STANDALONE}/server.js" "$STAGING/"
cp "${STANDALONE}/package.json" "$STAGING/"
cp "${ROOT}/LICENSE" "$STAGING/"
mkdir -p "$STAGING/node_modules" "$STAGING/.next"
cp -R "${STANDALONE}/node_modules/." "$STAGING/node_modules/"
cp -R "${STANDALONE}/.next/." "$STAGING/.next/"

# Runtime content read directly from process.cwd().
cp -R "${ROOT}/guide" "$STAGING/guide"
mkdir -p "$STAGING/src/lib/db/migrations"
cp "${ROOT}/src/lib/db/migrations/"*.sql "$STAGING/src/lib/db/migrations/"
cp -R "${ROOT}/src/lib/db/migrations/meta" "$STAGING/src/lib/db/migrations/meta"

cp -R "${ROOT}/.next/static" "$STAGING/.next/static"
cp -R "${ROOT}/public" "$STAGING/public"

rm -f "${DIST}/${ARTIFACT_NAME}"
(
  cd "$STAGING"
  # Source maps are useful during development but disclose source and are not
  # required by the production runtime.
  zip -rq "${DIST}/${ARTIFACT_NAME}" . -x '*.map'
)

SHA256="$(shasum -a 256 "${DIST}/${ARTIFACT_NAME}" | awk '{print $1}')"
MANIFEST="${ROOT}/marketplace/release-manifest.json"

node --input-type=module -e "
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('${ROOT}/package.json', 'utf8'));
const manifest = {
  signalsVersion: pkg.version,
  pluginVersion: pkg.version,
  pluginId: 'com.realtimex.signals',
  localAppId: '47e45f71-3279-42f5-8e95-731de01b6eae',
  artifactName: '${ARTIFACT_NAME}',
  artifactPath: 'dist/${ARTIFACT_NAME}',
  checksumSha256: '${SHA256}',
  minRealtimeXVersion: '1.0.0',
  permissions: JSON.parse(fs.readFileSync('${ROOT}/rtx-manifest.json', 'utf8')).permissions,
  platformDependency: 'https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/issues/1614',
  builtAt: new Date().toISOString(),
};
fs.mkdirSync('${ROOT}/marketplace', { recursive: true });
fs.writeFileSync('${MANIFEST}', JSON.stringify(manifest, null, 2) + '\n');
"

echo "Wrote ${DIST}/${ARTIFACT_NAME} (sha256: ${SHA256})"
echo "Updated ${MANIFEST}"
