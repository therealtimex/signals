#!/usr/bin/env bash

scout_enqueue_urls() {
  local config_json="$1"
  local urls="$2"
  local platform="$3"
  local producer_run_id="$4"
  local signals_base_url="$5"

  python3 - <<'PY' "${urls}" "${platform}" "${producer_run_id}" "${signals_base_url}"
import json, os, sys, urllib.request
urls = [line.strip() for line in sys.argv[1].splitlines() if line.strip()]
platform = sys.argv[2]
producer_run_id = sys.argv[3]
base = sys.argv[4].rstrip("/")
payload = {
    "urls": urls,
    "platform": platform,
    "producerRunId": producer_run_id,
}
req = urllib.request.Request(
    f"{base}/api/snowball-seed-scout/enqueue",
    data=json.dumps(payload).encode("utf-8"),
    headers={"content-type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode("utf-8")
        print(body)
except Exception as exc:
    print(json.dumps({"error": str(exc), "queued": 0, "skipped": urls}))
    raise SystemExit(1)
PY
}
