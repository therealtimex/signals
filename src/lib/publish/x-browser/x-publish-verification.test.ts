import { describe, expect, it } from "vitest";
import {
  buildTimelineSnapshotSignature,
  extractStatusIdFromHref,
  isStatusOwnedByHandle,
  selectNewOwnedStatus,
  statusIdToTimestampMs,
  TWITTER_EPOCH_MS,
} from "@/lib/publish/x-browser/x-publish-verification";

function timestampMsToStatusId(timestampMs: number): string {
  const delta = BigInt(timestampMs - TWITTER_EPOCH_MS);
  return (delta << 22n).toString();
}

describe("x-publish verification", () => {
  const handle = "@founder";
  const baselineWithOld = {
    statusIds: new Set(["111"]),
    timelineReady: true,
    snapshotComplete: true,
    maxStatusId: 111n,
    confirmedEmpty: false,
    capturedAtMs: Date.now() - 120_000,
  };

  it("builds a null signature when articles exist but status links are still loading", () => {
    expect(buildTimelineSnapshotSignature(2, false, [], [])).toBeNull();
  });

  it("builds a stable signature for a retweet-only loaded profile", () => {
    expect(
      buildTimelineSnapshotSignature(
        2,
        false,
        ["/otheruser/status/10", "/otheruser/status/20"],
        []
      )
    ).toBe("2|links:/otheruser/status/10,/otheruser/status/20|owned:");
  });

  it("builds a stable signature from owned status ids and all status links", () => {
    expect(
      buildTimelineSnapshotSignature(
        2,
        false,
        ["/founder/status/222", "/founder/status/111"],
        [
          { statusId: "222", href: "/founder/status/222", text: "b" },
          { statusId: "111", href: "/founder/status/111", text: "a" },
        ]
      )
    ).toBe("2|links:/founder/status/111,/founder/status/222|owned:111,222");
  });

  it("rejects an old owned duplicate already in the baseline", () => {
    const result = selectNewOwnedStatus(
      [
        {
          statusId: "111",
          href: "/founder/status/111",
          text: "hello world",
        },
      ],
      handle,
      "hello world",
      baselineWithOld
    );
    expect(result).toBeNull();
  });

  it("rejects when baseline timeline was not ready", () => {
    const result = selectNewOwnedStatus(
      [
        {
          statusId: "222",
          href: "/founder/status/222",
          text: "hello world",
        },
      ],
      handle,
      "hello world",
      {
        statusIds: new Set(),
        timelineReady: false,
        snapshotComplete: false,
        maxStatusId: 0n,
        confirmedEmpty: false,
        capturedAtMs: Date.now(),
      }
    );
    expect(result).toBeNull();
  });

  it("rejects a matching quote from another author", () => {
    const result = selectNewOwnedStatus(
      [
        {
          statusId: "222",
          href: "/otheruser/status/222",
          text: "hello world",
        },
      ],
      handle,
      "hello world",
      {
        statusIds: new Set(),
        timelineReady: true,
        snapshotComplete: true,
        maxStatusId: 0n,
        confirmedEmpty: false,
        capturedAtMs: Date.now(),
      }
    );
    expect(result).toBeNull();
  });

  it("rejects an old duplicate that appears after an incomplete baseline read", () => {
    const oldStatusId = "1288834974657";
    expect(statusIdToTimestampMs(oldStatusId)).toBeLessThan(Date.now() - 3_600_000);

    const result = selectNewOwnedStatus(
      [
        {
          statusId: oldStatusId,
          href: `/founder/status/${oldStatusId}`,
          text: "hello world",
        },
      ],
      handle,
      "hello world",
      {
        statusIds: new Set(),
        timelineReady: true,
        snapshotComplete: false,
        maxStatusId: 0n,
        confirmedEmpty: false,
        capturedAtMs: Date.now(),
      }
    );
    expect(result).toBeNull();
  });

  it("rejects a recent duplicate after an incomplete snapshot", () => {
    const thirtySecondsAgo = Date.now() - 30_000;
    const recentStatusId = timestampMsToStatusId(thirtySecondsAgo);

    const result = selectNewOwnedStatus(
      [
        {
          statusId: recentStatusId,
          href: `/founder/status/${recentStatusId}`,
          text: "hello world",
        },
      ],
      handle,
      "hello world",
      {
        statusIds: new Set(),
        timelineReady: true,
        snapshotComplete: false,
        maxStatusId: 0n,
        confirmedEmpty: false,
        capturedAtMs: Date.now(),
      }
    );
    expect(result).toBeNull();
  });

  it("rejects a recent pre-existing status missing from a partial nonempty baseline", () => {
    const capturedAtMs = Date.now();
    const thirtySecondsAgo = Date.now() - 30_000;
    const recentStatusId = timestampMsToStatusId(thirtySecondsAgo);
    expect(statusIdToTimestampMs(recentStatusId)).toBeLessThan(capturedAtMs);

    const result = selectNewOwnedStatus(
      [
        {
          statusId: recentStatusId,
          href: `/founder/status/${recentStatusId}`,
          text: "hello world",
        },
      ],
      handle,
      "hello world",
      {
        statusIds: new Set(["111"]),
        timelineReady: true,
        snapshotComplete: true,
        maxStatusId: 111n,
        confirmedEmpty: false,
        capturedAtMs,
      }
    );
    expect(result).toBeNull();
  });

  it("rejects verification when the snapshot was not complete", () => {
    const result = selectNewOwnedStatus(
      [
        {
          statusId: "9999999999999999999",
          href: "/founder/status/9999999999999999999",
          text: "hello world",
        },
      ],
      handle,
      "hello world",
      {
        statusIds: new Set(),
        timelineReady: true,
        snapshotComplete: false,
        maxStatusId: 0n,
        confirmedEmpty: false,
        capturedAtMs: Date.now() - 120_000,
      }
    );
    expect(result).toBeNull();
  });

  it("accepts a new owned status on a complete zero-owned baseline", () => {
    const capturedAtMs = Date.now() - 5_000;
    const newStatusId = timestampMsToStatusId(Date.now());

    const result = selectNewOwnedStatus(
      [
        {
          statusId: newStatusId,
          href: `/founder/status/${newStatusId}`,
          text: "hello world from signals",
        },
      ],
      handle,
      "hello world",
      {
        statusIds: new Set(),
        timelineReady: true,
        snapshotComplete: true,
        maxStatusId: 0n,
        confirmedEmpty: false,
        capturedAtMs,
      }
    );

    expect(result).toEqual({
      success: true,
      platformPostId: newStatusId,
      platformUrl: `https://x.com/founder/status/${newStatusId}`,
    });
  });

  it("rejects candidates with numeric ids at or below baseline max", () => {
    const result = selectNewOwnedStatus(
      [
        {
          statusId: "100",
          href: "/founder/status/100",
          text: "hello world",
        },
      ],
      handle,
      "hello world",
      {
        statusIds: new Set(["200"]),
        timelineReady: true,
        snapshotComplete: true,
        maxStatusId: 200n,
        confirmedEmpty: false,
        capturedAtMs: Date.now(),
      }
    );
    expect(result).toBeNull();
  });

  it("accepts a new owned status with matching text created after baseline capture", () => {
    const result = selectNewOwnedStatus(
      [
        {
          statusId: "9999999999999999999",
          href: "/founder/status/9999999999999999999",
          text: "hello world from signals",
        },
      ],
      handle,
      "hello world",
      baselineWithOld
    );
    expect(result).toEqual({
      success: true,
      platformPostId: "9999999999999999999",
      platformUrl: "https://x.com/founder/status/9999999999999999999",
    });
  });

  it("parses owned status URLs", () => {
    expect(extractStatusIdFromHref("/founder/status/99")).toBe("99");
    expect(isStatusOwnedByHandle("/founder/status/99", "@founder")).toBe(true);
    expect(isStatusOwnedByHandle("/other/status/99", "@founder")).toBe(false);
  });
});
