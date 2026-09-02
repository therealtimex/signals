import assert from "node:assert/strict";
import test from "node:test";
import { materializedExportAssertion } from "./issue-413-capability-path.contract.mjs";
import { templateGateSurfaceRows } from "./issue-413-capability-path.mjs";

function payload() {
  return {
    ui: {
      status: "Materialized · export only",
      publishedCopyCount: 0,
      sendPublishActionCount: 0,
    },
    data: {
      contentItemId: "content_1",
      contentExists: true,
      contentResponseId: "content_1",
      nextAction: "export",
      sendStatus: 400,
      sendSuccess: false,
      sendErrorCode: "capability_unsupported",
      publishJobs: 0,
    },
  };
}

test("export-only checkpoint requires the exact capability refusal", () => {
  assert.equal(materializedExportAssertion(payload()).ok, true);

  const genericFailure = payload();
  genericFailure.data.sendStatus = 500;
  genericFailure.data.sendErrorCode = undefined;
  assert.equal(materializedExportAssertion(genericFailure).ok, false);
});

test("export-only checkpoint fails if content is missing or publish copy appears", () => {
  const missing = payload();
  missing.data.contentExists = false;
  assert.equal(materializedExportAssertion(missing).ok, false);

  const published = payload();
  published.ui.publishedCopyCount = 1;
  assert.equal(materializedExportAssertion(published).ok, false);
});

test("activation gate expectations come from all immutable template surfaces", () => {
  assert.deepEqual(templateGateSurfaceRows({
    writingIntent: {
      surfaces: [
        "x/reply",
        "x/direct_message",
        "linkedin/comment",
        "linkedin/direct_message",
        "facebook/comment",
        "facebook/direct_message",
      ],
    },
  }), [
    "X reply Draft only · approval required",
    "X DM Draft only · always explicit",
    "LinkedIn comment Draft only · approval required",
    "LinkedIn DM Draft only · always explicit",
    "Facebook comment Draft only · approval required",
    "Facebook DM Draft only · always explicit",
  ]);
});
