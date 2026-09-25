"use strict";

function fail(message) {
  throw { message: `Signals publish preflight: ${message}`, errorCode: "unknown" };
}

function localBaseUrl(value) {
  if (!value) fail("SIGNALS_BASE_URL is required for a live post");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("SIGNALS_BASE_URL is not a URL");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    fail("SIGNALS_BASE_URL must be a local HTTP origin");
  }
  return url.origin;
}

async function readJson(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    fail("Signals is unavailable; no public post was submitted");
  }
  if (!response.ok) fail(`Signals returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    fail("Signals returned invalid JSON");
  }
}

function equalArray(left, right) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

/**
 * Fail closed before a public browser click unless the supplied text and target
 * still match a live Signals job and an existing Content item.
 */
async function verifyPublishJob({ payload, platform, baseUrl, fetchImpl = fetch }) {
  const jobId = String(payload?.jobId ?? "").trim();
  const contentItemId = String(payload?.contentItemId ?? "").trim();
  if (!jobId || !contentItemId) {
    fail("payload.jobId and payload.contentItemId are required for a live post");
  }
  const origin = localBaseUrl(baseUrl);
  const jobResponse = await readJson(
    fetchImpl,
    `${origin}/api/content/publish-jobs/${encodeURIComponent(jobId)}`
  );
  const job = jobResponse?.job;
  if (jobResponse?.success !== true || job?.id !== jobId) fail("publish job was not found");
  if (job.contentItemId !== contentItemId) fail("job points to a different Content item");
  if (job.status !== "publishing" || job.stale) fail("job is not actively publishing");
  if (!Array.isArray(job.payload?.platforms) || !job.payload.platforms.includes(platform)) {
    fail("job does not include this platform");
  }
  if (job.payload.text !== payload.text || !equalArray(job.payload.threadTexts, payload.threadTexts)) {
    fail("browser payload differs from the queued post text");
  }
  if (String(job.payload.kind || "original") !== String(payload.kind || "original")) {
    fail("browser payload differs from the queued post kind");
  }
  if (
    String(job.payload.sourcePostUrl || "") !== String(payload.sourcePostUrl || "") ||
    String(job.payload.sourcePostId || "") !== String(payload.sourcePostId || "")
  ) {
    fail("browser payload differs from the queued source post");
  }
  const mediaIds = Array.isArray(job.payload.mediaAssetIds) ? job.payload.mediaAssetIds : [];
  const mediaPaths = Array.isArray(payload.mediaPaths) ? payload.mediaPaths.flat(Infinity) : [];
  if (mediaIds.length !== mediaPaths.length || mediaPaths.some((path) => typeof path !== "string" || !path)) {
    fail("browser payload omits queued media");
  }

  const matchingTargets = (job.targets ?? []).filter(
    (target) => target.platform === platform && target.status === "publishing"
  );
  const target = payload.targetId
    ? matchingTargets.find((candidate) => candidate.targetId === payload.targetId)
    : matchingTargets.length === 1 ? matchingTargets[0] : null;
  if (!target) fail("the requested platform target is not actively publishing");
  if (target.expectedHandle && target.expectedHandle !== payload.expectedHandle) {
    fail("browser payload differs from the queued account identity");
  }

  const itemResponse = await readJson(
    fetchImpl,
    `${origin}/api/content/${encodeURIComponent(contentItemId)}`
  );
  if (itemResponse?.item?.id !== contentItemId) fail("Content item was not found");
  if (itemResponse.item.status !== "publishing") fail("Content item is not publishing");
  const itemPlatforms = String(itemResponse.item.platformTarget ?? "").split(",");
  if (!itemPlatforms.includes(platform)) fail("Content item belongs to another platform");

  if (mediaIds.length) {
    const mediaResponse = await readJson(
      fetchImpl,
      `${origin}/api/media?contentItemId=${encodeURIComponent(contentItemId)}`
    );
    const attachedIds = new Set((mediaResponse?.assets ?? []).map((asset) => asset.id));
    if (mediaIds.some((id) => !attachedIds.has(id))) fail("queued media is not attached to the Content item");
  }
  return { jobId, contentItemId, targetId: target.targetId ?? null };
}

module.exports = { verifyPublishJob };
