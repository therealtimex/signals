import type { NewContact, NewContactIdentity } from "@/lib/db/types";
import type { GooglePerson, GoogleUserInfo } from "@/lib/platforms/gmail/client";
import type { PlatformUserProfile } from "@/lib/platforms/adapter";

/** Find the primary entry or the first entry from an array of Google person fields. */
function findPrimary<T extends { metadata?: { primary?: boolean } }>(items?: T[]): T | undefined {
  if (!items || items.length === 0) return undefined;
  return items.find((i) => i.metadata?.primary) ?? items[0];
}

/** Extract a stable ID from a People API resourceName (e.g. "people/c123" → "c123"). */
function extractResourceId(resourceName: string): string {
  return resourceName.replace(/^people\//, "");
}

/** Map a Google People API person to Signals contact fields. */
export function mapGooglePersonToContact(person: GooglePerson): Omit<NewContact, "id"> {
  const primaryName = findPrimary(person.names);
  const primaryEmail = findPrimary(person.emailAddresses);
  const primaryPhone = findPrimary(person.phoneNumbers);
  const firstOrg = findPrimary(person.organizations);
  const firstAddress = findPrimary(person.addresses);
  const firstBio = person.biographies?.[0];
  const firstUrl = person.urls?.[0];

  // Use non-default photos only (Google adds a generic silhouette as default)
  const photo = person.photos?.find((p) => !p.default);

  const firstName = primaryName?.givenName ?? "";
  const lastName = primaryName?.familyName ?? "";
  const name = primaryName?.displayName ?? `${firstName} ${lastName}`.trim();

  return {
    name: name || "Unknown",
    firstName: firstName || null,
    lastName: lastName || null,
    email: primaryEmail?.value ?? null,
    phone: primaryPhone?.value ?? null,
    company: firstOrg?.name ?? null,
    title: firstOrg?.title ?? null,
    location: firstAddress?.formattedValue ?? null,
    bio: firstBio?.value ?? null,
    photoUrl: photo?.url ?? null,
    avatarUrl: photo?.url ?? null,
    website: firstUrl?.value ?? null,
    platform: "gmail" as const,
    platformUserId: extractResourceId(person.resourceName),
  };
}

/** Map a Google People API person to a contactIdentity row. */
export function mapGooglePersonToIdentity(
  person: GooglePerson,
  contactId: string
): Omit<NewContactIdentity, "id"> {
  const primaryName = findPrimary(person.names);
  const primaryEmail = findPrimary(person.emailAddresses);

  const displayName = primaryName?.displayName ?? "";
  const handle = primaryEmail?.value ?? displayName;

  return {
    contactId,
    platform: "gmail" as const,
    platformUserId: extractResourceId(person.resourceName),
    platformHandle: handle,
    platformUrl: null, // Google Contacts have no public URL
    platformData: JSON.stringify({
      resourceName: person.resourceName,
      emails: (person.emailAddresses ?? []).map((e) => e.value).filter(Boolean),
      phones: (person.phoneNumbers ?? []).map((p) => p.value).filter(Boolean),
      organizations: (person.organizations ?? []).map((o) => ({
        name: o.name,
        title: o.title,
        department: o.department,
      })),
      addresses: (person.addresses ?? []).map((a) => a.formattedValue).filter(Boolean),
    }),
    isPrimary: 0,
    isActive: 1,
    lastSyncedAt: Math.floor(Date.now() / 1000),
  };
}

/** Map Google OAuth2 userinfo to the normalized PlatformUserProfile. */
export function mapGoogleUserInfoToProfile(userinfo: GoogleUserInfo): PlatformUserProfile {
  const displayName = userinfo.name ?? `${userinfo.given_name ?? ""} ${userinfo.family_name ?? ""}`.trim();

  return {
    platformUserId: userinfo.sub,
    platformHandle: userinfo.email ?? displayName,
    displayName,
    bio: null,
    location: null,
    website: null,
    photoUrl: userinfo.picture ?? null,
    followersCount: 0,
    followingCount: 0,
    rawData: userinfo as unknown as Record<string, unknown>,
  };
}

/** Map a Google People API person to PlatformUserProfile (for adapter getContacts). */
export function mapGooglePersonToUserProfile(person: GooglePerson): PlatformUserProfile {
  const primaryName = findPrimary(person.names);
  const primaryEmail = findPrimary(person.emailAddresses);
  const firstOrg = findPrimary(person.organizations);
  const photo = person.photos?.find((p) => !p.default);

  const displayName = primaryName?.displayName ?? "";
  const handle = primaryEmail?.value ?? displayName;

  return {
    platformUserId: extractResourceId(person.resourceName),
    platformHandle: handle,
    displayName,
    bio: firstOrg ? `${firstOrg.title ?? ""} at ${firstOrg.name ?? ""}`.trim() : null,
    location: findPrimary(person.addresses)?.formattedValue ?? null,
    website: person.urls?.[0]?.value ?? null,
    photoUrl: photo?.url ?? null,
    followersCount: 0,
    followingCount: 0,
    rawData: person as unknown as Record<string, unknown>,
  };
}
