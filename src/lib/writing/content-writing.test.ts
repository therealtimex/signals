import { describe, expect, it } from "vitest";
import {
  buildWritingUnits,
  contentWritingSchema,
  deriveWritingPublishText,
  mergeContentWriting,
  readContentWriting,
  writingUnitsSchema,
} from "@/lib/writing/content-writing";

describe("content writing metadata", () => {
  const writing = {
    schemaVersion: 1 as const,
    idempotencyKey: "draft-1",
    surface: "x/thread" as const,
    capability: { publish: "direct" as const },
    units: buildWritingUnits(["A", "B", "C"]),
    extension: { keep: true },
  };

  it("validates ordered-unit invariants", () => {
    expect(writingUnitsSchema.safeParse({ texts: ["A"], count: 2, chars: [1] }).success).toBe(
      false,
    );
    expect(writingUnitsSchema.safeParse({ texts: ["A"], count: 1, chars: [2] }).success).toBe(
      false,
    );
    expect(contentWritingSchema.parse(writing).extension).toEqual({ keep: true });
  });

  it("read-merge-writes without clobbering platform or unknown writing fields", () => {
    const platformData = JSON.stringify({ platformUrl: "https://x.test/1", writing });
    const merged = mergeContentWriting(platformData, {
      units: buildWritingUnits(["Revised", "B"]),
    });
    expect(JSON.parse(merged)).toMatchObject({
      platformUrl: "https://x.test/1",
      writing: { extension: { keep: true }, units: { texts: ["Revised", "B"] } },
    });
    expect(readContentWriting({ platformData: merged })?.units.texts).toEqual(["Revised", "B"]);
  });

  it("projects ordered X threads but never emits continuations for another platform", () => {
    expect(
      deriveWritingPublishText(writing, { contentType: "thread", platformTarget: "x" }),
    ).toEqual({ text: "A", threadTexts: ["B", "C"] });
    expect(
      deriveWritingPublishText(writing, { contentType: "thread", platformTarget: "threads" }),
    ).toEqual({ text: "A" });
  });
});
