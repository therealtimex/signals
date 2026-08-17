#!/usr/bin/env bash
set -euo pipefail

# Upload a local image file and attach it as a contact avatar.
# Usage:
#   upload-avatar.sh <contactId> </absolute/or/relative/path/to/image>
#
# Returns JSON with mediaAssetId and resolvedAvatarUrl path.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${SIGNALS_BASE_URL:-$("${SCRIPT_DIR}/resolve-base-url.sh")}"

CONTACT_ID="${1:?contactId required}"
FILE_PATH="${2:?image file path required}"

if [[ ! -f "${FILE_PATH}" ]]; then
  echo "{\"success\":false,\"error\":\"File not found: ${FILE_PATH}\"}" >&2
  exit 1
fi

AUTH_HEADER=()
if [[ -n "${SIGNALS_AGENT_TOOL_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${SIGNALS_AGENT_TOOL_TOKEN}")
fi

UPLOAD_RESPONSE="$(
  curl -sS -X POST "${BASE_URL}/api/media" \
    "${AUTH_HEADER[@]}" \
    -F "file=@${FILE_PATH}" \
    -F "context=attachment"
)"

ASSET_ID="$(printf '%s' "${UPLOAD_RESPONSE}" | jq -r '.id // empty')"
if [[ -z "${ASSET_ID}" ]]; then
  echo "{\"success\":false,\"error\":\"Media upload failed\",\"details\":${UPLOAD_RESPONSE}}" >&2
  exit 1
fi

ATTACH_RESPONSE="$(
  curl -sS -X POST "${BASE_URL}/api/media/attachments" \
    "${AUTH_HEADER[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"mediaAssetId\":\"${ASSET_ID}\",\"parentType\":\"contact\",\"parentId\":\"${CONTACT_ID}\",\"role\":\"avatar\"}"
)"

ATTACHMENT_ID="$(printf '%s' "${ATTACH_RESPONSE}" | jq -r '.id // empty')"
if [[ -z "${ATTACHMENT_ID}" ]]; then
  echo "{\"success\":false,\"error\":\"Avatar attach failed\",\"details\":${ATTACH_RESPONSE}}" >&2
  exit 1
fi

jq -n \
  --arg contactId "${CONTACT_ID}" \
  --arg mediaAssetId "${ASSET_ID}" \
  --arg attachmentId "${ATTACHMENT_ID}" \
  --arg resolvedAvatarUrl "/api/media/${ASSET_ID}" \
  '{
    success: true,
    contactId: $contactId,
    mediaAssetId: $mediaAssetId,
    attachmentId: $attachmentId,
    resolvedAvatarUrl: $resolvedAvatarUrl,
    message: "Avatar uploaded and attached."
  }'
