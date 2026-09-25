"use strict";

const { readFileSync } = require("node:fs");

global.fetch = async (input) => {
  const payload = JSON.parse(readFileSync(process.env.FAKE_SIGNALS_PUBLISH_PAYLOAD_FILE, "utf8"));
  const url = new URL(input);
  const mediaAssetIds = (payload.mediaPaths ?? []).map((_, index) => `asset_${index}`);
  if (url.pathname === `/api/content/publish-jobs/${payload.jobId}`) {
    return Response.json({
      success: true,
      job: {
        id: payload.jobId,
        contentItemId: payload.contentItemId,
        status: "publishing",
        payload: {
          kind: payload.kind ?? "original",
          text: payload.text,
          threadTexts: payload.threadTexts,
          platforms: ["x"],
          mediaAssetIds,
        },
        targets: [{
          platform: "x",
          targetId: payload.targetId,
          expectedHandle: payload.expectedHandle,
          status: "publishing",
        }],
      },
    });
  }
  if (url.pathname === `/api/content/${payload.contentItemId}`) {
    return Response.json({
      item: {
        id: payload.contentItemId,
        status: "publishing",
        platformTarget: "x",
      },
    });
  }
  if (url.pathname === "/api/media") {
    return Response.json({ assets: mediaAssetIds.map((id) => ({ id })) });
  }
  return Response.json({ error: "Unexpected fake Signals request" }, { status: 404 });
};
