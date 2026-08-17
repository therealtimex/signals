import type { ContactIdentity } from "@/lib/db/types";

export type ContactProfile = {
  headline: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
};

export type ResolveContactProfileInput = {
  identities: ContactIdentity[];
  legacy?: Partial<ContactProfile>;
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

function pickIdentityField(
  identities: ContactIdentity[],
  read: (identity: ContactIdentity) => string | null | undefined,
): string | null {
  const primary = pickPrimaryIdentity(identities);
  const primaryValue = primary ? read(primary) : null;
  if (primaryValue) return primaryValue;

  const withValue = identities
    .map((identity) => ({ identity, value: read(identity) }))
    .filter((row): row is { identity: ContactIdentity; value: string } => Boolean(row.value))
    .sort((a, b) => {
      const syncA = a.identity.lastSyncedAt ?? a.identity.createdAt;
      const syncB = b.identity.lastSyncedAt ?? b.identity.createdAt;
      return syncB - syncA;
    });

  return withValue[0]?.value ?? null;
}

/** Profile resolution: primary identity → newest identity → legacy scalar shim. */
export function resolveContactProfile(input: ResolveContactProfileInput): ContactProfile {
  const legacy = input.legacy ?? {};
  return {
    headline:
      pickIdentityField(input.identities, (identity) => identity.headline) ??
      legacy.headline ??
      null,
    bio: pickIdentityField(input.identities, (identity) => identity.bio) ?? legacy.bio ?? null,
    location:
      pickIdentityField(input.identities, (identity) => identity.location) ??
      legacy.location ??
      null,
    website:
      pickIdentityField(input.identities, (identity) => identity.websiteUrl) ??
      legacy.website ??
      null,
  };
}
