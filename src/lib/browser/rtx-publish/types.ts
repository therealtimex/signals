export type {
  PublishMode,
  PublishErrorCode,
  PublishRequest,
  PublishResult,
} from "@/lib/browser/publishers/types";

export { PublishError } from "@/lib/browser/publishers/types";

/** RTX Browser session reference for CDP attach. */
import type { BrowserTabRecord } from "@/lib/browser/rtx-publish/desktop-browser-client";

export type RtxBrowserSessionRef = {
  sessionName: string;
  remoteDebugPort: number;
  contentTabUrl?: string;
  tabs?: BrowserTabRecord[];
  selectedTabRef?: string;
  selectedHandle?: string;
};

/** Publish result with ensured platform account for X RTX path. */
export type XPublishRtxResult = import("@/lib/browser/publishers/types").PublishResult & {
  platformAccountId?: string;
};
