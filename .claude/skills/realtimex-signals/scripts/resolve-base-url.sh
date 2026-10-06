#!/usr/bin/env bash
set -euo pipefail

# Resolve the Signals Local App base URL. Prints the URL on stdout and nothing else;
# diagnostics go to stderr. Exits 1 when no instance qualifies.
#
# 1. SIGNALS_BASE_URL (explicit): accepted when /api/health reports app=signals, whatever the
#    instance kind. This is the only way to reach a Dev app.
# 2. Fallback probe: ports RTX_PORT, PORT, then 3010, each on localhost and 127.0.0.1 (never
#    3000). A candidate is accepted only when /api/health reports app=signals, rtx.mode=embedded
#    and an instance that is not a Dev app: either no `instance` field (older builds, such as the
#    deployed 0.2.20) or instance.kind=canonical. A Dev app (instance.kind=dev), any other kind,
#    and a standalone Signals are skipped with a message.
#
# Reading /api/health needs `node` (the skill's CLI bootstrap already requires it; RealTimeX
# terminals provide it). Without node, the explicit path falls back to a text match and the
# fallback probe accepts nothing, because it cannot tell a Dev app from the canonical one.
#
# TEST-ONLY: SIGNALS_RESOLVER_TEST_FALLBACK_PORTS replaces the fixed fallback port list (3010)
# with space- or comma-separated ports so tests can point the probe at fake servers. It is not a
# configuration knob: it only changes which fixed ports are probed, never the identity check.
# To reach a specific instance, set SIGNALS_BASE_URL.

DEFAULT_FALLBACK_PORTS="3010"

# Prints one verdict for a health body: ok | dev | unknown-instance | not-embedded:<mode> |
# not-signals.
CLASSIFY_HEALTH_JS='
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
let health;
try {
  health = JSON.parse(process.argv[1] || "");
} catch {
  health = undefined;
}
let verdict;
if (!isObject(health) || health.app !== "signals") {
  verdict = "not-signals";
} else if (Object.prototype.hasOwnProperty.call(health, "instance")) {
  const kind = isObject(health.instance) ? health.instance.kind : undefined;
  verdict = kind === "dev" ? "dev" : kind === "canonical" ? "" : "unknown-instance";
}
if (!verdict) {
  const mode = isObject(health.rtx) ? health.rtx.mode : undefined;
  if (mode === "embedded") {
    verdict = "ok";
  } else {
    verdict = "not-embedded:" + (typeof mode === "string" && /^[a-z-]{1,32}$/.test(mode) ? mode : "unknown");
  }
}
process.stdout.write(verdict);
'

fetch_health() {
  curl -sS -m 2 "${1}/api/health" 2>/dev/null || true
}

# Echoes the verdict, or "unparsed" when node is unavailable or fails.
classify_health() {
  local verdict
  if verdict="$(node -e "$CLASSIFY_HEALTH_JS" "$1" 2>/dev/null)" && [[ -n "$verdict" ]]; then
    echo "$verdict"
  else
    echo "unparsed"
  fi
}

if [[ -n "${SIGNALS_BASE_URL:-}" ]]; then
  base="${SIGNALS_BASE_URL%/}"
  body="$(fetch_health "$base")"
  verdict="not-signals"
  if [[ -n "$body" ]]; then
    verdict="$(classify_health "$body")"
    if [[ "$verdict" == "unparsed" ]] &&
      grep -q '"app"[[:space:]]*:[[:space:]]*"signals"' <<<"$body"; then
      verdict="ok"
    fi
  fi
  if [[ "$verdict" != "not-signals" && "$verdict" != "unparsed" ]]; then
    echo "$base"
    exit 0
  fi
  echo "SIGNALS_BASE_URL is set but /api/health did not return app=signals: ${base}" >&2
  exit 1
fi

ports=()
add_port() {
  local port="$1"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] || return 0
  local existing
  for existing in ${ports[@]+"${ports[@]}"}; do
    [[ "$existing" == "$port" ]] && return 0
  done
  ports+=("$port")
}

[[ -n "${RTX_PORT:-}" ]] && add_port "$RTX_PORT"
[[ -n "${PORT:-}" ]] && add_port "$PORT"
fallback_ports="${SIGNALS_RESOLVER_TEST_FALLBACK_PORTS:-$DEFAULT_FALLBACK_PORTS}"
for port in ${fallback_ports//,/ }; do
  add_port "$port"
done

for port in ${ports[@]+"${ports[@]}"}; do
  for host in localhost 127.0.0.1; do
    base="http://${host}:${port}"
    body="$(fetch_health "$base")"
    [[ -n "$body" ]] || continue
    verdict="$(classify_health "$body")"
    case "$verdict" in
      ok)
        echo "$base"
        exit 0
        ;;
      dev)
        echo "Skipping ${base}: it is a Signals Dev app (instance.kind=dev), not the canonical Local App. If you meant to use this Dev app, set SIGNALS_BASE_URL=${base}." >&2
        ;;
      unknown-instance)
        echo "Skipping ${base}: /api/health reports an instance kind other than canonical. Set SIGNALS_BASE_URL to use it deliberately." >&2
        ;;
      not-embedded:*)
        echo "Skipping ${base}: Signals is not running as the embedded Local App (rtx.mode=${verdict#not-embedded:}). Set SIGNALS_BASE_URL to use it deliberately." >&2
        ;;
      unparsed)
        echo "Skipping ${base}: cannot read /api/health without node, so it cannot be verified as the canonical Local App. Set SIGNALS_BASE_URL to use it deliberately." >&2
        ;;
    esac
  done
done

echo "Could not find a running Signals instance (the canonical, embedded Local App) on ports: ${ports[*]-none}. Start the Local App, or set SIGNALS_BASE_URL." >&2
exit 1
