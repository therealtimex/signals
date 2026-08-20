import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { isContactArchived } from "@/lib/db/contact-archive";
import { assertPlatform } from "@/lib/db/platforms";
import { contactIdentities, contacts, orgIdentities } from "@/lib/db/schema";

export type PlatformClaimantKind = "contact" | "org";

export type PlatformAccountClaimedBy = {
  kind: PlatformClaimantKind;
  id: string;
};

export type ContactPlatformClaimant = {
  kind: "contact";
  contactId: string;
  identityId: string;
  archived: boolean;
};

export type OrgPlatformClaimant = {
  kind: "org";
  orgId: string;
  identityId: string;
};

export type PlatformClaim =
  | { claimed: false }
  | { claimed: true; claimant: ContactPlatformClaimant }
  | { claimed: true; claimant: OrgPlatformClaimant };

/**
 * Who, if anyone, holds this platform account as a contact identity.
 * Archived contacts count: the write guards do not filter them, so a lookup that
 * hides them would disagree with the guard that later rejects the attach (#202).
 */
export function findContactPlatformClaimant(
  platform: string,
  platformUserId: string,
): ContactPlatformClaimant | undefined {
  const row = db
    .select({
      identityId: contactIdentities.id,
      contactId: contactIdentities.contactId,
      metadata: contacts.metadata,
    })
    .from(contactIdentities)
    .innerJoin(contacts, eq(contactIdentities.contactId, contacts.id))
    .where(
      and(
        eq(contactIdentities.platform, assertPlatform(platform)),
        eq(contactIdentities.platformUserId, platformUserId),
      ),
    )
    .get();
  if (!row) return undefined;
  return {
    kind: "contact",
    contactId: row.contactId,
    identityId: row.identityId,
    archived: isContactArchived(row.metadata),
  };
}

/** Who, if anyone, holds this platform account as an org identity. */
export function findOrgPlatformClaimant(
  platform: string,
  platformUserId: string,
): OrgPlatformClaimant | undefined {
  const row = db
    .select({ identityId: orgIdentities.id, orgId: orgIdentities.orgId })
    .from(orgIdentities)
    .where(
      and(eq(orgIdentities.platform, platform), eq(orgIdentities.platformUserId, platformUserId)),
    )
    .get();
  if (!row) return undefined;
  return { kind: "org", orgId: row.orgId, identityId: row.identityId };
}

/**
 * Canonical claim resolution: the single answer to "is this platform account already
 * spoken for". Both the `resolve_platform_claim` read tool and the
 * `upsert_contact_identity` write path resolve through this, so a caller cannot get a
 * different answer than the guard that rejects it.
 *
 * A platform account can be claimed by a contact identity or an org identity; both
 * block a new contact identity, so both are reported.
 */
export function resolvePlatformClaim(platform: string, platformUserId: string): PlatformClaim {
  const contactClaimant = findContactPlatformClaimant(platform, platformUserId);
  if (contactClaimant) return { claimed: true, claimant: contactClaimant };

  const orgClaimant = findOrgPlatformClaimant(platform, platformUserId);
  if (orgClaimant) return { claimed: true, claimant: orgClaimant };

  return { claimed: false };
}

export class PlatformAccountConflictError extends Error {
  readonly platform: string;
  readonly platformUserId: string;
  readonly claimedBy: PlatformAccountClaimedBy;

  constructor(platform: string, platformUserId: string, claimedBy: PlatformAccountClaimedBy) {
    super(
      `Platform account ${platform}:${platformUserId} is already claimed by ${claimedBy.kind} ${claimedBy.id}. Reassign, don't duplicate.`,
    );
    this.name = "PlatformAccountConflictError";
    this.platform = platform;
    this.platformUserId = platformUserId;
    this.claimedBy = claimedBy;
  }
}

/** Reject when the same platform account is claimed across contact and org identity tables. */
export function assertPlatformAccountUnclaimed(
  platform: string,
  platformUserId: string,
  opts: { claimant: PlatformClaimantKind; excludeId?: string },
): void {
  // Deliberately asymmetric, and unchanged: this guard rejects a claim held by the
  // *other* kind of owner. Same-kind conflicts are handled by the caller's own
  // preflight (see handleUpsertContactIdentity) and ultimately by the unique index.
  if (opts.claimant === "contact") {
    const orgClaimant = findOrgPlatformClaimant(platform, platformUserId);
    if (orgClaimant) {
      throw new PlatformAccountConflictError(platform, platformUserId, {
        kind: "org",
        id: orgClaimant.identityId,
      });
    }
    return;
  }

  const contactClaimant = findContactPlatformClaimant(platform, platformUserId);
  if (contactClaimant) {
    throw new PlatformAccountConflictError(platform, platformUserId, {
      kind: "contact",
      id: contactClaimant.identityId,
    });
  }
}
