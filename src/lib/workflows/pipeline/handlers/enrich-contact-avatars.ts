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

function hasAvatarPresent(contactId: string, identities: ContactIdentity[]): boolean {
  if (loadContactAvatarUploadAssetId(contactId)) return true;
  return identities.some((identity) => Boolean(identity.avatarUrl?.trim()));
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

type AvatarProbe =
  | { status: "hit" }
  | { status: "miss" }
  | { status: "transient"; message: string };

/**
 * A resolver URL is only worth persisting once it actually serves an image. unavatar answers
 * 404 for a slug that does not exist in the requested namespace, so an unprobed URL silently
 * becomes a permanent broken avatar in the contact list.
 */
async function probeAvatarUrl(url: string, fetchImpl: typeof fetch): Promise<AvatarProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVATAR_PROBE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    // 429 is unavatar throttling us, not a verdict on the slug — retry on a later run.
    if (response.status === 429 || response.status >= 500) {
      return { status: "transient", message: `Avatar probe returned ${response.status}` };
    }
    if (!response.ok) return { status: "miss" };
    const contentType = response.headers.get("content-type") ?? "";
    return contentType.toLowerCase().startsWith("image/") ? { status: "hit" } : { status: "miss" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Avatar probe failed";
    return { status: "transient", message };
  } finally {
    clearTimeout(timeout);
  }
}

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

type IdentityPlatformRecovery =
  | { status: "found"; identity: ContactIdentity; avatarUrl: string }
  | { status: "none" }
  | { status: "transient"; message: string };

async function recoverAvatarFromIdentityPlatform(
  identities: ContactIdentity[],
  fetchImpl: typeof fetch,
): Promise<IdentityPlatformRecovery> {
  let transient: string | undefined;

  for (const identity of orderIdentitiesForRecovery(identities)) {
    if (identity.avatarUrl?.trim()) continue;
    for (const avatarUrl of identityAvatarCandidates(identity)) {
      const probe = await probeAvatarUrl(avatarUrl, fetchImpl);
      if (probe.status === "hit") {
        return { status: "found", identity, avatarUrl };
      }
      if (probe.status === "transient") {
        transient ??= probe.message;
      }
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

  if (hasAvatarPresent(contactId, identities)) {
    return { contactId, status: "skipped", reason: "avatar_present" };
  }

  if (identities.length === 0) {
    return { contactId, status: "skipped", reason: "no_identity" };
  }

  const platformRecovery = recoverAvatarFromPlatformData(identities);
  if (platformRecovery) {
    updateIdentity(platformRecovery.identity.id, { avatarUrl: platformRecovery.avatarUrl });
    recalcContactEnrichment(contactId);
    return {
      contactId,
      status: "updated",
      detail: { source: "platform_data", identityId: platformRecovery.identity.id },
    };
  }

  const legacyRecovery = recoverAvatarFromLegacyMetadata(contact.metadata, identities);
  if (legacyRecovery) {
    updateIdentity(legacyRecovery.identity.id, { avatarUrl: legacyRecovery.avatarUrl });
    recalcContactEnrichment(contactId);
    return {
      contactId,
      status: "updated",
      detail: { source: "legacy_metadata", identityId: legacyRecovery.identity.id },
    };
  }

  const identityPlatformRecovery = await recoverAvatarFromIdentityPlatform(identities, ctx.fetchImpl);
  if (identityPlatformRecovery.status === "found") {
    updateIdentity(identityPlatformRecovery.identity.id, { avatarUrl: identityPlatformRecovery.avatarUrl });
    recalcContactEnrichment(contactId);
    return {
      contactId,
      status: "updated",
      detail: { source: "identity_platform", identityId: identityPlatformRecovery.identity.id },
    };
  }
  // Leave the contact in the backlog rather than banking a throttled probe as "no source".
  if (identityPlatformRecovery.status === "transient") {
    return {
      contactId,
      status: "failed",
      reason: identityPlatformRecovery.message,
      detail: { source: "identity_platform" },
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
