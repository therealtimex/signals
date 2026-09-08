import type { XUser } from "@/lib/platforms/x/client";
import {
  X_ANON_COOLDOWN_MS,
  X_ANON_DEFERRED_REASON,
  X_ANON_MIN_REQUEST_GAP_MS,
  X_ANON_PARSE_FAILURE_BREAK_THRESHOLD,
} from "@/lib/platforms/x/anon-web-constants";
import {
  createAnonHandleResolver,
  type XAnonBrowser,
  type XAnonHandleResolverFactory,
  type XAnonPageResult,
} from "@/lib/platforms/x/anon-browser-resolver";
import {
  parseCanonicalXProfileUrl,
  parseXWebProfile,
  type XWebProfile,
} from "@/lib/platforms/x/web-profile-parser";
import type { EnvLike } from "@/lib/rtx/env";

export type XAnonWebRequest = {
  /**
   * Key the outcome is returned under. Normally the numeric X user ID; for `handleOnly`
   * requests the caller supplies its own opaque key because no numeric ID is known yet.
   */
  userId: string;
  knownHandle?: string;
  /**
   * The identity only knows a handle. Fetch `knownHandle` directly and accept whichever
   * numeric ID the profile page reports instead of verifying it against `userId`.
   */
  handleOnly?: boolean;
};
export type XAnonWebOutcome =
  | { status: "hydrated"; user: XUser; resolvedHandle?: string }
  | { status: "miss"; missStatus: "not_found" | "suspended"; resolvedHandle?: string }
  | {
      status: "skip";
      reason: string;
      detail?: Record<string, unknown>;
      resolvedHandle?: string;
    };

export type XAnonWebTransportDeps = {
  /** Talks to the RTX browser-session API. Never used to fetch a profile: see `fetchProfile`. */
  fetchImpl: typeof fetch;
  env: EnvLike;
  resolver?: XAnonHandleResolverFactory;
  minRequestGapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

export type XAnonWebTransport = (
  requests: XAnonWebRequest[],
  deps: XAnonWebTransportDeps,
) => Promise<Map<string, XAnonWebOutcome>>;

export type XAnonWebSession = {
  hydrate: (requests: XAnonWebRequest[]) => Promise<Map<string, XAnonWebOutcome>>;
  dispose: () => Promise<void>;
};

type SkipOutcome = { status: "skip"; reason: string; detail?: Record<string, unknown> };

type FetchOutcome =
  | { status: "hydrated"; user: XUser }
  | { status: "miss"; missStatus: "not_found" | "suspended" }
  | SkipOutcome;

let cooldown: { until: number; reason: string } | null = null;

export function resetXAnonWebCooldownForTests(): void {
  cooldown = null;
}

export function webProfileToXUser(profile: XWebProfile): XUser {
  return {
    // Anonymous profiles name an ID only when the account publishes a banner. Callers must check
    // it before writing it: `hydrate_x_profiles` promotes only a value matching /^\d+$/.
    id: profile.id as XUser["id"],
    name: profile.name ?? `@${profile.handle}`,
    username: profile.handle,
    description: profile.description,
    location: profile.location,
    url: profile.websiteUrl,
    profile_image_url: profile.avatarUrl,
    created_at: profile.createdAt,
    public_metrics: {
      followers_count: profile.followersCount,
      following_count: profile.followingCount,
      tweet_count: profile.tweetCount,
      listed_count: undefined,
    } as unknown as XUser["public_metrics"],
    verified: undefined,
  };
}

/** Map one browser page result onto the transport's outcome vocabulary. */
function classifyPageResult(
  page: XAnonPageResult,
  userId: string | null,
  handle: string,
): FetchOutcome {
  switch (page.status) {
    case "rate_limited":
      return {
        status: "skip",
        reason: "x_web_rate_limited",
        ...(page.retryAfterSeconds === undefined ? {} : { detail: { retryAfter: page.retryAfterSeconds } }),
      };
    case "challenged":
      return { status: "skip", reason: "x_web_challenged" };
    case "login_wall":
      return { status: "skip", reason: "x_web_login_wall" };
    case "contaminated":
      return { status: "skip", reason: "x_anon_session_contaminated" };
    case "unexpected_redirect":
      return { status: "skip", reason: "x_web_unexpected_redirect" };
    case "timeout":
      return { status: "skip", reason: "x_web_http_timeout" };
    case "unavailable":
      return { status: "skip", reason: "x_web_unavailable", detail: { message: page.message } };
    case "ok":
      break;
  }

  const parsed = parseXWebProfile(page.html);
  if (parsed.status === "not_found" || parsed.status === "suspended") {
    return { status: "miss", missStatus: parsed.status };
  }
  // A 404 the markup did not explain is still X saying this handle has no account.
  if (page.httpStatus === 404) return { status: "miss", missStatus: "not_found" };
  if (page.httpStatus >= 400) return { status: "skip", reason: `x_web_http_${page.httpStatus}` };
  if (parsed.status === "shell") {
    return { status: "skip", reason: "x_web_parse_failed", detail: { parserReason: "shell" } };
  }
  if (parsed.status === "parse_failed") {
    return { status: "skip", reason: "x_web_parse_failed", detail: { parserReason: parsed.reason } };
  }
  if (userId !== null && parsed.profile.id !== undefined && parsed.profile.id !== userId) {
    return { status: "skip", reason: "x_web_id_mismatch" };
  }
  if (parsed.profile.handle.toLowerCase() !== handle.toLowerCase()) {
    return { status: "skip", reason: "x_web_unexpected_redirect" };
  }
  return { status: "hydrated", user: webProfileToXUser(parsed.profile) };
}

/**
 * A profile page names its numeric ID only when the account publishes a banner. Without one
 * there is nothing to check a caller-supplied handle against, so a handle that may have been
 * renamed or recycled cannot be trusted on its own.
 */
function isUnverifiedAgainst(outcome: FetchOutcome, userId: string): boolean {
  return outcome.status === "hydrated" && outcome.user.id !== userId;
}

function normalizeKnownHandle(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return parseCanonicalXProfileUrl(`https://x.com/${value.replace(/^@/, "")}`)?.handle;
}

function isImmediateBreaker(reason: string): boolean {
  return ["x_web_login_wall", "x_web_challenged", "x_web_rate_limited", "x_anon_session_contaminated"].includes(reason);
}

function isParseFailure(reason: string): boolean {
  return reason === "x_web_parse_failed" || reason === "x_web_id_mismatch" || reason.startsWith("x_web_http_");
}

function withResolvedHandle(outcome: FetchOutcome, handle: string): XAnonWebOutcome {
  return { ...outcome, resolvedHandle: handle } as XAnonWebOutcome;
}

export function createXAnonWebSession(deps: XAnonWebTransportDeps): XAnonWebSession {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const minGap = Math.max(0, deps.minRequestGapMs ?? X_ANON_MIN_REQUEST_GAP_MS);
  let lastRequestAt = 0;
  const pace = async () => {
    if (lastRequestAt > 0) {
      const target = minGap + Math.floor(random() * 501);
      const wait = target - (now() - lastRequestAt);
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = now();
  };

  let browser: XAnonBrowser | null = null;
  let consecutiveParseFailures = 0;
  let breakerReason: string | null = null;
  let disposed = false;

  const trip = (reason: string) => {
    breakerReason = reason;
    cooldown = { until: now() + X_ANON_COOLDOWN_MS, reason };
  };

  /** Advance the consecutive-parse-failure breaker for one completed request. */
  const recordOutcome = (outcome: FetchOutcome) => {
    if (outcome.status === "hydrated" || outcome.status === "miss") {
      consecutiveParseFailures = 0;
    } else if (isImmediateBreaker(outcome.reason)) {
      trip(outcome.reason);
    } else if (isParseFailure(outcome.reason)) {
      consecutiveParseFailures++;
      if (consecutiveParseFailures >= X_ANON_PARSE_FAILURE_BREAK_THRESHOLD) trip(outcome.reason);
    } else {
      consecutiveParseFailures = 0;
    }
  };

  /** Bring the shared anonymous browser up once per session. */
  const ensureBrowser = async (): Promise<XAnonBrowser | { error: SkipOutcome }> => {
    if (browser) return browser;
    try {
      browser = await (deps.resolver ?? createAnonHandleResolver)(deps.env, deps.fetchImpl);
      return browser;
    } catch (error) {
      return {
        error: {
          status: "skip",
          reason: "x_web_unavailable",
          detail: { message: error instanceof Error ? error.message : "Anonymous X browser unavailable" },
        },
      };
    }
  };

  const hydrate = async (requests: XAnonWebRequest[]) => {
    const outcomes = new Map<string, XAnonWebOutcome>();
    if (disposed) throw new Error("Anonymous X hydration session is disposed");
    if (breakerReason) {
      for (const request of requests) {
        outcomes.set(request.userId, { status: "skip", reason: breakerReason });
      }
      return outcomes;
    }
    if (cooldown && cooldown.until > now()) {
      for (const request of requests) {
        outcomes.set(request.userId, {
          status: "skip",
          reason: X_ANON_DEFERRED_REASON,
          detail: { cooldownReason: cooldown.reason },
        });
      }
      return outcomes;
    }
    cooldown = null;

    for (const request of requests) {
      if (breakerReason) {
        outcomes.set(request.userId, { status: "skip", reason: breakerReason });
        continue;
      }

      // Reject an unusable handle before paying for a browser.
      const requestedHandle = normalizeKnownHandle(request.knownHandle);
      if (request.handleOnly && !requestedHandle) {
        outcomes.set(request.userId, { status: "skip", reason: "x_handle_invalid" });
        continue;
      }

      const ready = await ensureBrowser();
      if ("error" in ready) {
        outcomes.set(request.userId, ready.error);
        breakerReason = ready.error.reason;
        continue;
      }

      if (request.handleOnly) {
        const handle = requestedHandle!;
        await pace();
        const fetched = classifyPageResult(await ready.fetchProfile(handle), null, handle);
        outcomes.set(request.userId, withResolvedHandle(fetched, handle));
        recordOutcome(fetched);
        continue;
      }

      const knownHandle = requestedHandle;
      if (knownHandle) {
        await pace();
        const page = await ready.fetchProfile(knownHandle);
        const direct = classifyPageResult(page, request.userId, knownHandle);
        const trustworthy = !isUnverifiedAgainst(direct, request.userId);
        if (trustworthy && (direct.status === "hydrated"
          || (direct.status === "miss" && direct.missStatus === "suspended"))) {
          outcomes.set(request.userId, direct);
          consecutiveParseFailures = 0;
          continue;
        }
        if (direct.status === "skip" && isImmediateBreaker(direct.reason)) {
          outcomes.set(request.userId, direct);
          trip(direct.reason);
          continue;
        }
        // A stale, recycled, or unverifiable handle is ambiguous. Let X redirect the numeric ID
        // to the handle it owns today before caching or skipping.
      }

      await pace();
      const resolved = await ready.resolve(request.userId);
      if (resolved.status === "terminal") {
        outcomes.set(request.userId, { status: "miss", missStatus: resolved.missStatus });
        consecutiveParseFailures = 0;
        continue;
      }
      if (resolved.status !== "resolved") {
        const reason = resolved.status === "login_wall"
          ? "x_web_login_wall"
          : resolved.status === "contaminated"
            ? "x_anon_session_contaminated"
            : resolved.status === "unavailable"
              ? "x_web_unavailable"
              : "x_web_resolve_failed";
        outcomes.set(request.userId, {
          status: "skip",
          reason,
          ...(resolved.status === "unavailable" ? { detail: { message: resolved.message } } : {}),
        });
        if (isImmediateBreaker(reason)) trip(reason);
        continue;
      }

      // `resolve` already left the tab on the profile X redirected to, so read it in place.
      const fetched = classifyPageResult(
        await ready.capturePage(resolved.handle),
        request.userId,
        resolved.handle,
      );
      outcomes.set(request.userId, withResolvedHandle(fetched, resolved.handle));
      recordOutcome(fetched);
    }

    return outcomes;
  };

  return {
    hydrate,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      const active = browser;
      browser = null;
      await active?.dispose().catch(() => undefined);
    },
  };
}

export const hydrateXProfilesViaAnonWeb: XAnonWebTransport = async (requests, deps) => {
  const session = createXAnonWebSession(deps);
  try {
    return await session.hydrate(requests);
  } finally {
    await session.dispose();
  }
};
