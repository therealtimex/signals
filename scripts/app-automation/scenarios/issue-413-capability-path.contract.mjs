import { defineContract } from "../flows/experience-contract.mjs";

const sorted = (values = []) => [...values].sort();
const sameIds = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

export function materializedExportAssertion({ ui, data }) {
  return {
    ok: ui.status === "Materialized · export only"
      && ui.publishedCopyCount === 0
      && ui.sendPublishActionCount === 0
      && data.nextAction === "export"
      && data.contentExists
      && data.contentResponseId === data.contentItemId
      && data.sendStatus === 400
      && data.sendSuccess === false
      && data.sendErrorCode === "capability_unsupported"
      && data.publishJobs === 0,
    detail: `${ui.status}; content=${data.contentExists}; next=${data.nextAction}; refusal=${data.sendStatus}/${data.sendErrorCode}; jobs=${data.publishJobs}; published=${ui.publishedCopyCount}`,
  };
}

export default defineContract({
  id: "issue-413-capability-path",
  issue: 413,
  kind: "negative",
  reachability: { status: "reachable" },
  fixture: "nurture-proposals",
  evidence: { profile: "visual", gtm: false },
  promise: "Signals tells me before activation that nurture is proposal-only, refuses a stale autonomy request, and never labels an exported proposal as published.",
  checkpoints: [
    {
      id: "activation-gate-locked",
      ui: "approval reads as locked status rather than a control, and explains the assist-only surface matrix",
      data: "template requireApproval is true",
      capture: "nurture-approval-gate",
      never: ["approval switch while the gate is locked", "autonomous or publish promise"],
      assert: ({ ui, data }) => ({
        ok: ui.mode === "locked_explicit"
          && ui.reason === "assist_only_mandate"
          && ui.switchCount === 0
          && ui.status.startsWith("Approval required")
          && JSON.stringify(ui.surfaceRows) === JSON.stringify(data.surfaceRows)
          && ui.lockedCopy.includes("every nurture surface")
          && ui.operatorChoiceCopyCount === 0
          && ui.autonomyActionCount === 0
          && data.requireApproval === true,
        detail: `gate=${ui.mode}/${ui.reason}; status="${ui.status}"; switches=${ui.switchCount}; rows=${ui.surfaceRows.length}/${data.surfaceRows.length}; operatorChoice=${ui.operatorChoiceCopyCount}; autonomyActions=${ui.autonomyActionCount}; config=${data.requireApproval}`,
      }),
    },
    {
      id: "run-config-rejects-off",
      data: "requireApproval false returns approval_gate_locked and creates no run",
      never: ["HTTP 201", "new run row"],
      assert: ({ data }) => ({ ok: data.status === 422 && data.errorCode === "approval_gate_locked" && data.beforeCount === data.afterCount, detail: `status=${data.status}; runs=${data.beforeCount}/${data.afterCount}` }),
    },
    {
      id: "composition-pinned",
      data: "run and launch persist assist_only, explicit, locked_explicit",
      never: ["non-explicit approval policy"],
      assert: ({ data }) => ({ ok: data.runMandate === "assist_only" && data.runPolicy === "explicit" && data.gateMode === "locked_explicit" && data.launchMandate === "assist_only", detail: `${data.runMandate}/${data.runPolicy}/${data.gateMode}/${data.launchMandate}` }),
    },
    {
      id: "variants-draft-only",
      ui: "all cards show Draft only and no Send or Publish action",
      data: "all proposals are draft_only, explicit, assist_only",
      capture: "nurture-draft-only-proposals",
      never: ["Send action", "Publish action"],
      assert: ({ ui, data }) => ({
        ok: ui.cardCount === data.fixtureIds.length
          && sameIds(ui.ids, data.fixtureIds)
          && sameIds(ui.ids, data.apiIds)
          && ui.draftOnlyCount === data.total
          && ui.awaitingReviewCount === data.total
          && ui.sendPublishActionCount === 0
          && ui.publishedCopyCount === 0
          && data.allDraftOnly
          && data.allExplicit
          && data.allAssistOnly,
        detail: `cards=${ui.cardCount}/${data.total}; draftOnly=${ui.draftOnlyCount}; awaiting=${ui.awaitingReviewCount}; actions=${ui.sendPublishActionCount}; published=${ui.publishedCopyCount}`,
      }),
    },
    {
      id: "materialized-is-export-only",
      ui: "approved proposal reads Materialized · export only",
      data: "materialization nextAction is export and send-to-agent refuses the intent",
      capture: "nurture-export-only",
      never: ["publish job exists", "Published label"],
      assert: materializedExportAssertion,
    },
  ],
});
