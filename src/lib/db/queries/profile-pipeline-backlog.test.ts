import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact, archiveContact, updateContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { logInteraction } from "@/lib/db/queries/interactions";
import { upsertPersona } from "@/lib/db/queries/personas";
import {
  AVATAR_ENRICH_RETRY_SECONDS,
  countProfilePipelineBacklog,
  PIPELINE_PLANNERS,
  planProfilePipelineRun,
  ProfilePipelineValidationError,
  PROFILE_PIPELINE_MAX_BATCH,
} from "@/lib/db/queries/profile-pipeline-backlog";
import { PERSONA_STALE_AFTER_SECONDS } from "@/lib/persona/staleness";
import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contactPersonas,
  contacts,
  contentItems,
  contentPosts,
  platformAccounts,
} from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

type FixtureContact = {
  id: string;
  enrichmentScore: number;
  updatedAt: number;
  kind: "profiled" | "avatar-only" | "persona-only" | "both" | "stale-only" | "edge";
};

type ProfilePipelineFixture = {
  profiled: FixtureContact[];
  backlog: FixtureContact[];
  staleOnly: FixtureContact[];
  edges: {
    archivedBacklogLike: string;
    selfContact: string;
    platformActor: string;
    insufficientEvidence: string;
    exhaustedAvatar: string;
    localOnlyPersona: string;
  };
};

function seedPlatformAccount() {
  const id = nanoid();
  db.insert(platformAccounts)
    .values({ id, platform: "x", displayName: "@brand", authType: "oauth" })
    .run();
  return id;
}

function seedActiveIdentity(
  contactId: string,
  opts?: { avatarUrl?: string | null; platform?: "x" | "linkedin" },
) {
  return createIdentity({
    contactId,
    platform: opts?.platform ?? "x",
    platformUserId: nanoid(),
    platformHandle: `handle-${nanoid(6)}`,
    isActive: 1,
    avatarUrl: opts?.avatarUrl ?? null,
  });
}

function seedSharedPersona(contactId: string, generatedAt?: number) {
  upsertPersona({
    contactId,
    archetype: "Founder",
    tone: "Direct",
    summary: "Summary",
    scope: "shared",
  });
  if (generatedAt != null) {
    db.update(contactPersonas)
      .set({ generatedAt })
      .where(eq(contactPersonas.contactId, contactId))
      .run();
  }
}

function seedEvidence(contactId: string) {
  const now = Math.floor(Date.now() / 1000);
  const itemId = nanoid();
  db.insert(contentItems)
    .values({
      id: itemId,
      contactId,
      contentType: "post",
      title: "Post",
      body: "Public content",
      status: "published",
    })
    .run();
  db.insert(contentPosts)
    .values({
      id: nanoid(),
      contentItemId: itemId,
      platformAccountId: seedPlatformAccount(),
      publishedAt: now,
      status: "published",
    })
    .run();
}

function setContactOrdering(contactId: string, enrichmentScore: number, updatedAt: number) {
  db.update(contacts)
    .set({ enrichmentScore, updatedAt })
    .where(eq(contacts.id, contactId))
    .run();
}

function seedProfiledContact(index: number): FixtureContact {
  const contact = createContact({
    name: `Profiled ${index}`,
    platform: "x",
    platformUserId: nanoid(),
  });
  seedActiveIdentity(contact.id, { avatarUrl: "https://example.com/avatar.jpg" });
  seedSharedPersona(contact.id);
  const enrichmentScore = 10_000 + index;
  const updatedAt = 20_000 + index;
  setContactOrdering(contact.id, enrichmentScore, updatedAt);
  return { id: contact.id, enrichmentScore, updatedAt, kind: "profiled" };
}

function seedAvatarOnlyBacklog(index: number): FixtureContact {
  const contact = createContact({
    name: `Avatar Only ${index}`,
    platform: "x",
    platformUserId: nanoid(),
  });
  seedActiveIdentity(contact.id, { avatarUrl: null });
  seedSharedPersona(contact.id);
  const enrichmentScore = index;
  const updatedAt = 1_000 + index;
  setContactOrdering(contact.id, enrichmentScore, updatedAt);
  return { id: contact.id, enrichmentScore, updatedAt, kind: "avatar-only" };
}

function seedPersonaOnlyBacklog(index: number): FixtureContact {
  const contact = createContact({
    name: `Persona Only ${index}`,
    platform: "x",
    platformUserId: nanoid(),
  });
  seedActiveIdentity(contact.id, { avatarUrl: "https://example.com/avatar.jpg" });
  seedEvidence(contact.id);
  const enrichmentScore = index;
  const updatedAt = 1_000 + index;
  setContactOrdering(contact.id, enrichmentScore, updatedAt);
  return { id: contact.id, enrichmentScore, updatedAt, kind: "persona-only" };
}

function seedBothBacklog(index: number): FixtureContact {
  const contact = createContact({
    name: `Both ${index}`,
    platform: "x",
    platformUserId: nanoid(),
  });
  seedActiveIdentity(contact.id, { avatarUrl: null });
  seedEvidence(contact.id);
  const enrichmentScore = index;
  const updatedAt = 1_000 + index;
  setContactOrdering(contact.id, enrichmentScore, updatedAt);
  return { id: contact.id, enrichmentScore, updatedAt, kind: "both" };
}

function seedStaleOnly(index: number, now: number): FixtureContact {
  const contact = createContact({
    name: `Stale ${index}`,
    platform: "x",
    platformUserId: nanoid(),
  });
  seedActiveIdentity(contact.id, { avatarUrl: "https://example.com/avatar.jpg" });
  seedSharedPersona(contact.id, now - PERSONA_STALE_AFTER_SECONDS - 10);
  const enrichmentScore = 50_000 + index;
  const updatedAt = 50_000 + index;
  setContactOrdering(contact.id, enrichmentScore, updatedAt);
  return { id: contact.id, enrichmentScore, updatedAt, kind: "stale-only" };
}

/** 700 universe / 300 backlog / batch-20 fixture per spec §12. */
export function buildProfilePipelineFixture(now = Math.floor(Date.now() / 1000)): ProfilePipelineFixture {
  const profiled = Array.from({ length: 400 }, (_, index) => seedProfiledContact(index));
  const avatarOnly = Array.from({ length: 100 }, (_, index) => seedAvatarOnlyBacklog(index));
  const personaOnly = Array.from({ length: 100 }, (_, index) =>
    seedPersonaOnlyBacklog(100 + index),
  );
  const both = Array.from({ length: 100 }, (_, index) => seedBothBacklog(200 + index));
  const staleOnly = Array.from({ length: 50 }, (_, index) => seedStaleOnly(index, now));
  const backlog = [...avatarOnly, ...personaOnly, ...both];

  const archived = createContact({
    name: "Archived Backlog",
    platform: "x",
    platformUserId: nanoid(),
  });
  seedActiveIdentity(archived.id, { avatarUrl: null });
  seedEvidence(archived.id);
  archiveContact(archived.id, "test");

  const selfContact = createContact({
    name: "Self",
    platform: "x",
    platformUserId: nanoid(),
    isSelf: true,
  });
  seedActiveIdentity(selfContact.id, { avatarUrl: null });
  seedEvidence(selfContact.id);

  const platformActor = createContact({
    name: "Platform Actor",
    platform: "x",
    platformUserId: nanoid(),
    metadata: JSON.stringify({ platformActor: 1 }),
  });
  seedActiveIdentity(platformActor.id, { avatarUrl: null });
  seedEvidence(platformActor.id);

  const insufficientEvidence = createContact({
    name: "Insufficient Evidence",
    platform: "x",
    platformUserId: nanoid(),
  });

  const exhaustedAvatar = createContact({
    name: "Exhausted Avatar",
    platform: "x",
    platformUserId: nanoid(),
    metadata: JSON.stringify({
      avatarEnrich: { exhaustedAt: now - 60 },
    }),
  });
  seedActiveIdentity(exhaustedAvatar.id, { avatarUrl: null });
  seedSharedPersona(exhaustedAvatar.id);

  const localOnlyPersona = createContact({
    name: "Local Only Persona",
    platform: "x",
    platformUserId: nanoid(),
  });
  seedActiveIdentity(localOnlyPersona.id, { avatarUrl: "https://example.com/avatar.jpg" });
  upsertPersona({
    contactId: localOnlyPersona.id,
    archetype: "Local",
    scope: "local_only",
  });

  return {
    profiled,
    backlog,
    staleOnly,
    edges: {
      archivedBacklogLike: archived.id,
      selfContact: selfContact.id,
      platformActor: platformActor.id,
      insufficientEvidence: insufficientEvidence.id,
      exhaustedAvatar: exhaustedAvatar.id,
      localOnlyPersona: localOnlyPersona.id,
    },
  };
}

function expectedBacklogOrder(backlog: FixtureContact[]): string[] {
  return [...backlog]
    .sort((left, right) => {
      if (left.enrichmentScore !== right.enrichmentScore) {
        return left.enrichmentScore - right.enrichmentScore;
      }
      if (left.updatedAt !== right.updatedAt) {
        return left.updatedAt - right.updatedAt;
      }
      return left.id.localeCompare(right.id);
    })
    .map((row) => row.id);
}

describe("profile pipeline backlog", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("exports constants and planner registry", () => {
    expect(AVATAR_ENRICH_RETRY_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(PROFILE_PIPELINE_MAX_BATCH).toBe(50);
    expect(PIPELINE_PLANNERS.contact_profile.countBacklog).toBe(countProfilePipelineBacklog);
    expect(PIPELINE_PLANNERS.contact_profile.planRun).toBe(planProfilePipelineRun);
  });

  it("counts 300 backlog contacts and plans batch 20 in enrichment order", () => {
    const fixture = buildProfilePipelineFixture();
    expect(countProfilePipelineBacklog()).toBe(300);

    const plan = planProfilePipelineRun({ batchSize: 20 });
    expect(plan.backlogTotal).toBe(300);
    expect(plan.batchSize).toBe(20);
    expect(plan.explicit).toBe(false);
    expect(plan.selectedContactIds).toHaveLength(20);
    expect(plan.selectedContactIds).toEqual(expectedBacklogOrder(fixture.backlog).slice(0, 20));
    expect(plan.orderBy).toBe("enrichmentScore ASC, updatedAt ASC, id ASC");
    expect(plan.filters).toEqual({
      needsAvatar: true,
      needsPersona: true,
      personaStale: false,
    });
  });

  it("narrows backlog with platform, maxEnrichmentScore, and flag toggles", () => {
    const fixture = buildProfilePipelineFixture();

    const maxScore = fixture.backlog[fixture.backlog.length - 1]!.enrichmentScore;
    expect(countProfilePipelineBacklog({ maxEnrichmentScore: maxScore - 1 })).toBe(
      fixture.backlog.filter((row) => row.enrichmentScore <= maxScore - 1).length,
    );

    expect(countProfilePipelineBacklog({ needsAvatar: true, needsPersona: false })).toBe(200);
    expect(countProfilePipelineBacklog({ needsAvatar: false, needsPersona: true })).toBe(200);
    expect(
      countProfilePipelineBacklog({
        needsAvatar: false,
        needsPersona: false,
        personaStale: true,
      }),
    ).toBe(50);

    const linkedinOnly = createContact({
      name: "LinkedIn Backlog",
      platform: "linkedin",
      platformUserId: nanoid(),
    });
    seedActiveIdentity(linkedinOnly.id, { avatarUrl: null, platform: "linkedin" });
    seedEvidence(linkedinOnly.id);
    setContactOrdering(linkedinOnly.id, maxScore + 1, 1);

    expect(countProfilePipelineBacklog({ platform: "linkedin" })).toBe(1);
  });

  it("never selects archived, self, or platformActor contacts", () => {
    const fixture = buildProfilePipelineFixture();
    const plan = planProfilePipelineRun({ batchSize: PROFILE_PIPELINE_MAX_BATCH });
    const excluded = new Set([
      fixture.edges.archivedBacklogLike,
      fixture.edges.selfContact,
      fixture.edges.platformActor,
    ]);
    for (const contactId of plan.selectedContactIds) {
      expect(excluded.has(contactId)).toBe(false);
    }
    expect(countProfilePipelineBacklog()).toBe(300);
  });

  it("excludes cleared contacts on the second plan", () => {
    buildProfilePipelineFixture();
    const firstPlan = planProfilePipelineRun({ batchSize: 20 });
    const clearedCount = 5;

    for (const contactId of firstPlan.selectedContactIds.slice(0, clearedCount)) {
      const identity = db
        .select()
        .from(contactIdentities)
        .where(eq(contactIdentities.contactId, contactId))
        .get();
      if (identity) {
        db.update(contactIdentities)
          .set({ avatarUrl: "https://example.com/cleared.jpg" })
          .where(eq(contactIdentities.id, identity.id))
          .run();
      }
      seedSharedPersona(contactId);
    }

    expect(countProfilePipelineBacklog()).toBe(300 - clearedCount);
    const secondPlan = planProfilePipelineRun({ batchSize: 20 });
    for (const contactId of firstPlan.selectedContactIds.slice(0, clearedCount)) {
      expect(secondPlan.selectedContactIds).not.toContain(contactId);
    }
  });

  it("supports explicit mode and rejects unknown or archived ids", () => {
    const fixture = buildProfilePipelineFixture();
    const targetId = fixture.backlog[0]!.id;

    const plan = planProfilePipelineRun({ contactIds: [targetId] });
    expect(plan.explicit).toBe(true);
    expect(plan.backlogTotal).toBe(1);
    expect(plan.batchSize).toBe(1);
    expect(plan.selectedContactIds).toEqual([targetId]);

    expect(() =>
      planProfilePipelineRun({ contactIds: [fixture.edges.archivedBacklogLike] }),
    ).toThrow(ProfilePipelineValidationError);
    expect(() => planProfilePipelineRun({ contactIds: ["missing-id"] })).toThrow(
      ProfilePipelineValidationError,
    );
  });

  it("keeps loop-unsafe contacts out of the backlog predicates", () => {
    const now = Math.floor(Date.now() / 1000);
    const fixture = buildProfilePipelineFixture(now);

    expect(countProfilePipelineBacklog()).toBe(300);
    expect(
      countProfilePipelineBacklog({
        needsAvatar: false,
        needsPersona: true,
      }),
    ).toBe(200);
    expect(
      countProfilePipelineBacklog({
        needsAvatar: true,
        needsPersona: false,
      }),
    ).toBe(200);

    expect(
      countProfilePipelineBacklog({
        needsAvatar: false,
        needsPersona: true,
      }),
    ).toBe(200);
    updateContact(fixture.edges.insufficientEvidence, {
      metadata: JSON.stringify({}),
    });
    expect(
      countProfilePipelineBacklog({
        needsAvatar: false,
        needsPersona: true,
      }),
    ).toBe(200);

    expect(
      countProfilePipelineBacklog({
        needsAvatar: true,
        needsPersona: false,
      }),
    ).toBe(200);
    const avatarOnlyPlan = planProfilePipelineRun({
      batchSize: 200,
      filters: { needsAvatar: true, needsPersona: false },
    });
    expect(avatarOnlyPlan.selectedContactIds).not.toContain(fixture.edges.exhaustedAvatar);

    const staleExhausted = createContact({
      name: "Stale Exhausted",
      platform: "x",
      platformUserId: nanoid(),
      metadata: JSON.stringify({
        avatarEnrich: { exhaustedAt: now - AVATAR_ENRICH_RETRY_SECONDS - 10 },
      }),
    });
    seedActiveIdentity(staleExhausted.id, { avatarUrl: null });
    seedSharedPersona(staleExhausted.id);
    expect(countProfilePipelineBacklog({ needsAvatar: true, needsPersona: false })).toBe(201);

    expect(
      countProfilePipelineBacklog({
        needsAvatar: false,
        needsPersona: true,
      }),
    ).toBe(200);
    upsertPersona({
      contactId: fixture.edges.localOnlyPersona,
      archetype: "Local",
      scope: "local_only",
    });
    expect(
      countProfilePipelineBacklog({
        needsAvatar: false,
        needsPersona: true,
      }),
    ).toBe(200);
  });

  it("clamps batch size to PROFILE_PIPELINE_MAX_BATCH", () => {
    buildProfilePipelineFixture();
    const plan = planProfilePipelineRun({ batchSize: 999 });
    expect(plan.batchSize).toBe(PROFILE_PIPELINE_MAX_BATCH);
    expect(plan.selectedContactIds).toHaveLength(PROFILE_PIPELINE_MAX_BATCH);
  });
});
