#!/usr/bin/env bash

scout_harvest_copy_links() {
  local platform="$1"
  local config_json="$2"
  local max_links="$3"
  local session_name="$4"
  local lib_dir="$5"
  local relaxed_config="${6:-}"

  agent-browser --session "${session_name}" eval "$(python3 "${lib_dir}/resolve.py" copy-link-init)" >/dev/null 2>&1 || true

  local attempts=0
  local max_attempts=$((max_links * 4))
  local consecutive_none=0
  local -a collected=()
  local pass_config="${config_json}"

  if [[ -n "${relaxed_config}" ]]; then
    pass_config="${relaxed_config}"
  fi

  while [[ "${#collected[@]}" -lt "${max_links}" && "${attempts}" -lt "${max_attempts}" ]]; do
    attempts=$((attempts + 1))

    local opened=""
    opened="$(agent-browser --session "${session_name}" eval "$(printf '%s' "${pass_config}" | python3 "${lib_dir}/resolve.py" "${platform}-open-menu" -)" 2>/dev/null || true)"
    if [[ "${opened}" != *"opened"* ]]; then
      if [[ "${opened}" == *"none"* ]]; then
        consecutive_none=$((consecutive_none + 1))
        if [[ "${consecutive_none}" -ge 5 ]]; then
          break
        fi
      else
        consecutive_none=0
      fi
      agent-browser --session "${session_name}" eval "window.scrollBy(0, 900)" >/dev/null 2>&1 || true
      sleep 2
      continue
    fi

    consecutive_none=0

    sleep 1
    agent-browser --session "${session_name}" eval "$(python3 "${lib_dir}/resolve.py" "${platform}-click-copy-link")" >/dev/null 2>&1 || true
    sleep 1

    local raw_urls=""
    local tmp_config=""
    tmp_config="$(mktemp)"
    printf '%s' "${pass_config}" > "${tmp_config}"
    raw_urls="$(
      agent-browser --session "${session_name}" eval "$(python3 "${lib_dir}/resolve.py" "${platform}-extract-url")" 2>/dev/null \
        | python3 "${lib_dir}/resolve.py" parse-eval-posts "@${tmp_config}" "${platform}" "${max_links}"
    )"
    rm -f "${tmp_config}"

    agent-browser --session "${session_name}" eval "$(python3 "${lib_dir}/resolve.py" "${platform}-close-menu")" >/dev/null 2>&1 || true
    sleep 1

    if [[ -z "${raw_urls}" ]]; then
      agent-browser --session "${session_name}" eval "window.scrollBy(0, 700)" >/dev/null 2>&1 || true
      sleep 1
      continue
    fi

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
    done <<< "${raw_urls}"
  done

  if [[ "${#collected[@]}" -gt 0 ]]; then
    printf '%s\n' "${collected[@]}"
  fi
}
