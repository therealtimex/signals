import { defineContract } from "../flows/experience-contract.mjs";

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
      ui: "approval switch is checked, disabled, and explains the assist-only surface matrix",
      data: "template requireApproval is true",
      capture: "nurture-approval-gate",
      never: ["enabled approval switch", "autonomous or publish promise"],
      assert: ({ ui, data }) => ({ ok: ui.mode === "locked_explicit" && ui.reason === "assist_only_mandate" && ui.checked && ui.disabled && ui.rows >= 2 && ui.alwaysExplicit && data.requireApproval === true, detail: `gate=${ui.mode}/${ui.reason}; rows=${ui.rows}; config=${data.requireApproval}` }),
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
      assert: ({ ui, data }) => ({ ok: ui.draftOnlyCount === data.total && !ui.hasSendOrPublish && data.allDraftOnly && data.allExplicit && data.allAssistOnly, detail: `draftOnly=${ui.draftOnlyCount}/${data.total}; action=${ui.hasSendOrPublish}` }),
    },
    {
      id: "materialized-is-export-only",
      ui: "approved proposal reads Materialized · export only",
      data: "materialization nextAction is export and send-to-agent refuses the intent",
      capture: "nurture-export-only",
      never: ["publish job exists", "Published label"],
      assert: ({ ui, data }) => ({ ok: ui.status === "Materialized · export only" && data.nextAction === "export" && data.sendRefused && data.publishJobs === 0, detail: `${ui.status}; next=${data.nextAction}; refused=${data.sendRefused}` }),
    },
  ],
});
