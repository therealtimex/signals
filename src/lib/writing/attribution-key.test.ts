import { describe, expect, it } from "vitest";
import { attributionGroupKey, deriveAttributionKey } from "@/lib/writing/attribution-key";
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

  it("separates bound Personality cohorts and normalizes absent and null as legacy", () => {
    const input = { writing, nicheIds: [], launchId: "launch", variantId: "variant", contentItemId: "item", contentPostId: "post" };
    const legacy = deriveAttributionKey(input);
    const explicitNull = deriveAttributionKey({
      ...input,
      writing: { ...writing, personality: null },
    });
    const bound = (bindingId: string) => deriveAttributionKey({
      ...input,
      writing: {
        ...writing,
        personality: {
          schemaVersion: 1,
          bindingId,
          personalityHash: "a".repeat(64),
          bindingSourceHash: "b".repeat(64),
          workspaceSlug: "signals",
          workspaceId: null,
          workspaceKey: "workspace-key",
          identity: { selfContactId: "self", representedOrgId: null },
          target: null,
        },
      },
    });
    expect(attributionGroupKey(legacy)).toBe(attributionGroupKey(explicitNull));
    expect(attributionGroupKey(bound("pb_binding1"))).not.toBe(
      attributionGroupKey(bound("pb_binding2")),
    );
  });
});
