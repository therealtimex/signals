import assert from "node:assert/strict";
import test from "node:test";
import {
  approveMaterializesAssertion,
  proposalsListedAssertion,
  rejectPersistsAssertion,
} from "./issue-413-review-path.contract.mjs";

function listedPayload() {
  const row = {
    id: "variant_1",
    recipientText: "Ada · @ada",
    recipientHref: "/dashboard/contacts/contact_1",
    surfaceText: "X reply",
    capabilityText: "Draft only",
    statusText: "Awaiting review",
    auditText: "Audit: pass",
    body: "A grounded reply",
    variantHref: "/dashboard/launches/launch_1/variants/variant_1",
  };
  return {
    ui: {
      count: 1,
      ids: ["variant_1"],
      rows: [row],
      publishedCopyCount: 0,
      sendPublishActionCount: 0,
    },
    data: {
      fixtureIds: ["variant_1"],
      apiIds: ["variant_1"],
      rows: [{ ...row }],
    },
  };
}

test("proposal listing fails when a promised visible field is absent", () => {
  const payload = listedPayload();
  assert.equal(proposalsListedAssertion(payload).ok, true);

  delete payload.ui.rows[0].recipientText;
  assert.equal(proposalsListedAssertion(payload).ok, false);
});

test("proposal listing fails for hidden fixture ids or forbidden publish UI", () => {
  const hidden = listedPayload();
  hidden.ui.count = 0;
  hidden.ui.ids = [];
  hidden.ui.rows = [];
  assert.equal(proposalsListedAssertion(hidden).ok, false);

  const published = listedPayload();
  published.ui.publishedCopyCount = 1;
  assert.equal(proposalsListedAssertion(published).ok, false);
});

test("approval requires persisted UI evidence and a retrievable content item", () => {
  const payload = {
    ui: {
      status: "Materialized · export only",
      contentHref: "/dashboard/content/content_1",
      pending: 2,
      publishedCopyCount: 0,
      sendPublishActionCount: 0,
    },
    data: {
      contentItemId: "content_1",
      contentExists: true,
      contentResponseId: "content_1",
      approvalBy: "user",
      evidenceKind: "ui",
      pending: 2,
      expectedPending: 2,
    },
  };
  assert.equal(approveMaterializesAssertion(payload).ok, true);

  payload.data.contentExists = false;
  assert.equal(approveMaterializesAssertion(payload).ok, false);
});

test("rejection requires UI evidence and the post-decision pending count", () => {
  const payload = {
    ui: {
      status: "Rejected",
      note: "Not now",
      pending: 1,
      decisionActionCount: 0,
      publishedCopyCount: 0,
      sendPublishActionCount: 0,
    },
    data: {
      variantStatus: "rejected",
      approvalState: "rejected",
      approvalBy: "user",
      evidenceKind: "ui",
      note: "Not now",
      pending: 1,
      expectedPending: 1,
    },
  };
  assert.equal(rejectPersistsAssertion(payload).ok, true);

  payload.data.evidenceKind = "thread_message";
  assert.equal(rejectPersistsAssertion(payload).ok, false);
  payload.data.evidenceKind = "ui";
  payload.ui.pending = 2;
  assert.equal(rejectPersistsAssertion(payload).ok, false);
});
