import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { upsertPersona } from "@/lib/db/queries/personas";
import {
  AVATAR_ENRICH_RETRY_SECONDS,
  countProfilePipelineBacklog,
  PIPELINE_PLANNERS,
  planProfilePipelineRun,
  ProfilePipelineValidationError,
  PROFILE_PIPELINE_MAX_BATCH,
} from "@/lib/db/queries/profile-pipeline-backlog";
import { db } from "@/lib/db/client";
import { contactIdentities } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";
import {
  buildProfilePipelineFixture,
  type FixtureContact,
  seedActiveIdentity,
  seedEvidence,
  seedSharedPersona,
  setContactOrdering,
} from "@/test/profile-pipeline-fixture";

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

  it("counts an empty-string identity avatar as still needing one", () => {
    // The runtime uses a trimmed-truthy check, so `''` renders as initials. A bare IS NOT NULL in
    // the predicate would call that "has avatar" and strand the contact outside the backlog.
    const contact = createContact({ name: "Empty Avatar" });
    db.insert(contactIdentities)
      .values({
        id: nanoid(),
        contactId: contact.id,
        platform: "linkedin",
        platformUserId: "empty-avatar",
        avatarUrl: "",
        isPrimary: 1,
        isActive: 1,
      })
      .run();

    expect(countProfilePipelineBacklog({ needsAvatar: true, needsPersona: false })).toBe(1);

    db.update(contactIdentities)
      .set({ avatarUrl: "https://cdn.example/real.jpg" })
      .where(eq(contactIdentities.contactId, contact.id))
      .run();

    expect(countProfilePipelineBacklog({ needsAvatar: true, needsPersona: false })).toBe(0);
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
