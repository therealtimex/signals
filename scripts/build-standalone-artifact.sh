#!/usr/bin/env bash
# Build a native-platform Next.js standalone runtime for RealtimeX Marketplace.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
DIST="${ROOT}/dist"
HOST_TARGET="$(node -p "process.platform + '-' + process.arch")"
TARGET="${SIGNALS_ARTIFACT_TARGET:-${HOST_TARGET}}"
ARTIFACT_NAME="signals-${VERSION}-${TARGET}.tar.gz"
STAGING="${DIST}/standalone-staging-${TARGET}"
STANDALONE="${ROOT}/.next/standalone"

if [[ "$TARGET" != "$HOST_TARGET" ]]; then
  echo "Target ${TARGET} does not match native build host ${HOST_TARGET}" >&2
  echo "Build each artifact on its matching operating system and architecture." >&2
  exit 1
fi

SIGNALS_TARGET_TO_VALIDATE="$TARGET" node --input-type=module -e "
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync('realtimex-plugin/marketplace/local-app.manifest.json', 'utf8'));
const target = process.env.SIGNALS_TARGET_TO_VALIDATE;
if (!manifest.artifactContract?.supportedTargets?.includes(target)) {
  console.error('Unsupported marketplace target: ' + target);
  process.exit(1);
}
"

echo "==> Preparing database for standalone build..."
npm run db:migrate

echo "==> Building Next.js (standalone)..."
SIGNALS_BOOT_MIGRATIONS_DONE=1 npm run build

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

cp "${ROOT}/scripts/standalone-entry.mjs" "$STAGING/server.js"
cp "${STANDALONE}/server.js" "$STAGING/next-server.js"
cp "${STANDALONE}/package.json" "$STAGING/"
cp "${ROOT}/LICENSE" "$STAGING/"
mkdir -p "$STAGING/node_modules" "$STAGING/.next"
cp -R "${STANDALONE}/node_modules/." "$STAGING/node_modules/"
cp -R "${STANDALONE}/.next/." "$STAGING/.next/"

# Runtime content read directly from process.cwd().
cp -R "${ROOT}/guide" "$STAGING/guide"
mkdir -p "$STAGING/resources/migrations"
cp "${ROOT}/src/lib/db/migrations/"*.sql "$STAGING/resources/migrations/"
cp -R "${ROOT}/src/lib/db/migrations/meta" "$STAGING/resources/migrations/meta"

cp -R "${ROOT}/.next/static" "$STAGING/.next/static"
cp -R "${ROOT}/public" "$STAGING/public"

find "$STAGING" -type f -name '*.map' -delete
rm -f "${DIST}/${ARTIFACT_NAME}"
(
  cd "$STAGING"
  # tar is available on every supported GitHub runner. The marketplace
  # extracts the archive once, so compression has no steady-state runtime cost.
  tar -czf "${DIST}/${ARTIFACT_NAME}" .
)

node scripts/create-release-target-manifest.mjs "$TARGET" "${DIST}/${ARTIFACT_NAME}"

echo "Wrote ${DIST}/${ARTIFACT_NAME}"
echo "Updated marketplace/release-manifest.json for ${TARGET}"
