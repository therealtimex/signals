import { createHash } from "node:crypto";
import type { ContactIdentity } from "@/lib/db/types";

export type ResolveContactAvatarInput = {
  avatarUploadAssetId?: string | null;
  identities: ContactIdentity[];
  primaryEmail?: string | null;
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

/** Avatar resolution order: local upload → identity → Gravatar → null (initials client-side). */
export function resolveContactAvatar(input: ResolveContactAvatarInput): string | null {
  if (input.avatarUploadAssetId) {
    return `/api/media/${input.avatarUploadAssetId}`;
  }

  const identityAvatar = pickIdentityAvatar(input.identities);
  if (identityAvatar) return identityAvatar;

  if (input.primaryEmail?.trim()) {
    return gravatarUrlForEmail(input.primaryEmail);
  }

  return null;
}
