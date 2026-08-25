#!/usr/bin/env bash

scout_pick_platform() {
  local config_json="$1"
  python3 - <<'PY' "${config_json}"
import json, sys, hashlib, datetime
config = json.loads(sys.argv[1])
platforms = config.get("platforms") or ["x", "linkedin"]
if not platforms:
    platforms = ["x"]
seed = datetime.datetime.utcnow().strftime("%Y-%m-%d")
idx = int(hashlib.sha256(seed.encode()).hexdigest(), 16) % len(platforms)
print(platforms[idx])
PY
}

scout_start_browser() {
  local platform="$1"
  local session_name="signals-scout-${platform}"

  if command -v realtimex-pp-cli >/dev/null 2>&1; then
    realtimex-pp-cli browser-session start --name "${session_name}" >/dev/null 2>&1 || true
    realtimex-pp-cli browser-session list --json 2>/dev/null | python3 - <<'PY' "${session_name}"
import json, sys
name = sys.argv[1]
try:
    payload = json.load(sys.stdin)
except json.JSONDecodeError:
    print("")
    raise SystemExit(0)
sessions = payload.get("sessions") or payload.get("data") or []
for session in sessions:
    if session.get("name") == name:
        print(session.get("remoteDebugPort") or session.get("port") or "")
        break
PY
  fi
}

scout_stop_browser() {
  local platform="$1"
  local session_name="signals-scout-${platform}"
  if command -v realtimex-pp-cli >/dev/null 2>&1; then
    realtimex-pp-cli browser-session stop --name "${session_name}" >/dev/null 2>&1 || true
  fi
}
