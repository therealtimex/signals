import { describe, expect, it } from "vitest";
import {
  deriveItemStatusFromJob,
  recomputeJobStatus,
} from "@/lib/publish/job-state";
import type { PublishJobTarget } from "@/lib/publish/types";

function targets(
  entries: Array<Partial<PublishJobTarget> & { platform: PublishJobTarget["platform"] }>
): PublishJobTarget[] {
  return entries.map((entry) => ({
    status: "pending",
    ...entry,
  }));
}

describe("publish job state machine", () => {
  it("starts queued when all targets are pending", () => {
    expect(
      recomputeJobStatus(
        targets([
          { platform: "x", status: "pending" },
          { platform: "linkedin", status: "pending" },
        ])
      )
    ).toBe("queued");
  });

  it("moves to publishing when any target is in flight", () => {
    expect(
      recomputeJobStatus(
        targets([
          { platform: "x", status: "published" },
          { platform: "linkedin", status: "publishing" },
        ])
      )
    ).toBe("publishing");
  });

  it("completes when all targets published", () => {
    const t = targets([
      { platform: "x", status: "published" },
      { platform: "linkedin", status: "published" },
    ]);
    expect(recomputeJobStatus(t)).toBe("completed");
    expect(deriveItemStatusFromJob("completed", t)).toBe("published");
  });

  it("partial when mixed published and failed", () => {
    const t = targets([
      { platform: "x", status: "published" },
      { platform: "linkedin", status: "failed" },
    ]);
    expect(recomputeJobStatus(t)).toBe("partial");
    expect(deriveItemStatusFromJob("partial", t)).toBe("published");
  });

  it("fails when every target failed", () => {
    const t = targets([
      { platform: "x", status: "failed" },
      { platform: "linkedin", status: "failed" },
    ]);
    expect(recomputeJobStatus(t)).toBe("failed");
    expect(deriveItemStatusFromJob("failed", t)).toBe("failed");
  });

  it("does not drive item status for superseded jobs", () => {
    expect(deriveItemStatusFromJob("superseded", [])).toBeNull();
  });
});
