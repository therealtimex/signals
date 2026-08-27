#!/usr/bin/env bash

# shellcheck source=lib/copy-link-harvest.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/copy-link-harvest.sh"

scout_relaxed_config() {
  local config_json="$1"
  python3 - <<'PY' "${config_json}"
import json, sys
config = json.loads(sys.argv[1])
config = dict(config)
config["intentKeywords"] = []
print(json.dumps(config))
PY
}

scout_harvest_dom_posts() {
  local config_json="$1"
  local platform="$2"
  local max_links="$3"
  local session_name="$4"
  local lib_dir="$5"
  local pass_config="${6:-${config_json}}"

  local harvested=""
  harvested="$(
    agent-browser --session "${session_name}" snapshot -i --json 2>/dev/null \
      | python3 "${lib_dir}/resolve.py" extract-posts "${pass_config}" "${platform}" "${max_links}"
  )"

  if [[ -n "${harvested}" ]]; then
    printf '%s\n' "${harvested}"
    return 0
  fi

  local eval_script=""
  eval_script="$(python3 "${lib_dir}/resolve.py" eval-script "${pass_config}" "${platform}" "${max_links}")"
  agent-browser --session "${session_name}" eval "${eval_script}" 2>/dev/null \
    | python3 "${lib_dir}/resolve.py" parse-eval-posts "${pass_config}" "${platform}" "${max_links}"
}

scout_harvest_page_posts() {
  local config_json="$1"
  local platform="$2"
  local max_links="$3"
  local session_name="$4"
  local lib_dir="$5"

  local relaxed_config=""
  relaxed_config="$(scout_relaxed_config "${config_json}")"

  if [[ "${platform}" == "facebook" ]]; then
    local harvested=""
    # Honor configured intentKeywords first; only widen to the relaxed config
    # when the keyword-filtered pass finds nothing.
    harvested="$(scout_harvest_copy_links "facebook" "${config_json}" "${max_links}" "${session_name}" "${lib_dir}")"
    if [[ -z "${harvested}" ]]; then
      harvested="$(scout_harvest_copy_links "facebook" "${config_json}" "${max_links}" "${session_name}" "${lib_dir}" "${relaxed_config}")"
    fi
    if [[ -n "${harvested}" ]]; then
      printf '%s\n' "${harvested}"
    fi
    return 0
  fi

  if [[ "${platform}" == "linkedin" ]]; then
    local harvested=""
    harvested="$(scout_harvest_copy_links "linkedin" "${config_json}" "${max_links}" "${session_name}" "${lib_dir}")"
    if [[ -z "${harvested}" ]]; then
      harvested="$(scout_harvest_copy_links "linkedin" "${config_json}" "${max_links}" "${session_name}" "${lib_dir}" "${relaxed_config}")"
    fi
    if [[ -n "${harvested}" ]]; then
      printf '%s\n' "${harvested}"
      return 0
    fi
    harvested="$(scout_harvest_dom_posts "${config_json}" "${platform}" "${max_links}" "${session_name}" "${lib_dir}")"
    if [[ -z "${harvested}" ]]; then
      harvested="$(scout_harvest_dom_posts "${config_json}" "${platform}" "${max_links}" "${session_name}" "${lib_dir}" "${relaxed_config}")"
    fi
    if [[ -n "${harvested}" ]]; then
      printf '%s\n' "${harvested}"
    fi
    return 0
  fi

  if [[ "${platform}" == "x" ]]; then
    local harvested=""
    harvested="$(scout_harvest_dom_posts "${config_json}" "${platform}" "${max_links}" "${session_name}" "${lib_dir}")"
    if [[ -z "${harvested}" ]]; then
      harvested="$(scout_harvest_dom_posts "${config_json}" "${platform}" "${max_links}" "${session_name}" "${lib_dir}" "${relaxed_config}")"
    fi
    if [[ -n "${harvested}" ]]; then
      printf '%s\n' "${harvested}"
      return 0
    fi
    harvested="$(scout_harvest_copy_links "x" "${config_json}" "${max_links}" "${session_name}" "${lib_dir}")"
    if [[ -z "${harvested}" ]]; then
      harvested="$(scout_harvest_copy_links "x" "${config_json}" "${max_links}" "${session_name}" "${lib_dir}" "${relaxed_config}")"
    fi
    if [[ -n "${harvested}" ]]; then
      printf '%s\n' "${harvested}"
    fi
    return 0
  fi

  scout_harvest_dom_posts "${config_json}" "${platform}" "${max_links}" "${session_name}" "${lib_dir}"
}

scout_extract_urls() {
  local config_json="$1"
  local platform="$2"
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  local max_links
  max_links="$(python3 - <<'PY' "${config_json}"
import json, sys
config = json.loads(sys.argv[1])
print(int(config.get("maxLinksPerRun") or 5))
PY
)"

  local session_name=""
  session_name="$(scout_resolve_session_name "${config_json}" "${lib_dir}")"

  local targets=""
  targets="$(python3 "${lib_dir}/resolve.py" targets "${config_json}" "${platform}")"

  if [[ -z "${targets}" ]]; then
    scout_stop_browser "${session_name}" "${lib_dir}"
    return 0
  fi

  local -a collected=()
  local first_target=""
  first_target="$(printf '%s\n' "${targets}" | sed -n '1p')"

  local port=""
  port="$(scout_start_browser "${platform}" "${first_target}" "${session_name}" || true)"

  if [[ -n "${port}" ]] && command -v agent-browser >/dev/null 2>&1; then
    agent-browser --session "${session_name}" connect "${port}" >/dev/null 2>&1 || true
    scout_select_content_tab "${session_name}" "${lib_dir}" "${platform}"

    while IFS= read -r target; do
      [[ -z "${target}" ]] && continue
      [[ "${#collected[@]}" -ge "${max_links}" ]] && break

      agent-browser --session "${session_name}" open "${target}" >/dev/null 2>&1 || true
      if [[ "${platform}" == "facebook" ]]; then
        sleep 8
      else
        sleep 5
      fi
      scout_select_content_tab "${session_name}" "${lib_dir}" "${platform}"

      while IFS= read -r url; do
        [[ -z "${url}" ]] && continue
        local seen=0
        local existing
        for existing in "${collected[@]:-}"; do
          if [[ "${existing}" == "${url}" ]]; then
            seen=1
            break
          fi
        done
        if [[ "${seen}" -eq 0 ]]; then
          collected+=("${url}")
          if [[ "${#collected[@]}" -ge "${max_links}" ]]; then
            break
          fi
        fi
      done < <(
        scout_harvest_page_posts "${config_json}" "${platform}" "${max_links}" "${session_name}" "${lib_dir}"
      )
    done <<< "${targets}"
  fi

  if [[ "${#collected[@]}" -eq 0 ]]; then
    while IFS= read -r url; do
      [[ -z "${url}" ]] && continue
      collected+=("${url}")
      if [[ "${#collected[@]}" -ge "${max_links}" ]]; then
        break
      fi
    done < <(python3 "${lib_dir}/resolve.py" fallback "${config_json}" "${platform}" "${max_links}")
  fi

  scout_stop_browser "${session_name}" "${lib_dir}"

  if [[ "${#collected[@]}" -gt 0 ]]; then
    local filtered=""
    filtered="$(printf '%s\n' "${collected[@]}" | python3 "${lib_dir}/resolve.py" filter-enqueue "${platform}")"
    if [[ -n "${filtered}" ]]; then
      printf '%s\n' "${filtered}"
    fi
  fi
}
