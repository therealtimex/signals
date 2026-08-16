import type { NewContact, NewContactIdentity } from "@/lib/db/types";
import type { ContactWriteExtras } from "@/lib/db/queries/contacts";
import type { LinkedInProfile, LinkedInConnection } from "@/lib/platforms/linkedin/client";

/** Extract profile photo URL from LinkedIn's nested profilePicture structure. */
function extractPhotoUrl(
  profilePicture: LinkedInProfile["profilePicture"] | undefined
): string | null {
  if (!profilePicture) return null;

  const elements = profilePicture["displayImage~"]?.elements;
  if (!elements || elements.length === 0) return null;

  // Last element is typically highest resolution
  const lastElement = elements[elements.length - 1];
  return lastElement?.identifiers?.[0]?.identifier ?? null;
}

/** Map a LinkedIn profile (userinfo or legacy) to Signals contact fields. */
export function mapLinkedInProfileToContact(
  profile: LinkedInProfile,
  email?: string | null
): Omit<NewContact, "id"> & ContactWriteExtras {
  // Support both OpenID Connect userinfo and legacy /me response shapes
  const firstName = profile.given_name ?? profile.localizedFirstName ?? "";
  const lastName = profile.family_name ?? profile.localizedLastName ?? "";
  const name = profile.name ?? `${firstName} ${lastName}`.trim();
  const photoUrl = profile.picture ?? extractPhotoUrl(profile.profilePicture);
  const vanityName = profile.vanityName;
  const resolvedEmail = profile.email ?? email ?? null;

  return {
    name: name || "Unknown",
    firstName: firstName || null,
    lastName: lastName || null,
    headline: profile.localizedHeadline || null,
    email: resolvedEmail,
    platform: "linkedin" as const,
    platformUserId: profile.sub ?? profile.id ?? "",
    profileUrl: vanityName ? `https://linkedin.com/in/${vanityName}` : null,
    photoUrl: photoUrl ?? null,
    avatarUrl: photoUrl ?? null,
  };
}

/** Map a LinkedIn profile (userinfo or legacy) to a contactIdentity row. */
export function mapLinkedInProfileToIdentity(
  profile: LinkedInProfile,
  contactId: string,
  email?: string | null
): Omit<NewContactIdentity, "id"> {
  const vanityName = profile.vanityName;
  const firstName = profile.given_name ?? profile.localizedFirstName ?? "";
  const lastName = profile.family_name ?? profile.localizedLastName ?? "";
  const displayName = profile.name ?? `${firstName} ${lastName}`.trim();
  const resolvedEmail = profile.email ?? email ?? null;

  return {
    contactId,
    platform: "linkedin" as const,
    platformUserId: profile.sub ?? profile.id ?? "",
    platformHandle: vanityName ? `/in/${vanityName}` : displayName,
    platformUrl: vanityName ? `https://linkedin.com/in/${vanityName}` : null,
    platformData: JSON.stringify({
      headline: profile.localizedHeadline ?? null,
      vanityName: vanityName ?? null,
      firstName,
      lastName,
      email: resolvedEmail,
    }),
    isPrimary: 0,
    isActive: 1,
    lastSyncedAt: Math.floor(Date.now() / 1000),
  };
}

/** Map a LinkedIn connection to Signals contact fields. */
export function mapLinkedInConnectionToContact(
  connection: LinkedInConnection
): Omit<NewContact, "id"> & ContactWriteExtras {
  const firstName = connection.localizedFirstName ?? "";
  const lastName = connection.localizedLastName ?? "";
  const name = `${firstName} ${lastName}`.trim();
  const photoUrl = extractPhotoUrl(connection.profilePicture);
  const vanityName = connection.vanityName;

  return {
    name: name || "Unknown",
    firstName: firstName || null,
    lastName: lastName || null,
    headline: connection.localizedHeadline || null,
    platform: "linkedin" as const,
    platformUserId: connection.id,
    profileUrl: vanityName ? `https://linkedin.com/in/${vanityName}` : null,
    photoUrl,
    avatarUrl: photoUrl,
  };
}

/** Map a LinkedIn connection to a contactIdentity row. */
export function mapLinkedInConnectionToIdentity(
  connection: LinkedInConnection,
  contactId: string
): Omit<NewContactIdentity, "id"> {
  const vanityName = connection.vanityName;
  const displayName = `${connection.localizedFirstName ?? ""} ${connection.localizedLastName ?? ""}`.trim();

  return {
    contactId,
    platform: "linkedin" as const,
    platformUserId: connection.id,
    platformHandle: vanityName ? `/in/${vanityName}` : displayName,
    platformUrl: vanityName ? `https://linkedin.com/in/${vanityName}` : null,
    platformData: JSON.stringify({
      headline: connection.localizedHeadline ?? null,
      vanityName: vanityName ?? null,
      firstName: connection.localizedFirstName ?? null,
      lastName: connection.localizedLastName ?? null,
    }),
    isPrimary: 0,
    isActive: 1,
    lastSyncedAt: Math.floor(Date.now() / 1000),
  };
}
