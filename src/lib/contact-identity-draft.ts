import { PLATFORMS, type Platform } from "@/lib/db/platforms";
import { PLATFORM_SHORT_LABELS } from "@/lib/platforms/capabilities";

export type DraftContactIdentity = {
  platform: Platform;
  platformUserId: string;
  platformHandle: string;
  platformUrl: string;
  isPrimary: boolean;
};

export const CRM_IDENTITY_PLATFORMS = PLATFORMS;

export const platformLabels: Record<Platform, string> = {
  ...PLATFORM_SHORT_LABELS,
  x: "X / Twitter",
};

export function emptyDraftIdentity(platform: Platform = "x"): DraftContactIdentity {
  return {
    platform,
    platformUserId: "",
    platformHandle: "",
    platformUrl: "",
    isPrimary: false,
  };
}
