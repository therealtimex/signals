export const PERSONALITY_ONBOARDING_MAX_BRIEF_CHARS = 18_000;
export const PERSONALITY_ONBOARDING_MAX_FILES = 12;
export const PERSONALITY_ONBOARDING_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const PERSONALITY_ONBOARDING_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const PERSONALITY_ONBOARDING_ACCEPT = [
  ".txt",
  ".md",
  ".markdown",
  ".pdf",
  ".doc",
  ".docx",
  ".rtf",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
] as const;

export const OPEN_PERSONALITY_ONBOARDING_EVENT =
  "signals:open-personality-onboarding";
export const PERSONALITY_ONBOARDING_SENT_EVENT =
  "signals:personality-onboarding-sent";

export type PersonalityOnboardingState = {
  success: true;
  workspace: {
    id: string | null;
    slug: string;
    displayName: string;
    path: string;
  };
  personality: {
    present: boolean;
    files: string[];
  };
  editor: {
    state: "available" | "not_granted" | "unsupported" | "unreachable";
    version: number | null;
    reason?: string;
    limits: {
      maxTaskPromptChars: number;
      maxAttachmentCount: number;
      maxAttachmentBytes: number;
      maxTotalAttachmentBytes: number;
    } | null;
  };
  shouldOnboard: boolean;
};
