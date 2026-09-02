import { defineContract } from "../flows/experience-contract.mjs";

const blocked = ({ data }) => ({ ok: data?.reason === "assist_only_mandate", detail: data?.reason ?? "missing reason" });

export default defineContract({
  id: "issue-413-autonomous-path",
  issue: 413,
  kind: "path",
  reachability: {
    status: "blocked",
    by: "assist_only_mandate",
    unblockedBy: "ADR widening WRITING_INTENT_MANDATES + a reply publish adapter + operator sign-off (#377 D12)",
  },
  evidence: { profile: "visual", gtm: false },
  promise: "When a separately approved low-risk publish surface exists, an operator may choose autonomous public nurture while DMs remain explicit.",
  checkpoints: [
    { id: "activation-operator-choice", ui: "switch enabled for publish-capable public surfaces; DM always explicit", data: "registry exposes an operator-choice surface", assert: blocked },
    { id: "run-config-off-honored", data: "requireApproval false persists with operator_choice gate", assert: blocked },
    { id: "composition-autonomous", data: "composition carries the future approved autonomous mandate", assert: blocked },
    { id: "published-result", ui: "run page shows Published with platform URL", data: "materialized variant has a completed publish job", assert: blocked },
    { id: "dm-still-explicit", ui: "DM remains Awaiting review", data: "DM approval policy remains explicit", assert: blocked },
  ],
});
