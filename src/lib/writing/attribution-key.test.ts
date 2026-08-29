import { describe, expect, it } from "vitest";
import { deriveAttributionKey } from "@/lib/writing/attribution-key";
import type { VariantWriting } from "@/lib/writing/contracts";

const writing = {
  platform: "x",
  surface: "x/post",
  goal: "likes",
  formulaId: "x/post/test@1",
  overlay: { version: 2 },
  core: { version: 3 },
  voiceProfile: { id: "vp_profile1", version: 4 },
  targetId: "target",
} as VariantWriting;

describe("writing attribution key", () => {
  it("is deterministic and keeps platform, goal, and audience cohorts separate", () => {
    const input = { writing, nicheIds: ["b", "a", "a"], launchId: "launch", variantId: "variant", contentItemId: "item", contentPostId: "post" };
    const first = deriveAttributionKey(input);
    expect(first).toMatchObject({ platform: "x", goal: "likes", audienceCohort: "a+b", voiceProfileVersion: 4 });
    expect(deriveAttributionKey({ ...input, nicheIds: ["a", "b"] })).toEqual(first);
    expect(deriveAttributionKey({ ...input, writing: { ...writing, platform: "linkedin", surface: "linkedin/post" } })).not.toEqual(first);
  });
});
