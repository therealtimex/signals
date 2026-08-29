import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { createContact, archiveContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { upsertPersona } from "@/lib/db/queries/personas";
import {
  contactPersonas,
  contacts,
  contentItems,
  contentPosts,
  platformAccounts,
} from "@/lib/db/schema";
import { PERSONA_STALE_AFTER_SECONDS } from "@/lib/persona/staleness";

export type FixtureContact = {
  id: string;
  enrichmentScore: number;
  updatedAt: number;
  kind: "profiled" | "avatar-only" | "persona-only" | "both" | "stale-only" | "edge";
};

export type ProfilePipelineFixture = {
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

export function seedActiveIdentity(
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

export function seedSharedPersona(contactId: string, generatedAt?: number) {
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

export function seedEvidence(contactId: string) {
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

export function setContactOrdering(
  contactId: string,
  enrichmentScore: number,
  updatedAt: number,
) {
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
export function buildProfilePipelineFixture(
  now = Math.floor(Date.now() / 1000),
): ProfilePipelineFixture {
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
