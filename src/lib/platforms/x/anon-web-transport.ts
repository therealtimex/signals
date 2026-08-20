import type { XUser } from "@/lib/platforms/x/client";
import {
  X_ANON_COOLDOWN_MS,
  X_ANON_DEFERRED_REASON,
  X_ANON_HTTP_MAX_BYTES,
  X_ANON_HTTP_TIMEOUT_MS,
  X_ANON_MAX_REDIRECTS,
  X_ANON_MIN_REQUEST_GAP_MS,
  X_ANON_PARSE_FAILURE_BREAK_THRESHOLD,
  X_ANON_USER_AGENT,
  isAllowedXNavigationOrigin,
} from "@/lib/platforms/x/anon-web-constants";
import {
  createAnonHandleResolver,
  type XAnonHandleResolver,
  type XAnonHandleResolverFactory,
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

type FetchOutcome =
  | { status: "hydrated"; user: XUser }
  | { status: "miss"; missStatus: "not_found" | "suspended" }
  | { status: "skip"; reason: string; detail?: Record<string, unknown> };

let cooldown: { until: number; reason: string } | null = null;

export function resetXAnonWebCooldownForTests(): void {
  cooldown = null;
}

export function webProfileToXUser(profile: XWebProfile): XUser {
  return {
    id: profile.id,
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

/** The sole anonymous HTTP request builder. Caller headers cannot be forwarded. */
export function anonXFetch(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Response> {
  return fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    credentials: "omit",
    signal,
    headers: {
      "user-agent": X_ANON_USER_AGENT,
      accept: "text/html",
      "accept-language": "en",
    },
  });
}

function retryAfter(response: Response, nowMs: number): number | undefined {
  const directRaw = response.headers.get("retry-after")?.trim();
  if (directRaw) {
    const direct = Number(directRaw);
    if (Number.isFinite(direct) && direct >= 0) return direct;
  }
  const resetRaw = response.headers.get("x-rate-limit-reset")?.trim();
  if (resetRaw) {
    const reset = Number(resetRaw);
    if (Number.isFinite(reset)) return Math.max(0, Math.ceil(reset - nowMs / 1000));
  }
  return undefined;
}

async function readCappedHtml(response: Response): Promise<string | null> {
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= X_ANON_HTTP_MAX_BYTES ? text : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > X_ANON_HTTP_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchProfile(
  userId: string | null,
  handle: string,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<FetchOutcome> {
  let currentUrl = `https://x.com/${handle}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), X_ANON_HTTP_TIMEOUT_MS);
  try {
    for (let redirects = 0; redirects <= X_ANON_MAX_REDIRECTS; redirects++) {
      if (!isAllowedXNavigationOrigin(currentUrl)) {
        return { status: "skip", reason: "x_web_unexpected_redirect" };
      }
      const response = await anonXFetch(currentUrl, fetchImpl, controller.signal);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === X_ANON_MAX_REDIRECTS) {
          return { status: "skip", reason: "x_web_unexpected_redirect" };
        }
        const nextUrl = new URL(location, currentUrl).href;
        if (!isAllowedXNavigationOrigin(nextUrl)) {
          return { status: "skip", reason: "x_web_unexpected_redirect" };
        }
        currentUrl = nextUrl;
        continue;
      }
      if (response.status === 429) {
        const seconds = retryAfter(response, nowMs);
        return {
          status: "skip",
          reason: "x_web_rate_limited",
          ...(seconds === undefined ? {} : { detail: { retryAfter: seconds } }),
        };
      }
      if (response.status === 403) return { status: "skip", reason: "x_web_challenged" };
      if (!response.ok) return { status: "skip", reason: `x_web_http_${response.status}` };
      if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) {
        return { status: "skip", reason: "x_web_parse_failed", detail: { parserReason: "non_html" } };
      }

      const finalProfile = parseCanonicalXProfileUrl(currentUrl);
      if (!finalProfile || finalProfile.handle.toLowerCase() !== handle.toLowerCase()) {
        return { status: "skip", reason: "x_web_unexpected_redirect" };
      }
      const html = await readCappedHtml(response);
      if (html === null) {
        return { status: "skip", reason: "x_web_parse_failed", detail: { parserReason: "body_too_large" } };
      }
      const parsed = parseXWebProfile(html);
      if (parsed.status === "not_found" || parsed.status === "suspended") {
        return { status: "miss", missStatus: parsed.status };
      }
      if (parsed.status === "shell") {
        return { status: "skip", reason: "x_web_parse_failed", detail: { parserReason: "shell" } };
      }
      if (parsed.status === "parse_failed") {
        return { status: "skip", reason: "x_web_parse_failed", detail: { parserReason: parsed.reason } };
      }
      if (userId !== null && parsed.profile.id !== userId) {
        return { status: "skip", reason: "x_web_id_mismatch" };
      }
      if (parsed.profile.handle.toLowerCase() !== handle.toLowerCase()) {
        return { status: "skip", reason: "x_web_unexpected_redirect" };
      }
      return { status: "hydrated", user: webProfileToXUser(parsed.profile) };
    }
    return { status: "skip", reason: "x_web_unexpected_redirect" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "skip", reason: "x_web_http_timeout" };
    }
    return {
      status: "skip",
      reason: "x_web_unavailable",
      detail: { message: error instanceof Error ? error.message : "Anonymous X fetch failed" },
    };
  } finally {
    clearTimeout(timeout);
  }
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

  let resolver: XAnonHandleResolver | null = null;
  let consecutiveParseFailures = 0;
  let breakerReason: string | null = null;
  let disposed = false;

  const trip = (reason: string) => {
    breakerReason = reason;
    cooldown = { until: now() + X_ANON_COOLDOWN_MS, reason };
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

      if (request.handleOnly) {
        const handle = normalizeKnownHandle(request.knownHandle);
        if (!handle) {
          outcomes.set(request.userId, { status: "skip", reason: "x_handle_invalid" });
          continue;
        }
        await pace();
        const fetched = await fetchProfile(null, handle, deps.fetchImpl, now());
        outcomes.set(request.userId, withResolvedHandle(fetched, handle));
        if (fetched.status === "hydrated" || fetched.status === "miss") {
          consecutiveParseFailures = 0;
        } else if (isImmediateBreaker(fetched.reason)) {
          trip(fetched.reason);
        } else if (isParseFailure(fetched.reason)) {
          consecutiveParseFailures++;
          if (consecutiveParseFailures >= X_ANON_PARSE_FAILURE_BREAK_THRESHOLD) trip(fetched.reason);
        } else {
          consecutiveParseFailures = 0;
        }
        continue;
      }

      let knownHandle = normalizeKnownHandle(request.knownHandle);
      if (knownHandle) {
        await pace();
        const direct = await fetchProfile(request.userId, knownHandle, deps.fetchImpl, now());
        if (direct.status === "hydrated" || direct.status === "miss" && direct.missStatus === "suspended") {
          outcomes.set(request.userId, direct);
          consecutiveParseFailures = 0;
          continue;
        }
        if (direct.status === "skip" && isImmediateBreaker(direct.reason)) {
          outcomes.set(request.userId, direct);
          trip(direct.reason);
          continue;
        }
        // A stale/recycled handle is ambiguous. Resolve the numeric ID once before caching/skipping.
        knownHandle = undefined;
      }

      if (!resolver) {
        try {
          resolver = await (deps.resolver ?? createAnonHandleResolver)(deps.env, deps.fetchImpl);
        } catch (error) {
          const outcome: XAnonWebOutcome = {
            status: "skip",
            reason: "x_web_unavailable",
            detail: { message: error instanceof Error ? error.message : "Anonymous X browser unavailable" },
          };
          outcomes.set(request.userId, outcome);
          breakerReason = outcome.reason;
          continue;
        }
      }

      await pace();
      const resolved = await resolver.resolve(request.userId);
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

      await pace();
      const fetched = await fetchProfile(request.userId, resolved.handle, deps.fetchImpl, now());
      outcomes.set(request.userId, withResolvedHandle(fetched, resolved.handle));
      if (fetched.status === "hydrated" || fetched.status === "miss") {
        consecutiveParseFailures = 0;
      } else if (isImmediateBreaker(fetched.reason)) {
        trip(fetched.reason);
      } else if (isParseFailure(fetched.reason)) {
        consecutiveParseFailures++;
        if (consecutiveParseFailures >= X_ANON_PARSE_FAILURE_BREAK_THRESHOLD) trip(fetched.reason);
      } else {
        consecutiveParseFailures = 0;
      }
    }

    return outcomes;
  };

  return {
    hydrate,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      const activeResolver = resolver;
      resolver = null;
      await activeResolver?.dispose().catch(() => undefined);
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
