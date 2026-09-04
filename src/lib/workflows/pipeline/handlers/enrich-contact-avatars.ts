import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { validateIdentityAvatarUrl } from "@/lib/contact-avatar-client";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import { db } from "@/lib/db/client";
import { contactIdentities, contacts } from "@/lib/db/schema";
import {
  loadContactAvatarUploadAssetId,
  resolveContactPrimaryEmail,
} from "@/lib/db/queries/contact-dto";
import { updateIdentity } from "@/lib/db/queries/identities";
import type { ContactIdentity } from "@/lib/db/types";
import { buildLinkedInUnavatarCandidates } from "@/lib/platforms/linkedin/unavatar-url";
import { cacheAvatarFromUrl } from "@/lib/avatars/cache-avatar";
import type {
  PipelineContactOutcome,
  PipelineStepContext,
  PipelineStepReport,
} from "@/lib/workflows/pipeline/types";

export const ENRICH_CONTACT_AVATARS_HANDLER = "enrich_contact_avatars";
const GRAVATAR_PROBE_TIMEOUT_MS = 5_000;
const AVATAR_PROBE_TIMEOUT_MS = 5_000;

type AvatarEnrichMetadata = {
  gravatarVerifiedAt?: number;
  gravatarMissAt?: number;
  exhaustedAt?: number;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function pickPrimaryIdentity(identities: ContactIdentity[]): ContactIdentity | undefined {
  if (identities.length === 0) return undefined;
  const explicit = identities.find((identity) => identity.isPrimary);
  if (explicit) return explicit;
  return [...identities].sort((a, b) => {
    const syncA = a.lastSyncedAt ?? a.createdAt;
    const syncB = b.lastSyncedAt ?? b.createdAt;
    return syncB - syncA;
  })[0];
}

function orderIdentitiesForRecovery(identities: ContactIdentity[]): ContactIdentity[] {
  const primary = pickPrimaryIdentity(identities);
  const rest = identities.filter((identity) => identity.id !== primary?.id);
  rest.sort((a, b) => {
    const syncA = a.lastSyncedAt ?? a.createdAt;
    const syncB = b.lastSyncedAt ?? b.createdAt;
    return syncB - syncA;
  });
  return primary ? [primary, ...rest] : rest;
}

function readMetadataObject(metadata: string | null): Record<string, unknown> {
  try {
    return JSON.parse(metadata ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readAvatarEnrich(metadata: string | null): AvatarEnrichMetadata {
  const root = readMetadataObject(metadata);
  const enrich = root.avatarEnrich;
  if (!enrich || typeof enrich !== "object" || Array.isArray(enrich)) return {};
  const record = enrich as Record<string, unknown>;
  return {
    gravatarVerifiedAt:
      typeof record.gravatarVerifiedAt === "number" ? record.gravatarVerifiedAt : undefined,
    gravatarMissAt:
      typeof record.gravatarMissAt === "number" ? record.gravatarMissAt : undefined,
    exhaustedAt: typeof record.exhaustedAt === "number" ? record.exhaustedAt : undefined,
  };
}

function patchAvatarEnrichMetadata(
  contactId: string,
  patch: Partial<AvatarEnrichMetadata>,
): void {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) return;

  const root = readMetadataObject(contact.metadata);
  const existing = readAvatarEnrich(contact.metadata);
  root.avatarEnrich = { ...existing, ...patch };

  db.update(contacts)
    .set({
      metadata: JSON.stringify(root),
      updatedAt: nowUnix(),
    })
    .where(eq(contacts.id, contactId))
    .run();
}

function readLegacyAvatarUrl(metadata: string | null): string | null {
  const root = readMetadataObject(metadata);
  const value = root.legacyAvatarUrl;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function loadActiveIdentities(contactId: string): ContactIdentity[] {
  return db
    .select()
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contactId))
    .all()
    .filter((identity) => identity.isActive);
}

/**
 * Only a locally stored avatar counts as present. An identity carrying a remote URL still needs a
 * cache pass — that URL is what breaks when the resolver throttles (#431).
 */
function hasAvatarPresent(contactId: string): boolean {
  return Boolean(loadContactAvatarUploadAssetId(contactId));
}

/** A remote URL already on an identity, ready to be pulled local. */
function existingRemoteAvatar(
  identities: ContactIdentity[],
): { identity: ContactIdentity; avatarUrl: string } | undefined {
  for (const identity of orderIdentitiesForRecovery(identities)) {
    const avatarUrl = identity.avatarUrl?.trim();
    if (avatarUrl) return { identity, avatarUrl };
  }
  return undefined;
}

function readPlatformDataObject(platformData: string | null | undefined): Record<string, unknown> {
  if (!platformData) return {};
  try {
    return JSON.parse(platformData) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readPlatformAvatarCandidate(parsed: Record<string, unknown>): string | undefined {
  const profileImageUrl = parsed.profile_image_url;
  if (typeof profileImageUrl === "string" && profileImageUrl.trim()) {
    return profileImageUrl.replace("_normal", "_400x400");
  }

  const picture = parsed.picture;
  if (typeof picture === "string" && picture.trim()) {
    return picture;
  }

  const photoUrl = parsed.photoUrl;
  if (typeof photoUrl === "string" && photoUrl.trim()) {
    return photoUrl;
  }

  return undefined;
}

function tryValidateAvatarUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return validateIdentityAvatarUrl(raw);
  } catch {
    return undefined;
  }
}

function recoverAvatarFromPlatformData(
  identities: ContactIdentity[],
): { identity: ContactIdentity; avatarUrl: string } | undefined {
  for (const identity of orderIdentitiesForRecovery(identities)) {
    if (identity.avatarUrl?.trim()) continue;
    const candidate = readPlatformAvatarCandidate(readPlatformDataObject(identity.platformData));
    const avatarUrl = tryValidateAvatarUrl(candidate);
    if (avatarUrl) {
      return { identity, avatarUrl };
    }
  }
  return undefined;
}

function recoverAvatarFromLegacyMetadata(
  metadata: string | null,
  identities: ContactIdentity[],
): { identity: ContactIdentity; avatarUrl: string } | undefined {
  const legacyUrl = readLegacyAvatarUrl(metadata);
  const avatarUrl = tryValidateAvatarUrl(legacyUrl ?? undefined);
  if (!avatarUrl) return undefined;

  const primary = pickPrimaryIdentity(identities);
  if (!primary) return undefined;
  return { identity: primary, avatarUrl };
}

type AvatarCandidate = { identity?: ContactIdentity; avatarUrl: string; source: string };

function identityAvatarCandidates(identity: ContactIdentity): string[] {
  if (identity.platform === "x" && identity.platformHandle?.trim()) {
    const cleanHandle = identity.platformHandle.trim().replace(/^@/, "");
    if (/^[a-zA-Z0-9_]{1,15}$/.test(cleanHandle)) {
      return [`https://unavatar.io/x/${cleanHandle}`];
    }
    return [];
  }
  if (identity.platform === "linkedin") {
    const slug = identity.platformHandle?.trim() || identity.platformUserId?.trim() || "";
    return buildLinkedInUnavatarCandidates(slug);
  }
  return [];
}

/**
 * Ordered by durability, not convenience. A URL already scraped from the platform CDN
 * (`media.licdn.com`, `pbs.twimg.com`) has no request quota; the `unavatar.io` resolver is capped
 * near 50/day, so it is genuinely last (#431).
 */
function buildAvatarCandidates(
  metadata: string | null,
  identities: ContactIdentity[],
): AvatarCandidate[] {
  const candidates: AvatarCandidate[] = [];

  const existing = existingRemoteAvatar(identities);
  if (existing) {
    candidates.push({ ...existing, source: "identity_avatar" });
  }

  for (const identity of orderIdentitiesForRecovery(identities)) {
    if (identity.avatarUrl?.trim()) continue;
    const fromPlatformData = tryValidateAvatarUrl(
      readPlatformAvatarCandidate(readPlatformDataObject(identity.platformData)),
    );
    if (fromPlatformData) {
      candidates.push({ identity, avatarUrl: fromPlatformData, source: "platform_data" });
    }
  }

  const legacy = tryValidateAvatarUrl(readLegacyAvatarUrl(metadata) ?? undefined);
  const primary = pickPrimaryIdentity(identities);
  if (legacy && primary) {
    candidates.push({ identity: primary, avatarUrl: legacy, source: "legacy_metadata" });
  }

  for (const identity of orderIdentitiesForRecovery(identities)) {
    if (identity.avatarUrl?.trim()) continue;
    for (const avatarUrl of identityAvatarCandidates(identity)) {
      candidates.push({ identity, avatarUrl, source: "identity_platform" });
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.avatarUrl)) return false;
    seen.add(candidate.avatarUrl);
    return true;
  });
}

type AvatarCommit =
  | { status: "cached"; candidate: AvatarCandidate; mediaAssetId: string }
  | { status: "none" }
  | { status: "transient"; message: string };

/**
 * One network round trip per candidate: the download *is* the probe. Probing and then fetching
 * would spend two of a ~50/day allowance to land one avatar.
 */
async function commitFirstWorkingCandidate(
  contactId: string,
  candidates: AvatarCandidate[],
  fetchImpl: typeof fetch,
): Promise<AvatarCommit> {
  let transient: string | undefined;

  for (const candidate of candidates) {
    const result = await cacheAvatarFromUrl(contactId, candidate.avatarUrl, fetchImpl);
    if (result.status === "cached") {
      if (candidate.identity && !candidate.identity.avatarUrl?.trim()) {
        // Keep the source URL on the identity for provenance; rendering uses the cached bytes.
        updateIdentity(candidate.identity.id, { avatarUrl: candidate.avatarUrl });
      }
      return { status: "cached", candidate, mediaAssetId: result.mediaAssetId };
    }
    if (result.status === "transient") {
      transient ??= result.message;
    }
  }

  return transient ? { status: "transient", message: transient } : { status: "none" };
}

function gravatarProbeUrl(email: string): string {
  const normalized = email.trim().toLowerCase();
  const hash = createHash("md5").update(normalized).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=404`;
}

async function probeGravatar(
  email: string,
  fetchImpl: typeof fetch,
): Promise<{ status: "verified" } | { status: "miss" } | { status: "failed"; message: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GRAVATAR_PROBE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(gravatarProbeUrl(email), {
      method: "HEAD",
      signal: controller.signal,
    });

    if (response.status === 200) {
      return { status: "verified" };
    }
    if (response.status === 404) {
      return { status: "miss" };
    }
    return { status: "failed", message: `Gravatar probe returned ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gravatar probe failed";
    return { status: "failed", message };
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichOneContact(
  contactId: string,
  ctx: PipelineStepContext,
): Promise<PipelineContactOutcome> {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) {
    return { contactId, status: "failed", reason: "Contact not found" };
  }

  const identities = loadActiveIdentities(contactId);

  if (hasAvatarPresent(contactId)) {
    return { contactId, status: "skipped", reason: "avatar_present" };
  }

  if (identities.length === 0) {
    return { contactId, status: "skipped", reason: "no_identity" };
  }

  const commit = await commitFirstWorkingCandidate(
    contactId,
    buildAvatarCandidates(contact.metadata, identities),
    ctx.fetchImpl,
  );
  if (commit.status === "cached") {
    recalcContactEnrichment(contactId);
    return {
      contactId,
      status: "updated",
      detail: {
        source: commit.candidate.source,
        identityId: commit.candidate.identity?.id,
        mediaAssetId: commit.mediaAssetId,
      },
    };
  }
  // Throttling is not a verdict on the contact — leave it in the backlog for a later batch.
  if (commit.status === "transient") {
    return {
      contactId,
      status: "failed",
      reason: commit.message,
      detail: { source: "avatar_cache" },
    };
  }

  const email = resolveContactPrimaryEmail(contactId);
  if (email) {
    const probe = await probeGravatar(email, ctx.fetchImpl);
    if (probe.status === "verified") {
      patchAvatarEnrichMetadata(contactId, { gravatarVerifiedAt: nowUnix() });
      return { contactId, status: "verified", detail: { source: "gravatar" } };
    }
    if (probe.status === "failed") {
      return { contactId, status: "failed", reason: probe.message, detail: { source: "gravatar" } };
    }
    patchAvatarEnrichMetadata(contactId, { gravatarMissAt: nowUnix() });
  }

  patchAvatarEnrichMetadata(contactId, { exhaustedAt: nowUnix() });
  return { contactId, status: "skipped", reason: "no_source" };
}

/** Deterministic avatar enrichment for pipeline code steps (§6). */
export async function enrichContactAvatars(
  contactIds: string[],
  ctx: PipelineStepContext,
): Promise<PipelineStepReport> {
  const outcomes: PipelineContactOutcome[] = [];
  for (const contactId of contactIds) {
    const startedAtMs = Date.now();
    const outcome = await enrichOneContact(contactId, ctx);
    outcomes.push(outcome);
    ctx.recordContactOutcome?.(outcome, {
      durationMs: Date.now() - startedAtMs,
    });
  }

  return {
    stepId: ctx.stepId,
    outcomes,
    aborted: false,
  };
}
