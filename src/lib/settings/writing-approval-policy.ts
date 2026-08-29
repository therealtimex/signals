import { readSignalsConfig } from "@/lib/settings/signals-config";
import type { EnvLike } from "@/lib/rtx/env";

export const WRITING_APPROVAL_POLICIES = ["explicit", "auto_low_risk"] as const;
export type WritingApprovalPolicy = (typeof WRITING_APPROVAL_POLICIES)[number];
export const WRITING_APPROVAL_POLICY_ENV = "SIGNALS_WRITING_APPROVAL_POLICY";

function parsePolicy(value: unknown): WritingApprovalPolicy | null {
  return typeof value === "string" &&
    (WRITING_APPROVAL_POLICIES as readonly string[]).includes(value.trim())
    ? (value.trim() as WritingApprovalPolicy)
    : null;
}

export function getWritingApprovalPolicy(
  env: EnvLike = process.env,
): WritingApprovalPolicy {
  return (
    parsePolicy(env[WRITING_APPROVAL_POLICY_ENV]) ??
    parsePolicy(readSignalsConfig().writingApprovalPolicy) ??
    "explicit"
  );
}
