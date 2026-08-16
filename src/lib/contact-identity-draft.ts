import type { Platform } from "@/lib/db/platforms";

export type DraftContactIdentity = {
  platform: Platform;
  platformUserId: string;
  platformHandle: string;
  platformUrl: string;
  isPrimary: boolean;
};

export const CRM_IDENTITY_PLATFORMS = ["x", "linkedin", "gmail", "substack"] as const satisfies readonly Platform[];

export const platformLabels: Record<string, string> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  substack: "Substack",
};

export function emptyDraftIdentity(
  platform: (typeof CRM_IDENTITY_PLATFORMS)[number] = "x",
): DraftContactIdentity {
  return {
    platform,
    platformUserId: "",
    platformHandle: "",
    platformUrl: "",
    isPrimary: false,
  };
}
