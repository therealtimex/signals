import { defineContract } from "../flows/experience-contract.mjs";

const equal = (actual, expected, detail) => ({ ok: actual === expected, detail: `${detail}: ${actual} / ${expected}` });

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
      assert: ({ ui, data }) => ({ ok: ui.pending === data.pending && data.pending === data.fixtureCount && ui.text.includes(`${data.pending} awaiting review`), detail: `ui=${ui.pending} api=${data.pending} fixture=${data.fixtureCount}` }),
    },
    {
      id: "proposals-listed",
      ui: "one complete proposal card per persisted variant",
      data: "proposal ids, bodies, and hrefs match the API byte-for-byte",
      capture: "workflow-run-proposals",
      never: ["a persisted proposal is hidden", "published wording"],
      assert: ({ ui, data }) => ({ ok: JSON.stringify(ui) === JSON.stringify(data), detail: `ui=${ui.length} api=${data.length}` }),
    },
    {
      id: "approve-materializes",
      ui: "approved card reads Materialized · export only and links to content",
      data: "approval is user/ui and materializedContentItemId is set",
      capture: "workflow-run-proposal-materialized",
      never: ["approval by policy", "published wording"],
      assert: ({ ui, data }) => ({ ok: ui.status === "Materialized · export only" && ui.contentHref === `/dashboard/content/${data.contentItemId}` && data.approvalBy === "user" && data.evidenceKind === "ui", detail: `${ui.status}; approval=${data.approvalBy}/${data.evidenceKind}` }),
    },
    {
      id: "reject-persists",
      ui: "rejected card reads Rejected and pending count falls",
      data: "variant and approval state are rejected with the UI note",
      capture: "workflow-run-proposal-rejected",
      never: ["rejected proposal remains pending"],
      assert: ({ ui, data }) => ({ ok: ui.status === "Rejected" && data.variantStatus === "rejected" && data.approvalState === "rejected" && data.note === ui.note, detail: `status=${data.variantStatus}/${data.approvalState}; pending=${ui.pending}` }),
    },
    {
      id: "revise-requests",
      ui: "card reads Revision requested and opens the existing run thread",
      data: "revisionRequest note/evidence persist while approval remains pending",
      capture: "workflow-run-proposal-revision",
      never: ["revision request approves or rejects"],
      assert: ({ ui, data }) => ({ ok: ui.status === "Revision requested" && data.note === ui.note && data.evidenceKind === "ui" && data.approvalState === "pending" && Boolean(data.threadPath), detail: `approval=${data.approvalState}; thread=${Boolean(data.threadPath)}` }),
    },
    {
      id: "launch-roundtrip",
      ui: "launch page lists the same variants",
      data: "launch and proposal APIs expose identical variant ids",
      capture: "launch-proposal-roundtrip",
      never: ["variant visible on only one page"],
      assert: ({ ui, data }) => ({ ok: JSON.stringify([...ui].sort()) === JSON.stringify([...data].sort()), detail: `launch=${ui.length} proposals=${data.length}` }),
    },
    {
      id: "thread-approval-idempotent",
      data: "a later thread materialization returns created false and preserves UI evidence",
      never: ["thread evidence overwrites UI evidence"],
      assert: ({ data }) => equal(`${data.created}:${data.evidenceKind}`, "false:ui", "created/evidence"),
    },
  ],
});
