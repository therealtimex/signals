import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { createIdentity } from "@/lib/db/queries/identities";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { createOrgIdentity } from "@/lib/db/queries/org-identities";
import { createOrg } from "@/lib/db/queries/orgs";
import { contacts, orgDomains, orgEmailPatterns, orgs } from "@/lib/db/schema";
import { renderPersonalityBlocks } from "@/lib/personality/render";
import { buildSourceSnapshot, computeSourceHash } from "@/lib/personality/snapshot";
import {
  loadPersonalitySourceBundle,
  loadPersonalitySources,
} from "@/lib/personality/sources";
import { upsertPersonalityStatements } from "@/lib/personality/statements";
import { setRepresentedOrgId } from "@/lib/settings/signals-config";
import { resetCoreTables } from "@/test/db";
import {
  approveVoiceProfile,
  upsertVoiceProfile,
} from "@/lib/writing/voice-profile-store";

const SENTINEL = "SENTINEL_PRIVATE_FIELD";

function voiceProfile(ownerContactId: string) {
  return {
    schemaVersion: 1 as const,
    id: "vp_personality1",
    label: "Primary",
    ownerContactId,
    platforms: ["x" as const],
    samples: [0, 1, 2].map((index) => ({
      id: `vs_personality${index}`,
      text: `A real approved line ${index}`,
      source: { kind: "pasted" as const, pastedAt: 10 + index },
      authorship: "self" as const,
      approved: true,
    })),
    fingerprint: {
      sentenceLength: { medianWords: 6, range: [3, 10] as [number, number] },
      openers: ["Plainly"],
      closers: [],
      punctuation: ["periods"],
      vocabulary: { keep: ["ship"], avoid: ["leverage"] },
      formats: ["short post"],
      emoji: "rare" as const,
      hashtags: "none" as const,
      protectedQuirks: ["fragments"],
      taboo: ["hype"],
    },
    signatureLines: [{ text: "approved line", sampleId: "vs_personality0" }],
    brand: { notes: SENTINEL },
    derivedBy: { method: "manual" as const, at: 20 },
  };
}

async function representedFixture() {
  const self = createContact({
    name: "Ada Lovelace",
    isSelf: true,
    tags: JSON.stringify([SENTINEL]),
    metadata: JSON.stringify({ privateNotes: SENTINEL }),
    funnelStage: "customer",
    channels: [
      { channelType: "email", value: `${SENTINEL}@example.com`, scope: "local_only" },
      { channelType: "phone", value: `+1-${SENTINEL}`, scope: "local_only" },
    ],
  });
  createIdentity({
    contactId: self.id,
    platform: "x",
    platformUserId: "ada-public",
    platformHandle: "ada",
    platformUrl: "https://x.example/ada",
    displayName: "Ada",
    headline: "Computing pioneer",
    bio: "Builder of analytical engines",
    websiteUrl: "https://ada.example",
    platformData: JSON.stringify({ privateEvidence: SENTINEL }),
    location: SENTINEL,
    syncErrors: SENTINEL,
    isPrimary: 1,
    isActive: 1,
  });
  const represented = createOrg({
    name: "Analytical Engines",
    domain: "engines.example",
    website: "https://engines.example",
    description: "Mechanical computation",
    industry: "Software",
    companySize: "1-10",
    ownerContactId: self.id,
    accountStage: "customer",
    tags: [SENTINEL],
  });
  const localOnlyOrg = createOrg({
    name: SENTINEL,
    ownerContactId: self.id,
  });
  db.update(orgs)
    .set({ scope: "local_only", metadata: JSON.stringify({ private: SENTINEL }) })
    .where(eq(orgs.id, localOnlyOrg.id))
    .run();
  db.update(orgs)
    .set({ metadata: JSON.stringify({ fieldProvenance: SENTINEL }) })
    .where(eq(orgs.id, represented.id))
    .run();
  db.update(orgDomains)
    .set({ mxStatus: "ok", mailEvidence: JSON.stringify({ private: SENTINEL }) })
    .where(eq(orgDomains.orgId, represented.id))
    .run();
  db.insert(orgEmailPatterns).values({
    id: "pattern-private",
    orgId: represented.id,
    pattern: SENTINEL,
    rank: 1,
    confidence: "high",
    score: 1,
    evidence: JSON.stringify([SENTINEL]),
    isSelected: true,
    source: "test",
    evaluatedAt: 1,
  }).run();
  createOrgIdentity({
    orgId: represented.id,
    platform: "linkedin",
    platformUserId: "engines-public",
    platformHandle: "engines",
    platformUrl: "https://linkedin.example/engines",
    displayName: "Analytical Engines",
    platformData: JSON.stringify({ private: SENTINEL }),
    location: SENTINEL,
    syncErrors: SENTINEL,
    isActive: 1,
  });
  updateContact(self.id, {
    employments: [
      {
        orgId: represented.id,
        title: "Founder",
        startedAt: 100,
        isCurrent: true,
        scope: "shared",
      },
      {
        orgId: localOnlyOrg.id,
        title: SENTINEL,
        startedAt: 200,
        isCurrent: true,
        scope: "local_only",
      },
    ],
  });
  const draft = await upsertVoiceProfile(voiceProfile(self.id));
  await approveVoiceProfile({
    id: draft.profile.id,
    version: draft.profile.version,
    evidence: { kind: "api", caller: "personality-test" },
  });
  await upsertPersonalityStatements({
    values: ["Build useful systems"],
    boundaries: ["Keep private data private"],
  });
  setRepresentedOrgId(represented.id);
  return { self, represented };
}

describe("personality represented source adapters", () => {
  beforeEach(() => {
    resetCoreTables();
    setRepresentedOrgId(null);
  });

  it("loads only the represented public allowlist and excludes private sentinels", async () => {
    await representedFixture();
    const bundle = loadPersonalitySourceBundle();
    const serialized = JSON.stringify(bundle.sources);
    const blocks = renderPersonalityBlocks(bundle.sources);

    expect(bundle.sources.identity).toMatchObject({
      name: "Ada Lovelace",
      currentRole: { title: "Founder", orgName: "Analytical Engines" },
      representedOrgName: "Analytical Engines",
    });
    expect(bundle.sources.brand).toMatchObject({
      name: "Analytical Engines",
      primaryDomain: { domain: "engines.example", verified: true },
      selfRelationshipTitle: "Founder",
    });
    expect(bundle.sources.voice?.profile).toMatchObject({ id: "vp_personality1", version: 1 });
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain("ownerContactId");
    expect(serialized).not.toContain("accountStage");
    expect(JSON.stringify(blocks)).not.toContain(SENTINEL);
    expect(blocks.identity.body).not.toContain("email");
    expect(blocks.identity.body).not.toContain("phone");
  });

  it("rejects foreign and missing represented organizations", async () => {
    const { represented } = await representedFixture();
    const foreign = createContact({ name: "Foreign" });
    db.update(orgs)
      .set({ ownerContactId: foreign.id })
      .where(eq(orgs.id, represented.id))
      .run();
    expect(() => loadPersonalitySources()).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        details: { reason: "org_not_represented" },
      }),
    );

    setRepresentedOrgId("missing-org");
    expect(() => loadPersonalitySources()).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        details: { reason: "org_not_represented" },
      }),
    );
  });

  it("requires the single isSelf contact and validates pinned voice ownership", async () => {
    const { self } = await representedFixture();
    db.update(contacts).set({ isSelf: false }).where(eq(contacts.id, self.id)).run();
    expect(() => loadPersonalitySources()).toThrow(
      expect.objectContaining({ code: "NOT_FOUND", details: { reason: "self_contact_missing" } }),
    );

    db.update(contacts).set({ isSelf: true }).where(eq(contacts.id, self.id)).run();
    expect(() => loadPersonalitySources({ voiceProfileId: "vp_missing01" })).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        details: { reason: "voice_not_self_owned" },
      }),
    );
  });

  it("keeps the source hash stable across a bare contact revision touch", async () => {
    const { self } = await representedFixture();
    const first = loadPersonalitySourceBundle();
    const firstSnapshot = buildSourceSnapshot(first.sources, first.revisions);
    db.update(contacts).set({ updatedAt: self.updatedAt + 10 }).where(eq(contacts.id, self.id)).run();
    const second = loadPersonalitySourceBundle();
    const secondSnapshot = buildSourceSnapshot(second.sources, second.revisions);

    expect(computeSourceHash(firstSnapshot)).toBe(computeSourceHash(secondSnapshot));
    expect(firstSnapshot.self.revision).not.toBe(secondSnapshot.self.revision);
  });
});
