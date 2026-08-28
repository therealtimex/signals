#!/usr/bin/env bash
# Bootstrap signals-pp-cli via health-pinned npx (preferred over stale global PATH).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${SIGNALS_BASE_URL:-}" ]]; then
  SIGNALS_BASE_URL="$("$SCRIPT_DIR/resolve-base-url.sh")"
fi
SIGNALS_BASE_URL="${SIGNALS_BASE_URL%/}"

health_json="$(curl -sf "$SIGNALS_BASE_URL/api/health")"
CLI_VERSION="$(node -e "const d=JSON.parse(process.argv[1]); if(!d.cliVersion){process.exit(2)} process.stdout.write(d.cliVersion)" "$health_json")"
CLI_PACKAGE="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(d.cliPackage||'@realtimex/signals-pp-cli')" "$health_json")"

exec npx --yes "${CLI_PACKAGE}@${CLI_VERSION}" "$@"
