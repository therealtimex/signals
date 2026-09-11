import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import { resolvePlatformClaim } from "@/lib/db/identity-claims";
import { snowballCandidates } from "@/lib/db/schema";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { createIdentity, getIdentityById, updateIdentity } from "@/lib/db/queries/identities";
import {
  canonicalLinkedInProfile,
  humanQuarantinePromotionPlatformData,
  SNOWBALL_HUMAN_QUARANTINE_PROMOTION_KEY,
} from "@/lib/workflows/snowball-identity-evidence";
import {
  markSnowballCandidatePromoted,
  markUnverifiedSnowballCandidatesPromotedByProfile,
  normalizeSnowballCandidateProfile,
  normalizeSnowballCandidateText,
  SnowballCandidateTransitionError,
  type SnowballCandidateView,
} from "@/lib/workflows/snowball-candidates";

export class SnowballCandidatePromoteError extends Error {
  readonly status: 400 | 404;

  constructor(message: string, status: 400 | 404 = 400) {
    super(message);
    this.name = "SnowballCandidatePromoteError";
    this.status = status;
  }
}

export type PromoteSnowballCandidateInput = {
  confirmed: true;
  name?: string;
  title?: string | null;
  company?: string | null;
  profileUrl?: string;
  now?: number;
};

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function optionalText(value: string | null | undefined, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function promoteSnowballCandidate(
  id: string,
  input: PromoteSnowballCandidateInput,
): SnowballCandidateView {
  const candidate = db.select().from(snowballCandidates)
    .where(eq(snowballCandidates.id, id))
    .get();
  if (!candidate) {
    throw new SnowballCandidatePromoteError("Snowball candidate not found", 404);
  }
  if (candidate.status === "promoted") {
    throw new SnowballCandidateTransitionError(
      "Promoted candidates are canonical CRM records and cannot be dismissed from quarantine.",
    );
  }
  if (candidate.status !== "identity_unverified") {
    throw new SnowballCandidateTransitionError(
      "Dismissed candidates must be reopened before they can be promoted.",
    );
  }

  const confirmedName = (input.name ?? candidate.proposedName).trim();
  if (!confirmedName) {
    throw new SnowballCandidatePromoteError("A confirmed name is required to promote this candidate.");
  }
  const confirmedCompany = optionalText(input.company, candidate.proposedCompany);
  const confirmedTitle = optionalText(input.title, candidate.proposedTitle);
  const identity = canonicalLinkedInProfile(input.profileUrl?.trim() || candidate.profileUrl);
  if (!identity) {
    throw new SnowballCandidatePromoteError(
      "Promotion requires a canonical LinkedIn /in/ profile URL.",
    );
  }
  const profile = normalizeSnowballCandidateProfile(identity.platformUrl);
  if (!profile) {
    throw new SnowballCandidatePromoteError(
      "Promotion requires a canonical LinkedIn /in/ profile URL.",
    );
  }

  const claim = resolvePlatformClaim("linkedin", identity.platformUserId);
  if (claim.claimed && claim.claimant.kind === "org") {
    throw new SnowballCandidatePromoteError(
      `LinkedIn profile ${identity.platformHandle} is already claimed by an organization.`,
    );
  }

  const now = input.now ?? Math.floor(Date.now() / 1_000);
  const provenance = {
    tag: "manual:snowball_quarantine" as const,
    workflowRunId: candidate.workflowRunId,
    templateId: candidate.templateId,
  };
  const promotion = {
    version: 1 as const,
    candidateId: candidate.id,
    workflowRunId: candidate.workflowRunId,
    failureReason: candidate.failureReason,
    attemptCount: candidate.attemptCount,
    promotedAt: now,
    confirmedName,
    profileUrl: identity.platformUrl,
  };

  return db.transaction(() => {
    const colliding = db.select().from(snowballCandidates).where(and(
      eq(snowballCandidates.workflowRunId, candidate.workflowRunId),
      eq(snowballCandidates.platform, "linkedin"),
      eq(snowballCandidates.profileKey, profile.profileKey),
    )).get();
    const canRewriteProfile = !colliding || colliding.id === candidate.id;
    db.update(snowballCandidates).set({
      proposedName: confirmedName,
      proposedNameKey: normalizeSnowballCandidateText(confirmedName),
      proposedCompany: confirmedCompany,
      proposedTitle: confirmedTitle,
      ...(canRewriteProfile ? profile : {}),
      updatedAt: now,
    }).where(eq(snowballCandidates.id, candidate.id)).run();

    let contactId: string;
    let identityId: string;
    if (claim.claimed && claim.claimant.kind === "contact") {
      contactId = claim.claimant.contactId;
      identityId = claim.claimant.identityId;
      const existingIdentity = getIdentityById(identityId);
      if (existingIdentity) {
        const platformData = parseJsonObject(existingIdentity.platformData);
        if (!platformData[SNOWBALL_HUMAN_QUARANTINE_PROMOTION_KEY]) {
          updateIdentity(identityId, {
            platformData: JSON.stringify(humanQuarantinePromotionPlatformData(promotion, platformData)),
          });
        }
      }
    } else {
      const contact = createContact(
        {
          name: confirmedName,
          company: confirmedCompany,
          title: confirmedTitle,
        },
        provenance,
      );
      const createdIdentity = createIdentity({
        contactId: contact.id,
        platform: "linkedin",
        platformUserId: identity.platformUserId,
        platformHandle: identity.platformHandle,
        platformUrl: identity.platformUrl,
        displayName: confirmedName,
        headline: confirmedTitle,
        platformData: JSON.stringify(humanQuarantinePromotionPlatformData(promotion)),
      });
      contactId = contact.id;
      identityId = createdIdentity.id;
    }

    recalcContactEnrichment(contactId);
    const orgId = getContactById(contactId)?.currentEmployment?.orgId ?? null;
    markUnverifiedSnowballCandidatesPromotedByProfile({
      profileUrl: identity.platformUrl,
      contactId,
      identityId,
      orgId,
      now,
    });
    return markSnowballCandidatePromoted(candidate.id, {
      contactId,
      identityId,
      orgId,
      now,
    })!;
  });
}
