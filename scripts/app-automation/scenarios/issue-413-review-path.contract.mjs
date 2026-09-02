import { defineContract } from "../flows/experience-contract.mjs";

const equal = (actual, expected, detail) => ({ ok: actual === expected, detail: `${detail}: ${actual} / ${expected}` });
const sorted = (values = []) => [...values].sort();
const sameIds = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
const noPublishUi = (ui) => ui.publishedCopyCount === 0 && ui.sendPublishActionCount === 0;

export function proposalsListedAssertion({ ui, data }) {
  const idsAgree = sameIds(ui.ids, data.fixtureIds)
    && sameIds(ui.ids, data.apiIds)
    && ui.count === data.fixtureIds.length;
  const rowsAgree = JSON.stringify(ui.rows) === JSON.stringify(data.rows);
  return {
    ok: idsAgree && rowsAgree && noPublishUi(ui),
    detail: `cards=${ui.count}/${data.fixtureIds.length}; ids=${idsAgree}; rows=${rowsAgree}; published=${ui.publishedCopyCount}; actions=${ui.sendPublishActionCount}`,
  };
}

export function approveMaterializesAssertion({ ui, data }) {
  const contentMatches = Boolean(data.contentItemId)
    && data.contentExists
    && data.contentResponseId === data.contentItemId
    && ui.contentHref === `/dashboard/content/${data.contentItemId}`;
  return {
    ok: ui.status === "Materialized · export only"
      && contentMatches
      && data.approvalBy === "user"
      && data.evidenceKind === "ui"
      && ui.pending === data.pending
      && data.pending === data.expectedPending
      && noPublishUi(ui),
    detail: `${ui.status}; content=${contentMatches}; approval=${data.approvalBy}/${data.evidenceKind}; pending=${ui.pending}/${data.pending}`,
  };
}

export function rejectPersistsAssertion({ ui, data }) {
  return {
    ok: ui.status === "Rejected"
      && data.variantStatus === "rejected"
      && data.approvalState === "rejected"
      && data.approvalBy === "user"
      && data.evidenceKind === "ui"
      && data.note === ui.note
      && ui.pending === data.pending
      && data.pending === data.expectedPending
      && ui.decisionActionCount === 0
      && noPublishUi(ui),
    detail: `status=${data.variantStatus}/${data.approvalState}; evidence=${data.approvalBy}/${data.evidenceKind}; pending=${ui.pending}/${data.pending}; actions=${ui.decisionActionCount}`,
  };
}

export default defineContract({
  id: "issue-413-review-path",
  issue: 413,
  kind: "review",
  reachability: { status: "reachable" },
  fixture: "nurture-proposals",
  evidence: { profile: "visual", gtm: false },
  promise: "A completed nurture run shows every proposal it created, says how many still need me, and lets me approve, revise, or reject each one here—and what I decide is what Signals persists.",
  checkpoints: [
    {
      id: "run-header-awaiting-review",
      ui: "status badge reads Completed · 3 awaiting review",
      data: "workflow proposalSummary.pendingReview equals fixture count",
      capture: "workflow-run-awaiting-review",
      never: ["header reads only Completed"],
      assert: ({ ui, data }) => ({ ok: ui.pending === data.pending && data.pending === data.fixtureCount && ui.text === `Completed · ${data.pending} awaiting review`, detail: `text=${ui.text}; ui=${ui.pending} api=${data.pending} fixture=${data.fixtureCount}` }),
    },
    {
      id: "proposals-listed",
      ui: "one complete proposal card per persisted variant",
      data: "proposal ids, bodies, and hrefs match the API byte-for-byte",
      capture: "workflow-run-proposals",
      never: ["a persisted proposal is hidden", "published wording"],
      assert: proposalsListedAssertion,
    },
    {
      id: "approve-materializes",
      ui: "approved card reads Materialized · export only and links to content",
      data: "approval is user/ui and materializedContentItemId is set",
      capture: "workflow-run-proposal-materialized",
      never: ["approval by policy", "published wording"],
      assert: approveMaterializesAssertion,
    },
    {
      id: "reject-persists",
      ui: "rejected card reads Rejected and pending count falls",
      data: "variant and approval state are rejected with the UI note",
      capture: "workflow-run-proposal-rejected",
      never: ["rejected proposal remains pending"],
      assert: rejectPersistsAssertion,
    },
    {
      id: "revise-requests",
      ui: "card reads Revision requested and opens the existing run thread",
      data: "revisionRequest note/evidence persist while approval remains pending",
      capture: "workflow-run-proposal-revision",
      never: ["revision request approves or rejects"],
      assert: ({ ui, data }) => ({
        ok: ui.status === "Revision requested"
          && ui.noteText === `Revision note: ${data.note}`
          && data.note === ui.note
          && data.evidenceKind === "ui"
          && data.approvalState === "pending"
          && Boolean(data.threadPath)
          && ui.pending === data.pending
          && data.pending === data.expectedPending
          && noPublishUi(ui),
        detail: `approval=${data.approvalState}; evidence=${data.evidenceKind}; thread=${Boolean(data.threadPath)}; pending=${ui.pending}/${data.pending}`,
      }),
    },
    {
      id: "launch-roundtrip",
      ui: "launch page lists the same variants",
      data: "launch and proposal APIs expose identical variant ids",
      capture: "launch-proposal-roundtrip",
      never: ["variant visible on only one page"],
      assert: ({ ui, data }) => ({
        ok: ui.count === data.fixtureIds.length
          && sameIds(ui.ids, data.fixtureIds)
          && sameIds(ui.ids, data.apiIds),
        detail: `launch=${ui.count}; fixture=${data.fixtureIds.length}; api=${data.apiIds.length}`,
      }),
    },
    {
      id: "thread-approval-idempotent",
      data: "a later thread materialization returns created false and preserves UI evidence",
      never: ["thread evidence overwrites UI evidence"],
      assert: ({ data }) => ({
        ok: equal(`${data.created}:${data.evidenceKind}`, "false:ui", "created/evidence").ok
          && data.contentItemId === data.originalContentItemId
          && data.contentExists,
        detail: `created=${data.created}; evidence=${data.evidenceKind}; contentPreserved=${data.contentItemId === data.originalContentItemId}; exists=${data.contentExists}`,
      }),
    },
  ],
});
