#!/usr/bin/env bash

scout_enqueue_urls() {
  local config_json="$1"
  local urls="$2"
  local platform="$3"
  local producer_run_id="$4"
  local signals_base_url="$5"

  python3 - <<'PY' "${urls}" "${platform}" "${producer_run_id}" "${signals_base_url}" "${ROOT_DIR}/lib/resolve.py"
import json, os, sys, urllib.request, subprocess
raw_urls = [line.strip() for line in sys.argv[1].splitlines() if line.strip()]
platform = sys.argv[2]
producer_run_id = sys.argv[3]
base = sys.argv[4].rstrip("/")
resolve_script = sys.argv[5]
filter_proc = subprocess.run(
    ["python3", resolve_script, "filter-enqueue-json", platform],
    input="\n".join(raw_urls),
    capture_output=True,
    text=True,
    check=False,
)
if filter_proc.returncode != 0:
    print(filter_proc.stderr or filter_proc.stdout, file=sys.stderr)
    raise SystemExit(1)
filtered = json.loads(filter_proc.stdout or '{"accepted":[],"rejected":[]}')
urls = filtered.get("accepted") or []
rejected = filtered.get("rejected") or []
if not urls:
    print(json.dumps({
        "queued": 0,
        "skipped": len(rejected),
        "deduped": 0,
        "failed": 0,
        "deferred": 0,
        "rejectedNonPostUrls": rejected,
        "message": "no enqueueable post URLs after navigation/junk filter",
    }))
    raise SystemExit(0)
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
        parsed = json.loads(body)
        if rejected:
            existing = parsed.get("rejectedNonPostUrls") or []
            parsed["rejectedNonPostUrls"] = existing + rejected
            parsed["skipped"] = int(parsed.get("skipped") or 0) + len(rejected)
        print(json.dumps(parsed))
except Exception as exc:
    print(json.dumps({"error": str(exc), "queued": 0, "skipped": rejected}))
    raise SystemExit(1)
PY
}
