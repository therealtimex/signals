#!/usr/bin/env bash

scout_pick_platform() {
  local config_json="$1"
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  python3 "${lib_dir}/resolve.py" pick-platform "${config_json}"
}

scout_pp_cli_json() {
  realtimex-pp-cli "$@" --agent --data-source live --no-cache --json 2>/dev/null
}

scout_parse_browser_port() {
  local session_name="${1:-}"
  python3 -c '
import json
import sys

session_name = sys.argv[1] if len(sys.argv) > 1 else ""

try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    raise SystemExit(0)

results = data.get("results") or data

def port_from_session(session):
    if not isinstance(session, dict):
        return ""
    port = session.get("remoteDebugPort") or session.get("port")
    if not port:
        # Some RTX responses nest the live port under the session runtime.
        runtime = session.get("runtime")
        if isinstance(runtime, dict):
            port = runtime.get("remoteDebugPort") or runtime.get("port")
    return str(port or "")

for key in ("runtime", "session"):
    port = port_from_session(results.get(key))
    if port:
        print(port)
        raise SystemExit(0)

sessions = results.get("sessions") or []
for session in sessions:
    name = session.get("sessionName") or session.get("name") or ""
    if session_name and name != session_name:
        continue
    port = port_from_session(session)
    if port:
        print(port)
        break
' "${session_name}"
}

scout_browser_running() {
  local session_name="$1"
  scout_pp_cli_json list-browser-sessions \
    | python3 -c '
import json
import sys

name = sys.argv[1]
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    raise SystemExit(1)

results = data.get("results") or data
for session in results.get("sessions") or []:
    session_name = session.get("sessionName") or session.get("name") or ""
    if session_name == name:
        print("1" if session.get("running") else "0")
        raise SystemExit(0)
raise SystemExit(1)
' "${session_name}"
}

scout_resolve_session_name() {
  local config_json="$1"
  local lib_dir="$2"
  local signals_base=""
  signals_base="$(python3 "${lib_dir}/resolve.py" signals-base-url "${config_json}" "${SIGNALS_BASE_URL:-}")"
  python3 "${lib_dir}/resolve.py" session "${config_json}" "${signals_base}"
}

scout_start_browser() {
  local platform="$1"
  local start_url="${2:-}"
  local session_name="${3:-}"

  if [[ -z "${session_name}" ]]; then
    return 1
  fi

  if ! command -v realtimex-pp-cli >/dev/null 2>&1; then
    return 1
  fi

  local port=""
  port="$(scout_pp_cli_json list-browser-sessions | scout_parse_browser_port "${session_name}")"

  if [[ -z "${port}" ]] && [[ "${session_name}" == signals-scout-* ]]; then
    local create_args=(
      create-browser-session
      --idempotent
      --session-name "${session_name}"
    )
    if [[ -n "${start_url}" ]]; then
      create_args+=(--url "${start_url}")
    fi
    port="$(scout_pp_cli_json "${create_args[@]}" | scout_parse_browser_port "${session_name}")"
  fi

  if [[ -z "${port}" ]] && [[ "${session_name}" != signals-scout-* ]]; then
    return 1
  fi

  if [[ "$(scout_browser_running "${session_name}" 2>/dev/null || echo 0)" != "1" ]]; then
    local start_args=(start-browser-session "${session_name}")
    if [[ -n "${start_url}" ]]; then
      start_args+=(--url "${start_url}")
    fi
    port="$(scout_pp_cli_json "${start_args[@]}" | scout_parse_browser_port "${session_name}")"
    if [[ -z "${port}" ]]; then
      port="$(scout_pp_cli_json list-browser-sessions | scout_parse_browser_port "${session_name}")"
    fi
  fi

  if [[ -n "${port}" ]]; then
    echo "${port}"
  fi
}

scout_select_content_tab() {
  local session_name="$1"
  local lib_dir="$2"
  local platform="${3:-}"

  if ! command -v agent-browser >/dev/null 2>&1; then
    return 1
  fi

  local tab_id=""
  tab_id="$(
    agent-browser --session "${session_name}" tab list --json 2>/dev/null \
      | python3 "${lib_dir}/resolve.py" pick-tab "${platform}"
  )"

  if [[ -n "${tab_id}" ]]; then
    agent-browser --session "${session_name}" tab "${tab_id}" >/dev/null 2>&1 || true
  fi
}

scout_stop_browser() {
  local session_name="${1:-}"
  local lib_dir="${2:-}"

  if [[ -z "${session_name}" ]] || [[ -z "${lib_dir}" ]]; then
    return 0
  fi

  if [[ "$(python3 "${lib_dir}/resolve.py" should-stop "${session_name}")" != "1" ]]; then
    return 0
  fi

  if command -v realtimex-pp-cli >/dev/null 2>&1; then
    realtimex-pp-cli stop-browser-session "${session_name}" --agent --yes >/dev/null 2>&1 || true
  fi
}
