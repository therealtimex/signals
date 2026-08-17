import { describe, expect, it } from "vitest";
import {
  actionNeedsPlatformConnection,
  getActionRunButtonLabel,
} from "@/app/dashboard/workflows/action-cards-utils";

describe("action-cards utils", () => {
  it("does not require X connection for RTX enrich actions when disconnected", () => {
    expect(
      actionNeedsPlatformConnection("x-enrich", "api", false, false)
    ).toBe(false);
    expect(
      actionNeedsPlatformConnection("x-enrich-low", "api", false, false)
    ).toBe(false);
  });

  it("still requires connection for other X sync actions when disconnected", () => {
    expect(
      actionNeedsPlatformConnection("x-sync-posts", "api", false, false)
    ).toBe(true);
    expect(
      actionNeedsPlatformConnection("x-sync-posts", "api", true, false)
    ).toBe(false);
  });

  it("shows RTX steps label for enrich actions without a connection gate", () => {
    expect(
      getActionRunButtonLabel("x-enrich", {
        needsConnection: false,
        hasRestriction: false,
        isRunning: false,
      })
    ).toBe("Show RTX steps");
    expect(
      getActionRunButtonLabel("x-sync-posts", {
        needsConnection: true,
        hasRestriction: false,
        isRunning: false,
      })
    ).toBe("Connect first");
  });

  it("does not require connection for upload actions", () => {
    expect(
      actionNeedsPlatformConnection("li-import-csv", "upload", false, false)
    ).toBe(false);
  });

  it("labels upload cards by import history", () => {
    expect(
      getActionRunButtonLabel("li-import-csv", {
        needsConnection: false,
        hasRestriction: false,
        isRunning: false,
        isUpload: true,
        hasImportHistory: false,
      })
    ).toBe("Upload export");
    expect(
      getActionRunButtonLabel("li-import-csv", {
        needsConnection: false,
        hasRestriction: false,
        isRunning: false,
        isUpload: true,
        hasImportHistory: true,
      })
    ).toBe("Import again");
  });
});
