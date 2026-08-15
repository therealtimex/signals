import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assertPlatform } from "@/lib/db/platforms";
import { contactIdentities, orgIdentities } from "@/lib/db/schema";

export type PlatformClaimantKind = "contact" | "org";

export type PlatformAccountClaimedBy = {
  kind: PlatformClaimantKind;
  id: string;
};

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
  if (opts.claimant === "contact") {
    const orgRow = db
      .select({ id: orgIdentities.id })
      .from(orgIdentities)
      .where(
        and(eq(orgIdentities.platform, platform), eq(orgIdentities.platformUserId, platformUserId)),
      )
      .get();
    if (orgRow) {
      throw new PlatformAccountConflictError(platform, platformUserId, {
        kind: "org",
        id: orgRow.id,
      });
    }
    return;
  }

  const contactRow = db
    .select({ id: contactIdentities.id })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.platform, assertPlatform(platform)),
        eq(contactIdentities.platformUserId, platformUserId),
      ),
    )
    .get();
  if (contactRow) {
    throw new PlatformAccountConflictError(platform, platformUserId, {
      kind: "contact",
      id: contactRow.id,
    });
  }
}
