"use strict";

const { readFileSync } = require("node:fs");

global.fetch = async (input) => {
  const payload = JSON.parse(readFileSync(process.env.FAKE_SIGNALS_PUBLISH_PAYLOAD_FILE, "utf8"));
  const url = new URL(input);
  if (process.env.FAKE_SIGNALS_REQUESTS_FILE) {
    const { appendFileSync } = require("node:fs");
    appendFileSync(
      process.env.FAKE_SIGNALS_REQUESTS_FILE,
      JSON.stringify({ url: String(input), pathname: url.pathname, time: Date.now() }) + "\n"
    );
  }
  const flatPaths = Array.isArray(payload.mediaPaths) ? payload.mediaPaths.flat(Infinity) : [];
  const mediaAssetIds = flatPaths.map((_, index) => `asset_${index}`);
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
          platforms: ["x", "facebook", "linkedin"],
          mediaAssetIds,
        },
        targets: [{
          platform: "x",
          targetId: payload.targetId,
          expectedHandle: payload.expectedHandle,
          status: "publishing",
        }, {
          platform: "facebook",
          targetId: payload.targetId,
          expectedHandle: payload.expectedHandle,
          status: "publishing",
        }, {
          platform: "linkedin",
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
        platformTarget: "x,facebook,linkedin",
      },
    });
  }
  if (url.pathname === "/api/media") {
    const assets = flatPaths.map((filePath, index) => {
      const filename = String(filePath).split("/").pop() || `media_${index}`;
      return {
        id: mediaAssetIds[index] || `asset_${index}`,
        filename,
        storagePath: filename,
      };
    });
    return Response.json({ assets });
  }
  return Response.json({ error: "Unexpected fake Signals request" }, { status: 404 });
};
