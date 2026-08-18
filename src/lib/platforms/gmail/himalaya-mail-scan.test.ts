import { describe, expect, it } from "vitest";
import {
  computeNextScanCursor,
  normalizePersistedScanCursor,
} from "@/lib/platforms/gmail/himalaya-mail-scan";

describe("computeNextScanCursor", () => {
  const folderCount = 2;

  it("advances page when more envelopes remain under the cap", () => {
    expect(
      computeNextScanCursor(
        { folderIndex: 0, page: 3 },
        { folderCount, scanned: 100, maxEnvelopes: 500, hasMore: true, folderExhausted: false }
      )
    ).toEqual({ folderIndex: 0, page: 4 });
  });

  it("keeps cursor when the envelope cap is hit mid-folder", () => {
    expect(
      computeNextScanCursor(
        { folderIndex: 0, page: 10 },
        { folderCount, scanned: 500, maxEnvelopes: 500, hasMore: true, folderExhausted: false }
      )
    ).toEqual({ folderIndex: 0, page: 10 });
  });

  it("moves to the next folder when a folder is exhausted", () => {
    expect(
      computeNextScanCursor(
        { folderIndex: 0, page: 2 },
        { folderCount, scanned: 40, maxEnvelopes: 500, hasMore: false, folderExhausted: true }
      )
    ).toEqual({ folderIndex: 1, page: 1 });
  });

  it("marks cycle complete when the last folder finishes", () => {
    expect(
      computeNextScanCursor(
        { folderIndex: 1, page: 1 },
        { folderCount, scanned: 80, maxEnvelopes: 500, hasMore: false, folderExhausted: false }
      )
    ).toEqual({ folderIndex: folderCount, page: 1 });
  });
});

describe("normalizePersistedScanCursor", () => {
  it("wraps completed cycles back to the first folder", () => {
    expect(normalizePersistedScanCursor({ folderIndex: 2, page: 1 }, 2)).toEqual({
      folderIndex: 0,
      page: 1,
    });
  });
});
