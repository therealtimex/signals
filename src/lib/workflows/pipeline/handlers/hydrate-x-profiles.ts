import { validateIdentityAvatarUrl } from "@/lib/contact-avatar-client";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import { getContactById, updateContact } from "@/lib/db/queries/contacts";
import { listIdentitiesByContact, updateIdentity } from "@/lib/db/queries/identities";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import type { ContactIdentity } from "@/lib/db/types";
import {
  getUsersByIds,
  TierRestrictedError,
  X_USER_LOOKUP_MAX_IDS,
  type XLookupError,
  type XUser,
} from "@/lib/platforms/x/client";
import { RateLimitError } from "@/lib/platforms/rate-limiter";
import type {
  PipelineContactOutcome,
  PipelineStepContext,
  PipelineStepReport,
} from "@/lib/workflows/pipeline/types";

export const HYDRATE_X_PROFILES_HANDLER = "hydrate_x_profiles";
export const X_PROFILE_HYDRATE_RETRY_SECONDS = 30 * 24 * 60 * 60;

export type XUserLookup = typeof getUsersByIds;

type ContactState = {
  contactId: string;
  updatedIdentityIds: string[];
  handles: string[];
  notFound: number;
  contactUpdated: boolean;
  failure?: string;
  skipReason?: string;
  skipDetail?: Record<string, unknown>;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function readPlatformData(platformData: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(platformData ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function isRecentTimestamp(value: unknown, now: number): boolean {
  return typeof value === "number" && now - value < X_PROFILE_HYDRATE_RETRY_SECONDS;
}

function hasRecentMiss(data: Record<string, unknown>, now: number): boolean {
  const miss = data.profileHydrationMiss;
  if (!miss || typeof miss !== "object" || Array.isArray(miss)) return false;
  const record = miss as Record<string, unknown>;
  return record.status === "not_found" && isRecentTimestamp(record.at, now);
}

function isArchivePlaceholderName(
  name: string,
  platformUserId: string,
  platformData: Record<string, unknown>,
): boolean {
  if (name === `X user ${platformUserId}`) return true;
  const archiveScreenName = platformData.archiveScreenName;
  return typeof archiveScreenName === "string" && name === `@${archiveScreenName}`;
}

function identityNeedsHydration(
  identity: ContactIdentity,
  contactName: string,
  platformData: Record<string, unknown>,
): boolean {
  return (
    !identity.displayName?.trim() ||
    !identity.platformHandle?.trim() ||
    !identity.avatarUrl?.trim() ||
    isArchivePlaceholderName(contactName, identity.platformUserId, platformData)
  );
}

function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const splitAt = trimmed.indexOf(" ");
  if (splitAt < 0) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, splitAt),
    lastName: trimmed.slice(splitAt + 1),
  };
}

function isoToUnix(value: string | undefined): number | null {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : Math.floor(millis / 1000);
}

function isArchiveProfileUrl(url: string | null, userId: string): boolean {
  if (!url) return true;
  return url === `https://x.com/i/user/${userId}` || url === `https://twitter.com/i/user/${userId}`;
}

function tryAvatarUrl(raw: string | undefined): string | undefined {
  try {
    return validateIdentityAvatarUrl(raw);
  } catch {
    return undefined;
  }
}

function lookupErrorId(error: XLookupError): string | undefined {
  const value = error.value ?? error.resource_id;
  return typeof value === "string" && /^\d+$/.test(value) ? value : undefined;
}

function skipAll(
  contactIds: string[],
  ctx: PipelineStepContext,
  reason: string,
): PipelineStepReport {
  const outcomes = contactIds.map((contactId) => ({
    contactId,
    status: "skipped" as const,
    reason,
  }));
  for (const outcome of outcomes) {
    ctx.recordContactOutcome?.(outcome, { durationMs: 0 });
  }
  return {
    stepId: ctx.stepId,
    outcomes,
    aborted: false,
  };
}

function updateIdentityFromUser(identity: ContactIdentity, user: XUser, now: number): void {
  const platformData = readPlatformData(identity.platformData);
  delete platformData.profileHydrationMiss;
  Object.assign(platformData, {
    profile_image_url: user.profile_image_url ?? null,
    followersCount: user.public_metrics?.followers_count ?? null,
    followingCount: user.public_metrics?.following_count ?? null,
    tweetCount: user.public_metrics?.tweet_count ?? null,
    listedCount: user.public_metrics?.listed_count ?? null,
    verified: user.verified ?? false,
    createdAt: user.created_at ?? null,
    profileHydratedAt: now,
  });

  const avatarUrl = identity.avatarUrl?.trim() || tryAvatarUrl(user.profile_image_url) || null;
  updateIdentity(identity.id, {
    displayName: identity.displayName?.trim() ? identity.displayName : user.name,
    platformHandle: identity.platformHandle?.trim()
      ? identity.platformHandle
      : `@${user.username}`,
    platformUrl: isArchiveProfileUrl(identity.platformUrl, identity.platformUserId)
      ? `https://x.com/${user.username}`
      : identity.platformUrl,
    bio: identity.bio?.trim() ? identity.bio : user.description || null,
    avatarUrl,
    location: identity.location?.trim() ? identity.location : user.location || null,
    websiteUrl: identity.websiteUrl?.trim() ? identity.websiteUrl : user.url || null,
    isVerified: user.verified ?? false,
    followersCount: user.public_metrics?.followers_count ?? null,
    followingCount: user.public_metrics?.following_count ?? null,
    postsCount: user.public_metrics?.tweet_count ?? null,
    listedCount: user.public_metrics?.listed_count ?? null,
    platformCreatedAt: isoToUnix(user.created_at),
    statsUpdatedAt: now,
    lastSyncedAt: now,
    platformData: JSON.stringify(platformData),
  });

  // The legacy stats projector reads raw profile_image_url from platformData. Restore the
  // fill-gaps-only value after the projection, including when the API URL is invalid.
  updateIdentity(identity.id, { avatarUrl });
}

function markIdentityNotFound(identity: ContactIdentity, now: number): void {
  const platformData = readPlatformData(identity.platformData);
  platformData.profileHydrationMiss = { at: now, status: "not_found" };
  updateIdentity(identity.id, { platformData: JSON.stringify(platformData) });
}

/** Deterministic, batched X API hydration for archive-imported numeric identities. */
export async function hydrateXProfiles(
  contactIds: string[],
  ctx: PipelineStepContext,
  lookup: XUserLookup = getUsersByIds,
): Promise<PipelineStepReport> {
  const account = getPlatformAccountByPlatform("x");
  if (!account?.credentialsEncrypted) return skipAll(contactIds, ctx, "x_not_connected");
  if (account.status === "needs_reauth") return skipAll(contactIds, ctx, "x_reauth_required");

  const now = nowUnix();
  const outcomes = new Map<string, PipelineContactOutcome>();
  const states = new Map<string, ContactState>();
  const identitiesByUserId = new Map<string, ContactIdentity[]>();

  for (const contactId of contactIds) {
    const contact = getContactById(contactId);
    if (!contact) {
      outcomes.set(contactId, { contactId, status: "failed", reason: "Contact not found" });
      continue;
    }

    const identities = listIdentitiesByContact(contactId).filter(
      (identity) => identity.isActive && identity.platform === "x" && /^\d+$/.test(identity.platformUserId),
    );
    if (identities.length === 0) {
      outcomes.set(contactId, { contactId, status: "skipped", reason: "no_x_identity" });
      continue;
    }

    const lookupIdentities: ContactIdentity[] = [];
    let recentMisses = 0;
    for (const identity of identities) {
      const platformData = readPlatformData(identity.platformData);
      if (isRecentTimestamp(platformData.profileHydratedAt, now)) continue;
      if (hasRecentMiss(platformData, now)) {
        recentMisses++;
        continue;
      }
      if (identityNeedsHydration(identity, contact.name, platformData)) {
        lookupIdentities.push(identity);
      }
    }

    if (lookupIdentities.length === 0) {
      outcomes.set(contactId, {
        contactId,
        status: "skipped",
        reason: recentMisses === identities.length ? "not_found_cached" : "fresh",
      });
      continue;
    }

    states.set(contactId, {
      contactId,
      updatedIdentityIds: [],
      handles: [],
      notFound: 0,
      contactUpdated: false,
    });
    for (const identity of lookupIdentities) {
      const matches = identitiesByUserId.get(identity.platformUserId) ?? [];
      matches.push(identity);
      identitiesByUserId.set(identity.platformUserId, matches);
    }
  }

  const userIds = [...identitiesByUserId.keys()];
  for (let offset = 0; offset < userIds.length; offset += X_USER_LOOKUP_MAX_IDS) {
    const chunk = userIds.slice(offset, offset + X_USER_LOOKUP_MAX_IDS);
    try {
      const response = await lookup(account.id, chunk);
      const foundIds = new Set<string>();
      const errorIds = new Set(
        response.errors.map(lookupErrorId).filter((id): id is string => id !== undefined),
      );

      for (const user of response.users) {
        const identities = identitiesByUserId.get(user.id) ?? [];
        if (identities.length === 0 || foundIds.has(user.id)) continue;
        foundIds.add(user.id);
        for (const identity of identities) {
          const state = states.get(identity.contactId);
          if (!state || state.failure) continue;
          try {
            updateIdentityFromUser(identity, user, now);
            state.updatedIdentityIds.push(identity.id);
            state.handles.push(`@${user.username}`);

            const contact = getContactById(identity.contactId);
            const platformData = readPlatformData(identity.platformData);
            if (contact && isArchivePlaceholderName(contact.name, user.id, platformData)) {
              updateContact(contact.id, splitName(user.name));
              state.contactUpdated = true;
            }
          } catch (error) {
            state.failure = error instanceof Error ? error.message : "Failed to update X profile";
          }
        }
      }

      for (const userId of errorIds) {
        if (foundIds.has(userId)) continue;
        for (const identity of identitiesByUserId.get(userId) ?? []) {
          const state = states.get(identity.contactId);
          if (!state || state.failure) continue;
          try {
            markIdentityNotFound(identity, now);
            state.notFound++;
          } catch (error) {
            state.failure = error instanceof Error ? error.message : "Failed to cache X profile miss";
          }
        }
      }

      for (const userId of chunk) {
        if (foundIds.has(userId) || errorIds.has(userId)) continue;
        for (const identity of identitiesByUserId.get(userId) ?? []) {
          const state = states.get(identity.contactId);
          if (state && !state.failure) state.failure = `X lookup returned no result for ${userId}`;
        }
      }
    } catch (error) {
      if (error instanceof RateLimitError || error instanceof TierRestrictedError) {
        const currentAccount = getPlatformAccountByPlatform("x");
        const reason = currentAccount?.status === "needs_reauth"
          ? "x_reauth_required"
          : error instanceof RateLimitError
            ? "x_rate_limited"
            : "x_access_restricted";
        for (const state of states.values()) {
          if (state.updatedIdentityIds.length > 0 || state.notFound > 0 || state.failure) continue;
          state.skipReason = reason;
          if (error instanceof RateLimitError) {
            state.skipDetail = { retryAfter: Math.max(0, error.retryAfter) };
          }
        }
        break;
      }

      const currentAccount = getPlatformAccountByPlatform("x");
      if (currentAccount?.status === "needs_reauth") {
        for (const state of states.values()) {
          if (state.updatedIdentityIds.length === 0 && state.notFound === 0 && !state.failure) {
            state.skipReason = "x_reauth_required";
          }
        }
        break;
      }

      const message = error instanceof Error ? error.message : "X profile lookup failed";
      const chunkContacts = new Set(
        chunk.flatMap((userId) => (identitiesByUserId.get(userId) ?? []).map((identity) => identity.contactId)),
      );
      for (const contactId of chunkContacts) {
        const state = states.get(contactId);
        if (state) state.failure = message;
      }
    }
  }

  for (const state of states.values()) {
    if (state.updatedIdentityIds.length > 0 && !state.contactUpdated) {
      recalcContactEnrichment(state.contactId);
    }
    if (state.failure) {
      outcomes.set(state.contactId, {
        contactId: state.contactId,
        status: "failed",
        reason: state.failure,
      });
    } else if (state.updatedIdentityIds.length > 0) {
      outcomes.set(state.contactId, {
        contactId: state.contactId,
        status: "updated",
        detail: {
          source: "x_api",
          identityIds: state.updatedIdentityIds,
          handle: state.handles[0],
        },
      });
    } else if (state.skipReason) {
      outcomes.set(state.contactId, {
        contactId: state.contactId,
        status: "skipped",
        reason: state.skipReason,
        detail: state.skipDetail,
      });
    } else if (state.notFound > 0) {
      outcomes.set(state.contactId, {
        contactId: state.contactId,
        status: "skipped",
        reason: "not_found",
      });
    } else {
      outcomes.set(state.contactId, {
        contactId: state.contactId,
        status: "failed",
        reason: "X profile lookup did not resolve this contact",
      });
    }
  }

  return {
    stepId: ctx.stepId,
    outcomes: contactIds.map((contactId) => outcomes.get(contactId) ?? ({
      contactId,
      status: "failed",
      reason: "X profile hydration produced no outcome",
    })),
    aborted: false,
  };
}
