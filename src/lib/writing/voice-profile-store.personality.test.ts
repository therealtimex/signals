import { beforeEach, describe, expect, it } from "vitest";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { createContact } from "@/lib/db/queries/contacts";
import { upsertLaunch } from "@/lib/db/queries/launches";
import { resetCoreTables } from "@/test/db";
import {
  approveVoiceProfile,
  getActiveVoiceProfileFor,
  listUnclaimedVoiceProfiles,
  resolveActiveVoiceProfileContext,
  upsertVoiceProfile,
} from "@/lib/writing/voice-profile-store";

function profile(id: string, ownerContactId: string | null) {
  return {
    schemaVersion: 1 as const,
    id,
    label: "Primary",
    ownerContactId,
    platforms: ["x" as const],
    samples: [0, 1, 2].map((index) => ({
      id: `vs_${id.slice(3)}${index}`,
      text: `Original self-authored line ${index}`,
      source: { kind: "pasted" as const, pastedAt: 10 + index },
      authorship: "self" as const,
      approved: true,
    })),
    fingerprint: {
      sentenceLength: { medianWords: 5, range: [2, 8] as [number, number] },
      openers: [],
      closers: [],
      punctuation: [],
      vocabulary: { keep: [], avoid: [] },
      formats: [],
      emoji: "none" as const,
      hashtags: "none" as const,
      protectedQuirks: [],
      taboo: [],
    },
    signatureLines: [{ text: "self-authored", sampleId: `vs_${id.slice(3)}0` }],
    derivedBy: { method: "manual" as const, at: 20 },
  };
}

async function approve(input: ReturnType<typeof profile>) {
  const created = await upsertVoiceProfile(input);
  return approveVoiceProfile({
    id: created.profile.id,
    version: created.profile.version,
    evidence: { kind: "api", caller: "personality-test" },
  });
}

describe("voice profile Personality ownership", () => {
  beforeEach(() => resetCoreTables());

  it("never falls back to another or null owner", async () => {
    await approve(profile("vp_unclaimed1", null));
    const self = createContact({ name: "Self", isSelf: true });
    await approve(profile("vp_foreign01", "another-contact"));

    expect(getActiveVoiceProfileFor({ ownerContactId: self.id })).toBeNull();
    expect(getActiveVoiceProfileFor({ ownerContactId: null })).toBeNull();
    expect(listUnclaimedVoiceProfiles()).toEqual([
      expect.objectContaining({ id: "vp_unclaimed1", version: 1 }),
    ]);
    expect(resolveActiveVoiceProfileContext(self.id)).toMatchObject({
      status: "unclaimed_only",
      profile: null,
      candidates: [expect.objectContaining({ id: "vp_unclaimed1" })],
    });
  });

  it("reports none without a self contact even when unclaimed profiles exist", async () => {
    await approve(profile("vp_unclaimed1", null));
    expect(resolveActiveVoiceProfileContext()).toEqual({
      status: "none",
      profile: null,
      candidates: [],
      unclaimed: [],
      ambiguous: false,
    });
  });

  it("surfaces unclaimed_only through get_writing_context", async () => {
    await approve(profile("vp_unclaimed1", null));
    createContact({ name: "Self", isSelf: true });
    const launch = upsertLaunch({ name: "Personality voice context" });

    await expect(invokeAgentTool("get_writing_context", {
      launchId: launch.id,
    })).resolves.toMatchObject({
      voiceProfile: null,
      voice: {
        status: "unclaimed_only",
        candidates: [expect.objectContaining({ id: "vp_unclaimed1" })],
      },
    });
  });
});
