import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { logInteraction } from "@/lib/db/queries/interactions";
import { projectPersonaInterestsToNiches } from "@/lib/db/queries/persona-niches";
import { ensureNicheByName } from "@/lib/db/queries/niches";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import {
  PersonaEvidenceError,
  PersonaScopeError,
  PersonaSynthesisError,
} from "@/lib/db/queries/persona-errors";
import {
  assemblePersonaEvidence,
  renderPersonaEvidencePrompt,
} from "@/lib/db/queries/persona-evidence";
import { upsertPersona } from "@/lib/db/queries/personas";
import { db } from "@/lib/db/client";
import {
  contentItems,
  contentPosts,
  platformAccounts,
  workflowRuns,
} from "@/lib/db/schema";
import { assertNoPrivacySentinels, PRIVACY_SENTINELS } from "@/test/privacy-sentinels";
import { resetCoreTables } from "@/test/db";

describe("assemblePersonaEvidence", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  function seedPlatformAccount() {
    const id = nanoid();
    db.insert(platformAccounts)
      .values({ id, platform: "x", displayName: "@brand", authType: "oauth" })
      .run();
    return id;
  }

  function seedPublishedContent(contactId: string, publishedAt: number) {
    const itemId = nanoid();
    db.insert(contentItems)
      .values({
        id: itemId,
        contactId,
        contentType: "post",
        title: "Launch post",
        body: "Public update about product",
        status: "published",
      })
      .run();
    db.insert(contentPosts)
      .values({
        id: nanoid(),
        contentItemId: itemId,
        platformAccountId: seedPlatformAccount(),
        publishedAt,
        status: "published",
      })
      .run();
    return itemId;
  }

  it("requires at least one evidence surface", () => {
    const contact = createContact({ name: "Empty", platform: "x", platformUserId: "empty-1" });
    expect(() => assemblePersonaEvidence(contact.id)).toThrow(PersonaEvidenceError);
  });

  it("never includes private CRM fields in the digest", () => {
    const contact = createContact({
      name: "Private CRM",
      platform: "x",
      platformUserId: "priv-1",
      email: PRIVACY_SENTINELS.email,
      phone: PRIVACY_SENTINELS.phone,
      tags: JSON.stringify([PRIVACY_SENTINELS.tags]),
      metadata: JSON.stringify({ secret: PRIVACY_SENTINELS.propertiesPrivate }),
    });

    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: nanoid(),
      platformData: JSON.stringify({ secret: PRIVACY_SENTINELS.platformData }),
      syncErrors: PRIVACY_SENTINELS.syncErrors,
      isActive: 1,
    });

    seedPublishedContent(contact.id, Math.floor(Date.now() / 1000));

    for (let i = 0; i < 3; i += 1) {
      logInteraction({
        contactId: contact.id,
        interactionType: "like",
        scope: "shared",
        occurredAt: 1_700_000_000 + i,
      });
    }

    db.insert(contentItems)
      .values({
        id: nanoid(),
        contactId: contact.id,
        contentType: "dm",
        body: PRIVACY_SENTINELS.propertiesPrivate,
        status: "published",
      })
      .run();

    logInteraction({
      contactId: contact.id,
      interactionType: "note",
      scope: "local_only",
      summary: PRIVACY_SENTINELS.interactionSummary,
    });

    const bundle = assemblePersonaEvidence(contact.id);
    assertNoPrivacySentinels(bundle);
    assertNoPrivacySentinels(renderPersonaEvidencePrompt(bundle.evidence));
  });

  it("excludes persona-generation niche side effects from the evidence digest", () => {
    const contact = createContact({ name: "Niche drift", platform: "x", platformUserId: "niche-1" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: nanoid(),
      isActive: 1,
    });
    seedPublishedContent(contact.id, Math.floor(Date.now() / 1000));

    const persona = upsertPersona({
      contactId: contact.id,
      archetype: "Founder",
      interests: ["startups"],
      scope: "shared",
    });
    projectPersonaInterestsToNiches(persona, "persona:run-1");

    const before = assemblePersonaEvidence(contact.id);
    const after = assemblePersonaEvidence(contact.id);
    expect(after.provenance.evidenceHash).toBe(before.provenance.evidenceHash);
    expect(after.evidence.niches).toHaveLength(0);
  });

  it("keeps manual niche edges in evidence after overlapping persona projection", () => {
    const contact = createContact({ name: "Overlap", platform: "x", platformUserId: "overlap-1" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: nanoid(),
      isActive: 1,
    });
    seedPublishedContent(contact.id, Math.floor(Date.now() / 1000));

    const devtools = ensureNicheByName("devtools", { source: "manual", nicheType: "interest" });
    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "niche",
      dstId: devtools.id,
      edgeType: "belongs_to_niche",
      scope: "shared",
      source: "manual",
    });

    const before = assemblePersonaEvidence(contact.id);
    expect(before.evidence.niches).toHaveLength(1);

    const persona = upsertPersona({
      contactId: contact.id,
      archetype: "Founder",
      interests: ["devtools"],
      scope: "shared",
    });
    projectPersonaInterestsToNiches(persona, "persona:run-1");

    const after = assemblePersonaEvidence(contact.id);
    expect(after.provenance.evidenceHash).toBe(before.provenance.evidenceHash);
    expect(after.evidence.niches).toHaveLength(1);
  });
});
