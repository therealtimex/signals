import { createHash } from "node:crypto";
import type { ContactIdentity } from "@/lib/db/types";

export type ResolveContactAvatarInput = {
  avatarUploadAssetId?: string | null;
  identities: ContactIdentity[];
  primaryEmail?: string | null;
  /**
   * Whether `enrich_contact_avatars` has seen this address answer a Gravatar HEAD probe with 200.
   * Gravatar is requested with `?d=404`, so an unverified address yields a broken image rather
   * than a portrait — resolving to one is worse than resolving to nothing, because the caller
   * treats a non-null URL as "this contact has an avatar".
   */
  gravatarVerified?: boolean;
};

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

function pickIdentityAvatar(identities: ContactIdentity[]): string | null {
  const primary = pickPrimaryIdentity(identities);
  if (primary?.avatarUrl) return primary.avatarUrl;

  const withAvatar = identities
    .filter((identity) => identity.avatarUrl)
    .sort((a, b) => {
      const syncA = a.lastSyncedAt ?? a.createdAt;
      const syncB = b.lastSyncedAt ?? b.createdAt;
      return syncB - syncA;
    });
  return withAvatar[0]?.avatarUrl ?? null;
}

function gravatarUrlForEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const hash = createHash("md5").update(normalized).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=404`;
}

/** Reads `metadata.avatarEnrich.gravatarVerifiedAt`, written by the avatar-enrich handler. */
export function hasVerifiedGravatar(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    const root = JSON.parse(metadata) as { avatarEnrich?: { gravatarVerifiedAt?: unknown } };
    return typeof root?.avatarEnrich?.gravatarVerifiedAt === "number";
  } catch {
    return false;
  }
}

/** Avatar resolution order: local upload → identity → verified Gravatar → null (initials client-side). */
export function resolveContactAvatar(input: ResolveContactAvatarInput): string | null {
  if (input.avatarUploadAssetId) {
    return `/api/media/${input.avatarUploadAssetId}`;
  }

  const identityAvatar = pickIdentityAvatar(input.identities);
  if (identityAvatar) return identityAvatar;

  if (input.gravatarVerified && input.primaryEmail?.trim()) {
    return gravatarUrlForEmail(input.primaryEmail);
  }

  return null;
}
