import { validateIdentityAvatarUrl } from "@/lib/contact-avatar-client";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import { getContactById, updateContact } from "@/lib/db/queries/contacts";
import { getIdentityById, listIdentitiesByContact, updateIdentity } from "@/lib/db/queries/identities";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import type { ContactIdentity } from "@/lib/db/types";
import {
  getUsersByIds,
  getUsersByUsernames,
  TierRestrictedError,
  X_USER_LOOKUP_MAX_IDS,
  X_USER_LOOKUP_MAX_USERNAMES,
  type XLookupError,
  type XUser,
} from "@/lib/platforms/x/client";
import { RateLimitError } from "@/lib/platforms/rate-limiter";
import {
  createXAnonWebSession,
  hydrateXProfilesViaAnonWeb,
  type XAnonWebOutcome,
  type XAnonWebRequest,
  type XAnonWebTransport,
} from "@/lib/platforms/x/anon-web-transport";
import type {
  PipelineContactOutcome,
  PipelineStepContext,
  PipelineStepReport,
} from "@/lib/workflows/pipeline/types";

export const HYDRATE_X_PROFILES_HANDLER = "hydrate_x_profiles";
export const X_PROFILE_HYDRATE_RETRY_SECONDS = 30 * 24 * 60 * 60;

export type XUserLookup = typeof getUsersByIds;
export type XUsernameLookup = typeof getUsersByUsernames;

const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
/** Keeps handle request keys from colliding with the numeric IDs in the same outcome map. */
const HANDLE_REQUEST_PREFIX = "handle:";

type HandleGroup = { handle: string; identities: ContactIdentity[] };

/** One chunked X API lookup, keyed by numeric ID or by lowercased handle. */
type LookupBatch = {
  keys: string[];
  run: () => Promise<{ users: XUser[]; errors: XLookupError[] }>;
  keyForUser: (user: XUser) => string;
  keyForError: (error: XLookupError) => string | undefined;
  identitiesFor: (key: string) => ContactIdentity[];
  describe: (key: string) => string;
};

type ContactState = {
  contactId: string;
  source: "x_api" | "x_web_anon";
  updatedIdentityIds: string[];
  handles: string[];
  notFound: number;
  contactUpdated: boolean;
  idConflicts: string[];
  failure?: string;
  skipReason?: string;
  skipDetail?: Record<string, unknown>;
};

function isNumericUserId(value: string): boolean {
  return /^\d+$/.test(value);
}

/** The handle an identity without a numeric ID can still be looked up by, without the leading @. */
function resolvableHandle(identity: ContactIdentity): string | undefined {
  for (const candidate of [identity.platformHandle, identity.platformUserId]) {
    const handle = candidate?.trim().replace(/^@/, "");
    if (handle && X_HANDLE_PATTERN.test(handle)) return handle;
  }
  return undefined;
}

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
  return (record.status === "not_found" || record.status === "suspended") &&
    isRecentTimestamp(record.at, now);
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
    // An identity still keyed by a handle has no stable platform ID yet, which is itself a gap.
    !isNumericUserId(identity.platformUserId) ||
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
  return typeof value === "string" && isNumericUserId(value) ? value : undefined;
}

function lookupErrorUsername(error: XLookupError): string | undefined {
  const value = (error.value ?? error.resource_id)?.trim().replace(/^@/, "");
  return value && X_HANDLE_PATTERN.test(value) ? value : undefined;
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

function updateIdentityFromUser(
  identity: ContactIdentity,
  user: XUser,
  now: number,
  source: "x_api" | "x_web_anon",
): void {
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
    profileHydratedVia: source,
  });

  const avatarUrl = identity.avatarUrl?.trim() || tryAvatarUrl(user.profile_image_url) || null;
  updateIdentity(identity.id, {
    displayName: identity.displayName?.trim() ? identity.displayName : user.name,
    platformHandle: identity.platformHandle?.trim()
      ? identity.platformHandle
      : user.username,
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

function markIdentityMiss(
  identity: ContactIdentity,
  now: number,
  status: "not_found" | "suspended" = "not_found",
): void {
  const platformData = readPlatformData(identity.platformData);
  platformData.profileHydrationMiss = { at: now, status };
  updateIdentity(identity.id, { platformData: JSON.stringify(platformData) });
}

function cacheAnonHandleResolution(identity: ContactIdentity, handle: string, now: number): void {
  const platformData = readPlatformData(identity.platformData);
  platformData.anonHandleResolution = { handle, at: now };
  updateIdentity(identity.id, { platformData: JSON.stringify(platformData) });
}

function readAnonHandle(identity: ContactIdentity, now: number): string | undefined {
  const direct = identity.platformHandle?.trim().replace(/^@/, "");
  if (direct && /^[A-Za-z0-9_]{1,15}$/.test(direct)) return direct;
  const resolution = readPlatformData(identity.platformData).anonHandleResolution;
  if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)) return undefined;
  const record = resolution as Record<string, unknown>;
  return typeof record.handle === "string" && /^[A-Za-z0-9_]{1,15}$/.test(record.handle) &&
    isRecentTimestamp(record.at, now)
    ? record.handle
    : undefined;
}

/**
 * Move an identity from its handle to the resolved numeric X ID so later runs take the
 * indexed numeric path. Returns a reason when the ID could not move.
 */
function promoteIdentityUserId(
  identity: ContactIdentity,
  resolvedUserId: string,
  now: number,
): string | undefined {
  try {
    updateIdentity(identity.id, { platformUserId: resolvedUserId });
    return undefined;
  } catch (error) {
    // (platform, platform_user_id) is globally unique and the owner's own account is reserved,
    // so the resolved ID can already belong to another row. Keep the hydrated profile fields
    // and record why the ID stayed on the handle.
    const reason = error instanceof Error ? error.message : "Failed to persist resolved X user ID";
    const current = getIdentityById(identity.id) ?? identity;
    const platformData = readPlatformData(current.platformData);
    platformData.userIdPromotion = { status: "conflict", resolvedUserId, at: now, reason };
    try {
      updateIdentity(identity.id, { platformData: JSON.stringify(platformData) });
    } catch {
      // The conflict note is best-effort; the hydrated profile fields already landed.
    }
    return reason;
  }
}

/** Apply one resolved profile to an identity, promoting handle-keyed identities to their ID. */
function hydrateIdentity(
  identity: ContactIdentity,
  user: XUser,
  now: number,
  source: "x_api" | "x_web_anon",
  state: ContactState,
): void {
  const priorUserId = identity.platformUserId;
  updateIdentityFromUser(identity, user, now, source);
  state.updatedIdentityIds.push(identity.id);
  state.handles.push(`@${user.username}`);

  if (!isNumericUserId(priorUserId)) {
    const conflict = promoteIdentityUserId(identity, user.id, now);
    if (conflict) state.idConflicts.push(conflict);
  }

  const contact = getContactById(identity.contactId);
  const platformData = readPlatformData(identity.platformData);
  if (contact && isArchivePlaceholderName(contact.name, priorUserId, platformData)) {
    updateContact(contact.id, splitName(user.name));
    state.contactUpdated = true;
  }
}

/** Fold one anonymous-web outcome into the contact state. */
function applyWebOutcome(
  identity: ContactIdentity,
  webOutcome: XAnonWebOutcome | undefined,
  state: ContactState,
  now: number,
  requestLabel: string,
): void {
  if (!webOutcome) {
    state.failure = `Anonymous X hydration returned no result for ${requestLabel}`;
    return;
  }
  try {
    if (webOutcome.status === "hydrated") {
      hydrateIdentity(identity, webOutcome.user, now, "x_web_anon", state);
    } else if (webOutcome.status === "miss") {
      markIdentityMiss(identity, now, webOutcome.missStatus);
      state.notFound++;
      if (webOutcome.missStatus === "suspended") state.skipReason = "x_suspended";
    } else {
      if (webOutcome.resolvedHandle) {
        cacheAnonHandleResolution(identity, webOutcome.resolvedHandle, now);
      }
      state.skipReason = webOutcome.reason;
      state.skipDetail = webOutcome.detail;
    }
  } catch (error) {
    state.failure = error instanceof Error ? error.message : "Failed to update X profile";
  }
}

/** Shared X API failure mapping for one lookup chunk. Returns true when hydration must stop. */
function applyLookupFailure(
  error: unknown,
  chunkContactIds: Set<string>,
  states: Map<string, ContactState>,
): boolean {
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
    return true;
  }

  const currentAccount = getPlatformAccountByPlatform("x");
  if (currentAccount?.status === "needs_reauth") {
    for (const state of states.values()) {
      if (state.updatedIdentityIds.length === 0 && state.notFound === 0 && !state.failure) {
        state.skipReason = "x_reauth_required";
      }
    }
    return true;
  }

  const message = error instanceof Error ? error.message : "X profile lookup failed";
  for (const contactId of chunkContactIds) {
    const state = states.get(contactId);
    if (state) state.failure = message;
  }
  return false;
}

function optionalNumericOption(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Batch-compatible implementation used directly and for run-scoped preparation. */
async function hydrateXProfilesBatch(
  contactIds: string[],
  ctx: PipelineStepContext,
  lookup: XUserLookup = getUsersByIds,
  webTransport: XAnonWebTransport = hydrateXProfilesViaAnonWeb,
  handleLookup: XUsernameLookup = getUsersByUsernames,
): Promise<PipelineStepReport> {
  const account = getPlatformAccountByPlatform("x");
  if (account?.credentialsEncrypted && account.status === "needs_reauth") {
    return skipAll(contactIds, ctx, "x_reauth_required");
  }
  if (!account?.credentialsEncrypted && ctx.options?.webFallback === false) {
    return skipAll(contactIds, ctx, "x_not_connected");
  }

  const now = nowUnix();
  const outcomes = new Map<string, PipelineContactOutcome>();
  const states = new Map<string, ContactState>();
  const identitiesByUserId = new Map<string, ContactIdentity[]>();
  const identitiesByHandle = new Map<string, HandleGroup>();

  for (const contactId of contactIds) {
    const contact = getContactById(contactId);
    if (!contact) {
      outcomes.set(contactId, { contactId, status: "failed", reason: "Contact not found" });
      continue;
    }

    const xIdentities = listIdentitiesByContact(contactId).filter(
      (identity) => identity.isActive && identity.platform === "x",
    );
    if (xIdentities.length === 0) {
      outcomes.set(contactId, { contactId, status: "skipped", reason: "no_x_identity" });
      continue;
    }

    // Agent research, CSV import and manual entry all produce identities keyed by a handle
    // rather than a numeric ID. Those are hydratable by username, so only identities with
    // neither a numeric ID nor a usable handle are genuinely unresolvable.
    const identities = xIdentities.filter(
      (identity) =>
        isNumericUserId(identity.platformUserId) || resolvableHandle(identity) !== undefined,
    );
    if (identities.length === 0) {
      outcomes.set(contactId, { contactId, status: "skipped", reason: "x_identity_unresolved" });
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
      source: account?.credentialsEncrypted ? "x_api" : "x_web_anon",
      updatedIdentityIds: [],
      handles: [],
      notFound: 0,
      contactUpdated: false,
      idConflicts: [],
    });
    for (const identity of lookupIdentities) {
      if (isNumericUserId(identity.platformUserId)) {
        const matches = identitiesByUserId.get(identity.platformUserId) ?? [];
        matches.push(identity);
        identitiesByUserId.set(identity.platformUserId, matches);
        continue;
      }
      const handle = resolvableHandle(identity)!;
      const key = handle.toLowerCase();
      const group = identitiesByHandle.get(key) ?? { handle, identities: [] };
      group.identities.push(identity);
      identitiesByHandle.set(key, group);
    }
  }

  const userIds = [...identitiesByUserId.keys()];
  const handleKeys = [...identitiesByHandle.keys()];
  if (!account?.credentialsEncrypted) {
    const requests: XAnonWebRequest[] = [
      ...userIds.map((userId) => ({
        userId,
        knownHandle: (identitiesByUserId.get(userId) ?? [])
          .map((identity) => readAnonHandle(identity, now))
          .find((handle): handle is string => !!handle),
      })),
      ...handleKeys.map((key) => ({
        userId: `${HANDLE_REQUEST_PREFIX}${key}`,
        knownHandle: identitiesByHandle.get(key)!.handle,
        handleOnly: true,
      })),
    ];

    let webOutcomes: Map<string, XAnonWebOutcome>;
    try {
      webOutcomes = await webTransport(requests, {
        fetchImpl: ctx.fetchImpl,
        env: ctx.env,
        minRequestGapMs: optionalNumericOption(ctx.options?.minRequestGapMs),
      });
    } catch (error) {
      webOutcomes = new Map(requests.map((request) => [request.userId, {
        status: "skip" as const,
        reason: "x_web_unavailable",
        detail: { message: error instanceof Error ? error.message : "Anonymous X hydration failed" },
      }]));
    }

    for (const userId of userIds) {
      const webOutcome = webOutcomes.get(userId);
      for (const identity of identitiesByUserId.get(userId) ?? []) {
        const state = states.get(identity.contactId);
        if (!state || state.failure) continue;
        applyWebOutcome(identity, webOutcome, state, now, userId);
      }
    }

    for (const key of handleKeys) {
      const group = identitiesByHandle.get(key)!;
      const webOutcome = webOutcomes.get(`${HANDLE_REQUEST_PREFIX}${key}`);
      for (const identity of group.identities) {
        const state = states.get(identity.contactId);
        if (!state || state.failure) continue;
        applyWebOutcome(identity, webOutcome, state, now, `@${group.handle}`);
      }
    }
  } else {
    const accountId = account.id;
    // ID and handle lookups differ only in how a chunk is sent and how a returned user or
    // error maps back to its key, so both run through one chunk loop. Chunks stay sequential:
    // they share a rate limiter, and a credential-class failure has to stop the ones behind it.
    const batches: LookupBatch[] = [];
    for (let offset = 0; offset < userIds.length; offset += X_USER_LOOKUP_MAX_IDS) {
      const keys = userIds.slice(offset, offset + X_USER_LOOKUP_MAX_IDS);
      batches.push({
        keys,
        run: () => lookup(accountId, keys),
        keyForUser: (user) => user.id,
        keyForError: lookupErrorId,
        identitiesFor: (key) => identitiesByUserId.get(key) ?? [],
        describe: (key) => key,
      });
    }
    for (let offset = 0; offset < handleKeys.length; offset += X_USER_LOOKUP_MAX_USERNAMES) {
      const keys = handleKeys.slice(offset, offset + X_USER_LOOKUP_MAX_USERNAMES);
      batches.push({
        keys,
        run: () => handleLookup(accountId, keys.map((key) => identitiesByHandle.get(key)!.handle)),
        keyForUser: (user) => user.username.toLowerCase(),
        keyForError: (error) => lookupErrorUsername(error)?.toLowerCase(),
        identitiesFor: (key) => identitiesByHandle.get(key)?.identities ?? [],
        describe: (key) => `@${identitiesByHandle.get(key)?.handle ?? key}`,
      });
    }

    for (const batch of batches) {
      try {
        const response = await batch.run();
        const found = new Set<string>();
        const errored = new Set(
          response.errors
            .map(batch.keyForError)
            .filter((key): key is string => key !== undefined),
        );

        for (const user of response.users) {
          const key = batch.keyForUser(user);
          const identities = batch.identitiesFor(key);
          if (identities.length === 0 || found.has(key)) continue;
          found.add(key);
          for (const identity of identities) {
            const state = states.get(identity.contactId);
            if (!state || state.failure) continue;
            try {
              hydrateIdentity(identity, user, now, "x_api", state);
            } catch (error) {
              state.failure = error instanceof Error ? error.message : "Failed to update X profile";
            }
          }
        }

        for (const key of errored) {
          if (found.has(key)) continue;
          for (const identity of batch.identitiesFor(key)) {
            const state = states.get(identity.contactId);
            if (!state || state.failure) continue;
            try {
              markIdentityMiss(identity, now);
              state.notFound++;
            } catch (error) {
              state.failure = error instanceof Error ? error.message : "Failed to cache X profile miss";
            }
          }
        }

        for (const key of batch.keys) {
          if (found.has(key) || errored.has(key)) continue;
          for (const identity of batch.identitiesFor(key)) {
            const state = states.get(identity.contactId);
            if (state && !state.failure) {
              state.failure = `X lookup returned no result for ${batch.describe(key)}`;
            }
          }
        }
      } catch (error) {
        const chunkContacts = new Set(
          batch.keys.flatMap((key) =>
            batch.identitiesFor(key).map((identity) => identity.contactId),
          ),
        );
        if (applyLookupFailure(error, chunkContacts, states)) break;
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
          source: state.source,
          identityIds: state.updatedIdentityIds,
          handle: state.handles[0],
          ...(state.idConflicts.length > 0 ? { userIdConflicts: state.idConflicts } : {}),
        },
      });
    } else if (state.skipReason) {
      outcomes.set(state.contactId, {
        contactId: state.contactId,
        status: "skipped",
        reason: state.skipReason,
        detail: state.source === "x_web_anon"
          ? { source: "x_web_anon", ...(state.skipDetail ?? {}) }
          : state.skipDetail,
      });
    } else if (state.notFound > 0) {
      outcomes.set(state.contactId, {
        contactId: state.contactId,
        status: "skipped",
        reason: "not_found",
        ...(state.source === "x_web_anon" ? { detail: { source: "x_web_anon" } } : {}),
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

function reportForContacts(
  report: PipelineStepReport,
  contactIds: string[],
  stepId: string,
): PipelineStepReport {
  const requested = new Set(contactIds);
  return {
    stepId,
    outcomes: report.outcomes.filter((outcome) => requested.has(outcome.contactId)),
    aborted: report.aborted,
    ...(report.abortReason ? { abortReason: report.abortReason } : {}),
  };
}

/** Deterministic API-first, anonymous-web-fallback hydration for numeric and handle X identities. */
export async function hydrateXProfiles(
  contactIds: string[],
  ctx: PipelineStepContext,
  lookup: XUserLookup = getUsersByIds,
  webTransport: XAnonWebTransport = hydrateXProfilesViaAnonWeb,
  handleLookup: XUsernameLookup = getUsersByUsernames,
): Promise<PipelineStepReport> {
  const scope = ctx.runScope;
  if (!scope) {
    return hydrateXProfilesBatch(contactIds, ctx, lookup, webTransport, handleLookup);
  }

  const account = getPlatformAccountByPlatform("x");
  if (account?.credentialsEncrypted && account.status !== "needs_reauth") {
    const resourceKey = `${HYDRATE_X_PROFILES_HANDLER}:${ctx.stepId}:api-report`;
    let prepared = scope.resources.get(resourceKey) as Promise<PipelineStepReport> | undefined;
    if (!prepared) {
      prepared = hydrateXProfilesBatch(
        [...scope.contactIds],
        { ...ctx, runScope: undefined, recordContactOutcome: undefined },
        lookup,
        webTransport,
        handleLookup,
      );
      scope.resources.set(resourceKey, prepared);
    }
    return reportForContacts(await prepared, contactIds, ctx.stepId);
  }

  if (
    !account?.credentialsEncrypted &&
    ctx.options?.webFallback !== false &&
    webTransport === hydrateXProfilesViaAnonWeb
  ) {
    const resourceKey = `${HYDRATE_X_PROFILES_HANDLER}:${ctx.stepId}:anon-session`;
    let session = scope.resources.get(resourceKey) as ReturnType<typeof createXAnonWebSession> | undefined;
    if (!session) {
      session = createXAnonWebSession({
        fetchImpl: ctx.fetchImpl,
        env: ctx.env,
        minRequestGapMs: optionalNumericOption(ctx.options?.minRequestGapMs),
      });
      scope.resources.set(resourceKey, session);
      scope.deferCleanup(() => session?.dispose());
    }
    return hydrateXProfilesBatch(
      contactIds,
      { ...ctx, runScope: undefined },
      lookup,
      (requests) => session!.hydrate(requests),
      handleLookup,
    );
  }

  return hydrateXProfilesBatch(
    contactIds,
    { ...ctx, runScope: undefined },
    lookup,
    webTransport,
    handleLookup,
  );
}
