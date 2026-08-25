#!/usr/bin/env bash

scout_extract_urls() {
  local config_json="$1"
  local platform="$2"
  local max_links
  max_links="$(python3 - <<'PY' "${config_json}"
import json, sys
config = json.loads(sys.argv[1])
print(int(config.get("maxLinksPerRun") or 5))
PY
)"

  local port=""
  port="$(scout_start_browser "${platform}" || true)"

  local feed_url=""
  case "${platform}" in
    x)
      feed_url="https://x.com/home"
      ;;
    linkedin)
      feed_url="https://www.linkedin.com/feed/"
      ;;
    facebook)
      feed_url="https://www.facebook.com/"
      ;;
  esac

  if [[ -n "${feed_url}" ]] && command -v agent-browser >/dev/null 2>&1 && [[ -n "${port}" ]]; then
    agent-browser --session "signals-scout-${platform}" connect "${port}" >/dev/null 2>&1 || true
    agent-browser --session "signals-scout-${platform}" open "${feed_url}" >/dev/null 2>&1 || true
    agent-browser --session "signals-scout-${platform}" snapshot -i --json 2>/dev/null \
      | python3 - <<'PY' "${config_json}" "${max_links}" "${platform}"
import json, re, sys
config = json.loads(sys.argv[1])
max_links = int(sys.argv[2])
platform = sys.argv[3]
keywords = [k.lower() for k in (config.get("intentKeywords") or []) if str(k).strip()]
try:
    snapshot = json.load(sys.stdin)
except json.JSONDecodeError:
    snapshot = {}
refs = snapshot.get("refs") or snapshot.get("elements") or []
patterns = {
    "x": re.compile(r"https?://(?:x|twitter)\.com/[^/\s]+/status/\d+", re.I),
    "linkedin": re.compile(r"https?://(?:www\.)?linkedin\.com/(?:posts|feed/update)/\S+", re.I),
    "facebook": re.compile(r"https?://(?:www\.)?facebook\.com/\S+/posts/\S+", re.I),
}
pattern = patterns.get(platform)
seen = set()
urls = []
for ref in refs:
    text = " ".join(
        str(ref.get(key) or "")
        for key in ("href", "url", "text", "name", "label", "value")
    )
    if keywords and not any(keyword in text.lower() for keyword in keywords):
        continue
    if not pattern:
        continue
    for token in re.findall(r"https?://\S+", text):
        cleaned = token.rstrip(".,)\"'")
        if pattern.search(cleaned) and cleaned not in seen:
            seen.add(cleaned)
            urls.append(cleaned)
            if len(urls) >= max_links:
                break
    if len(urls) >= max_links:
        break
for url in urls:
    print(url)
PY
  else
    python3 - <<'PY' "${config_json}" "${max_links}"
import json, sys
config = json.loads(sys.argv[1])
max_links = int(sys.argv[2])
candidates = []
for entry in (config.get("communities") or []) + (config.get("searchQueries") or []):
    entry = str(entry).strip()
    if entry.startswith("http"):
        candidates.append(entry)
for url in candidates[:max_links]:
    print(url)
PY
  fi

  scout_stop_browser "${platform}"
}
