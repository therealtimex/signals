# Anonymous X Web Hydration Fallback (`hydrate_x_profiles`, issue #186)

Extends `specs/contact-profile-pipeline-workflow.md` §5.4. When the official X API path is
unusable because no OAuth credentials exist, `hydrate_x_profiles` falls back to a best-effort
anonymous-web transport: numeric ID → canonical handle resolution in a dedicated logged-out
browser session, then anonymous HTTP fetch + parse of public profile HTML metadata, projected
through the **same fill-gaps-only write path** as the API transport.

Verified runtime evidence (2026-08-19, account `568879807`):
- Logged-out browser navigation to `https://x.com/i/user/568879807` client-side-resolves to
  `https://x.com/tri_dao` (Log in / Sign up visible — no authenticated user).
- Anonymous `curl https://x.com/tri_dao` returns HTML metadata with name, handle, bio, avatar,
  numeric identifier, canonical URL, and public counts.
- Anonymous `curl https://x.com/i/user/<id>` returns only the generic logged-out shell — the
  browser stage is required for numeric-only identities.

## 1. Scope & Hard Constraints

In scope: the `hydrate_x_profiles` pipeline step only. Out of scope (non-goals): automating a
connected user's X account, exporting/replaying cookies, any X mutation, treating private X web
APIs or page structure as a stable contract.

Non-negotiable invariants (each has a required test, §12):

- **I1 — API preferred.** When `platform_accounts.x` has `credentialsEncrypted`, the existing API
  path runs unchanged. The web fallback replaces **only** the `x_not_connected` early return.
- **I2 — no user credentials, ever.** The anonymous transport never reads, receives, or sends the
  connected user's cookies or tokens. Every anonymous HTTP request is sent with **no `Cookie` and
  no `Authorization` header**, enforced structurally (§5) and proven by test spies.
- **I3 — never `signals-publish`.** The anonymous browser session is a dedicated named session
  (`signals-x-anon`). The resolver refuses to operate on `RTX_PUBLISH_SESSION_NAME` and never
  loads `src/lib/browser/session.ts` stored sessions (those hold logged-in cookies).
- **I4 — X origins only.** Browser navigation and HTTP fetch accept only allowlisted X origins
  (§4.2, §5.2). Redirects and canonical URLs are validated per hop; anything else aborts.
- **I5 — fill-gaps-only.** Writes go through the existing `updateIdentityFromUser` projection via
  an adapter (§7), so user-edited contact/identity fields are preserved byte-for-byte identically
  to the API path.
- **I6 — best effort, never corrupting.** Page/metadata drift degrades to actionable retryable
  skips with circuit breaking (§9); it never writes partial garbage or exhausts the backlog
  (drain's `cleared > 0` guard already makes skip-only runs terminal, spec §9.2).
- **I7 — no live X in CI.** All tests use HTML fixtures and injected fakes (§12–13).

## 2. Transport Selection

```
account = getPlatformAccountByPlatform("x")
if account?.credentialsEncrypted:
    if account.status == "needs_reauth" -> skipAll("x_reauth_required")   (unchanged)
    else -> API path (unchanged, including mid-run x_rate_limited / x_access_restricted)
else:
    -> anonymous-web path (was: skipAll("x_not_connected"))
```

Decision D1: the fallback triggers **only** where `x_not_connected` triggers today — no account
row at all, or a browser-connect row (`authType: "session"`, `credentialsEncrypted: null` from
`ensureSessionPlatformAccount`). `needs_reauth` and mid-run API rate-limit/tier errors keep their
existing skips so credential problems stay visible instead of being silently rerouted. Trade-off:
a tier-restricted API install does not get web hydration in v1; acceptable, revisit if real.

Candidate selection (numeric-ID active X identities, `identityNeedsHydration`, 30-day
success/miss caches, per-user-ID dedup) is **shared** between both paths — refactor the existing
selection block in `hydrateXProfiles` into a helper both transports consume, so eligibility and
cache semantics cannot diverge.

## 3. Module Map

| File | Status | Contents |
|---|---|---|
| `src/lib/platforms/x/anon-web-constants.ts` | new | session name, limits, allowlists, UA (§10) |
| `src/lib/platforms/x/web-profile-parser.ts` | new | pure HTML → typed parse result (§6) |
| `src/lib/platforms/x/anon-browser-resolver.ts` | new | dedicated browser lifecycle + ID→handle (§4) |
| `src/lib/platforms/x/anon-web-transport.ts` | new | orchestration: resolve → fetch → parse → verify → adapt; pacing, breaker (§5, §8, §9) |
| `src/lib/workflows/pipeline/handlers/hydrate-x-profiles.ts` | modified | fallback branch, shared candidate selection, outcome mapping (§2, §7, §11) |
| `src/lib/platforms/x/web-fixtures/*.html` | new | sanitized captured fixtures (§13) |
| `specs/contact-profile-pipeline-workflow.md` §5.4 | modified | one-paragraph pointer to this spec |

Dependency direction: parser is pure (no I/O). Transport depends on parser + a resolver **port**
+ `ctx.fetchImpl`. Resolver owns all browser concerns. The pipeline handler depends only on the
transport's port type, injected with a default — mirroring the existing `lookup: XUserLookup =
getUsersByIds` injection style.

```ts
// anon-web-transport.ts
export type XAnonWebRequest = { userId: string; knownHandle?: string };
export type XAnonWebOutcome =
  | { status: "hydrated"; user: XUser }                       // XUser-shaped, §7
  | { status: "miss"; missStatus: "not_found" | "suspended" } // 30-day cacheable
  | { status: "skip"; reason: string; detail?: Record<string, unknown> }; // retryable
export type XAnonWebTransport = (
  requests: XAnonWebRequest[],
  deps: { fetchImpl: typeof fetch; env: EnvLike; resolver?: XAnonHandleResolverFactory },
) => Promise<Map<string, XAnonWebOutcome>>;

// anon-browser-resolver.ts
export type XAnonResolveResult =
  | { status: "resolved"; handle: string }
  | { status: "terminal"; missStatus: "not_found" | "suspended" }  // classified empty state
  | { status: "login_wall" }          // login/challenge interstitial → breaker
  | { status: "contaminated" }        // logged-in markers detected → abort transport
  | { status: "unavailable"; message: string }  // session couldn't start / RTX API down
  | { status: "timeout" };            // navigation never settled → retryable
export type XAnonHandleResolver = {
  resolve(userId: string): Promise<XAnonResolveResult>;
  dispose(): Promise<void>;
};
export type XAnonHandleResolverFactory = (
  env: EnvLike, fetchImpl: typeof fetch,
) => Promise<XAnonHandleResolver>;
```

## 4. Dedicated Anonymous Browser Session (resolver)

### 4.1 Identity & ownership

- `X_ANON_SESSION_NAME = "signals-x-anon"` — distinct from `RTX_PUBLISH_SESSION_NAME`
  (`signals-publish`). The resolver throws if asked to use the publish session name.
- The session is **owned by the hydration step**: acquired lazily (only when the fallback is
  engaged *and* at least one candidate needs browser resolution), disposed in a `finally` at step
  end (`stopRtxBrowserSession` best-effort + CDP client `browser.close()`).
- A module-level in-process mutex serializes acquisition: concurrent pipeline runs (different
  templates) queue rather than sharing a live resolver. Only one tab, only sequential
  navigation.

### 4.2 RTX-embedded mode (`isRtxEmbedded(env)`)

1. Register idempotently — `createRtxBrowserSession({ sessionName: X_ANON_SESSION_NAME,
   guardrails })` re-declared on every acquire (self-heal pattern from
   `ensureRtxPublishSessionRegistered`). Guardrails:
   `{ mode: "unrestricted", allowedOrigins: ["https://x.com", "https://twitter.com",
   "https://mobile.x.com"], blockedOrigins: [] }`. RTX guardrails fence top-level navigation;
   if implementation testing shows RTX also fences subresources, extend the allowlist with
   `https://pbs.twimg.com`, `https://abs.twimg.com`, `https://api.x.com`, `https://*.twimg.com`.
2. Start with the first resolve URL — `startRtxBrowserSession({ sessionName, url:
   "https://x.com/i/user/<id>" })`, then poll `listRtxBrowserSessions` +
   `resolveRtxDebugPort` for the debug port, `chromium.connectOverCDP`, and locate the x.com tab
   with `urlMatchesPlatformHost` (the RTX Browser hosts tabs itself; a CDP client cannot open
   one — #184). Subsequent IDs navigate the **same tab** via `page.goto` over CDP.
3. The persistent profile never logs in; it may accumulate X *guest* cookies, which is
   acceptable and expected (they reduce challenge frequency). Signals never reads, exports, or
   injects cookies into it.

### 4.3 Standalone mode (not RTX-embedded)

`chromium.launch({ headless: true })` + a **fresh non-persistent context** (no profile dir, no
`storageState`, no cookies) per acquisition. Attach `context.route("**/*")` and abort any request
whose origin is not in `X_ANON_ALLOWED_ORIGINS` (navigation origins + `pbs.twimg.com`,
`abs.twimg.com`, `api.x.com`, `*.twimg.com` assets). In RTX mode attempt the same
`page.route` attachment as defense-in-depth; failure to attach is non-fatal there because RTX
guardrails already fence navigation.

### 4.4 Logged-out invariant (contamination probe)

On the **first** settled page of each acquisition: probe `LOGGED_OUT_SELECTORS.x`
(`[data-testid="loginButton"]`) vs `X_LOGGED_IN_MARKERS` using the existing poll-probe pattern
(`browser-connection.ts`). If any logged-in marker is visible, or `isXLoggedInUrl` matches, the
resolver returns `contaminated`: the transport aborts entirely for the run, every remaining
candidate skips with `x_anon_session_contaminated`, the session is stopped (not deleted — a
human logged into it; surface guidance to sign out / delete `signals-x-anon` in Settings →
Browser). Nothing is fetched from a contaminated session.

### 4.5 Resolution & classification per numeric ID

Navigate to `https://x.com/i/user/<id>`, wait up to `X_ANON_NAV_TIMEOUT_MS = 20_000` for the URL
to leave `/i/user/…` (poll, reusing the redirect-grace pattern), then classify:

- Final URL passes `parseCanonicalXProfileUrl` (§6.4) → `resolved` with the extracted handle.
- URL on a login/challenge path (`isXLoggedOutUrl` login-flow markers, `/account/access`, or a
  visible challenge/interstitial) → `login_wall`.
- Page settles on an X empty-state (`[data-testid="emptyState"]` text): "doesn't exist" →
  `terminal/not_found`; "suspended" → `terminal/suspended`; any other empty-state text →
  `timeout`-class retryable (do **not** cache ambiguous states as misses).
- Otherwise → `timeout` (retryable).

## 5. Anonymous HTTP Fetch

### 5.1 Request shape

One helper builds every request; there is no other call site (structural enforcement of I2):

```ts
function anonXFetch(url: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "user-agent": X_ANON_USER_AGENT,
      accept: "text/html",
      "accept-language": "en",
    }, // exhaustive — never spread caller headers; no cookie, no authorization
  });
}
```

`X_ANON_USER_AGENT = "curl/8.7.1"` — matches the verified evidence exactly (X serves full profile
metadata to curl's UA). Deliberately not a browser impersonation and not the connected user's UA.
Single constant so behavior drift is a one-line fix.

### 5.2 Redirect & response policy

- Follow at most `X_ANON_MAX_REDIRECTS = 3` manual hops; every hop's absolute `Location` must
  have origin in `{"https://x.com", "https://twitter.com", "https://mobile.x.com"}`, else abort
  → skip `x_web_unexpected_redirect`.
- Final URL must satisfy `parseCanonicalXProfileUrl` and match the requested handle
  case-insensitively; mismatch → `x_web_unexpected_redirect`.
- `429` → skip `x_web_rate_limited` (+ `retryAfter` from `retry-after`/`x-rate-limit-reset` when
  present) → breaker. `403` → `x_web_challenged` → breaker. Other non-2xx → `x_web_http_<n>`
  retryable skip, counts toward the parse-failure breaker.
- Body read with a hard timeout `X_ANON_HTTP_TIMEOUT_MS = 15_000` (AbortController, like the
  gravatar probe) and size cap `X_ANON_HTTP_MAX_BYTES = 3_000_000`; content-type must contain
  `text/html`.

## 6. Parser Contract (`web-profile-parser.ts`)

Pure function; no network, no DB. Fixture-tested exhaustively.

```ts
export type XWebProfile = {
  id: string;                    // numeric, from JSON-LD identifier — REQUIRED
  handle: string;                // canonical, without '@'
  name?: string;
  description?: string;
  avatarUrl?: string;            // only if origin === https://pbs.twimg.com
  canonicalUrl?: string;         // https://x.com/<handle>
  location?: string;
  websiteUrl?: string;
  createdAt?: string;            // ISO, from JSON-LD dateCreated
  followersCount?: number;
  followingCount?: number;
  tweetCount?: number;           // listedCount is not exposed anonymously
};
export type XWebParseResult =
  | { status: "ok"; profile: XWebProfile }
  | { status: "shell" }              // generic logged-out app shell — ambiguous, never a miss
  | { status: "suspended" }          // explicit suspension marker in HTML
  | { status: "not_found" }          // explicit doesn't-exist marker in HTML
  | { status: "parse_failed"; reason: string };
```

Sources, in priority order:

1. **Schema.org ProfilePage metadata** — current anonymous responses use HTML microdata
   (`itemType="https://schema.org/ProfilePage"`); JSON-LD
   `<script type="application/ld+json">` is also accepted. The Person node
   (`mainEntity`/`author`) supplies `identifier` (numeric id), `additionalName` (handle),
   `name`, `description`, `image.contentUrl`/`thumbnailUrl` (avatar), `url` in `sameAs`/related
   links (website), `homeLocation.name`, `dateCreated`, and `interactionStatistic`
   (followers / friends → following / posts → tweets).
2. `<link rel="canonical">` for `canonicalUrl`.
3. OpenGraph/Twitter meta (`og:title` "Name (@handle)…", `og:description`, `og:image`) as
   fallback for name/handle/bio/avatar.

Rules:

- `status: "ok"` **requires** a numeric `id` and a valid `handle`. A page with og: data but no
  extractable numeric identifier is `parse_failed` ("no verifiable identifier") — the caller
  cannot cross-check it, so it must not hydrate (prevents handle-reuse poisoning).
- `avatarUrl` is dropped (left undefined) unless its origin is exactly `https://pbs.twimg.com`.
  Known size suffixes (`_normal`, `_200x200`, `_400x400`, `_bigger`) are normalized to `_normal`
  so the avatar step's existing `_normal → _400x400` upgrade keeps working (§7).
- Explicit suspension / doesn't-exist markers (title/og/empty-state strings captured in
  fixtures) → `suspended` / `not_found`. A page with none of: profile metadata, error marker →
  `shell`. Fixtures are authoritative; heuristics live only in the parser so drift is a
  parser-only change.
- Parsing is defensive: malformed JSON-LD falls through to og:; nothing throws.

### 6.4 Canonical profile URL validation (shared helper)

```ts
export function parseCanonicalXProfileUrl(rawUrl: string): { handle: string } | null;
```

Accepts only: origin exactly `https://x.com`, exactly one path segment matching
`/^[A-Za-z0-9_]{1,15}$/`, segment not in the reserved set (`home, i, explore, search, login,
signup, notifications, messages, settings, tos, privacy, about, intent, share, hashtag, compose,
account, flow`), no credentials/port in URL. Used by both the browser resolver (final URL) and
the HTTP redirect validator.

### 6.5 Identifier verification (transport)

`profile.id !== identity.platformUserId` →
- if the fetch used a possibly stale `knownHandle`: discard and fall through to browser
  resolution (the handle was renamed/recycled);
- if the fetch used a freshly browser-resolved handle: skip `x_web_id_mismatch` (retryable,
  counts toward breaker) — something is wrong, don't write.

## 7. Projection, Provenance, Avatar Handoff

**Decision D2:** the web profile is adapted to the existing `XUser` shape and written through the
**unchanged** `updateIdentityFromUser` + placeholder-name + `recalcContactEnrichment` blocks.
Fill-gaps semantics, archive-URL replacement, platformData deep-merge, stats refresh, and the
legacy avatar-projector workaround are inherited verbatim rather than reimplemented.

```ts
function webProfileToXUser(p: XWebProfile): XUser {
  return {
    id: p.id, name: p.name ?? `@${p.handle}`, username: p.handle,
    description: p.description, location: p.location, url: p.websiteUrl,
    profile_image_url: p.avatarUrl, created_at: p.createdAt,
    public_metrics: {
      followers_count: p.followersCount, following_count: p.followingCount,
      tweet_count: p.tweetCount, listed_count: undefined,
    } as XUser["public_metrics"],
    verified: undefined,
  };
}
```

Consequences (documented, accepted): counts the web cannot see are written as `null` — same
column semantics as an API refresh ("stats are refreshed, not gap-filled"); `isVerified`
defaults to `false` exactly as an API response without `verified` does; an existing (possibly
stale) `platformHandle` is preserved because handle is a fill-gaps field on both transports.

Provenance:
- Per-contact outcome `detail.source: "x_web_anon"` (API path keeps `"x_api"`).
- `platformData.profileHydratedVia: "x_web_anon" | "x_api"` written next to the existing
  `profileHydratedAt` (add to both transports for symmetry).
- Same-run avatar handoff is automatic: `updateIdentityFromUser` stores `profile_image_url` in
  `platformData` and fill-gaps `avatarUrl`; the avatar step's `recoverAvatarFromPlatformData`
  continues to work with no changes.

## 8. Caching, Idempotency, Backlog

| Cache | Location | TTL | Written when |
|---|---|---|---|
| Hydration success | `platformData.profileHydratedAt` (existing) | 30 d (`X_PROFILE_HYDRATE_RETRY_SECONDS`) | successful projection (either transport) |
| Terminal miss | `platformData.profileHydrationMiss = { at, status }` (existing, statuses extended to `"not_found" \| "suspended"`) | 30 d | **confident** classification only: parser `not_found`/`suspended`, or browser `terminal` empty state |
| ID→handle resolution | `platformData.anonHandleResolution = { handle, at }` (new) | 30 d | browser resolution succeeded but the run failed later (fetch/parse) — next run skips the browser stage |

`hasRecentMiss` extends its status check from `=== "not_found"` to the miss-status set; skip
reason `not_found_cached` continues to cover both. Transient outcomes (`shell`, login wall,
challenge, 429, parse failure, timeouts, contamination, unavailability) write **no marker** —
the contact stays retryable in the backlog, and drain cannot loop on it (spec §9.2 `cleared > 0`
guard).

Handle-first optimization (D3): a candidate whose identity already has a valid `platformHandle`
(e.g., archive backfill #181) or a fresh `anonHandleResolution` goes straight to HTTP fetch —
no browser work. The browser stage runs only for numeric-only or stale-handle identities, and a
`shell`/`not_found`/id-mismatch on a known-handle fetch falls back to one browser resolution
before giving up for the run.

## 9. Concurrency, Pacing, Circuit Breaker

- **Concurrency = 1.** One resolver tab, sequential navigations; HTTP fetches also sequential in
  v1 (`X_ANON_CONCURRENCY = 1`). Simplest, most conservative; the batch is ≤ 50 contacts.
- **Pacing:** `X_ANON_MIN_REQUEST_GAP_MS = 1_000` plus 0–500 ms jitter between successive
  anonymous requests (browser navigations and HTTP fetches share the pacer). Injectable clock/
  sleep so tests run instantly.
- **Per-run browser budget:** `X_ANON_MAX_BROWSER_RESOLUTIONS_PER_RUN = 10`. Candidates beyond
  the budget skip `x_web_deferred` (retryable; next run picks them up — batch order is stable).
- **Circuit breaker (per run, in the transport):**
  - trip immediately on `login_wall`, `contaminated`, `x_web_challenged`, `x_web_rate_limited`;
  - trip after `X_ANON_PARSE_FAILURE_BREAK_THRESHOLD = 3` consecutive
    `parse_failed`/`shell`/`x_web_http_*`/`x_web_id_mismatch` outcomes;
  - once tripped, all unprocessed candidates skip with the tripping reason (so run totals show
    what actually happened), the resolver is disposed, and no further anonymous traffic is sent.
- **Cross-run cooldown:** module-level in-memory `{ until }` set on breaker trip
  (`X_ANON_COOLDOWN_MS = 15 min`); while active, the transport short-circuits to the tripping
  skip reason without any network. Deliberately not persisted (D5): a process restart clearing
  the cooldown is acceptable; persistence would add schema for marginal value.

Decision D5: the account-scoped `rate-limiter.ts` is **not** reused — it keys on
`platform_accounts.id` and API endpoint patterns, neither of which exists here. Fixed pacing +
budget + breaker is the whole rate policy.

## 10. Constants (in `anon-web-constants.ts`)

```ts
export const X_ANON_SESSION_NAME = "signals-x-anon";
export const X_ANON_NAV_ORIGINS = ["https://x.com", "https://twitter.com", "https://mobile.x.com"];
export const X_ANON_ASSET_ORIGINS = ["https://pbs.twimg.com", "https://abs.twimg.com", "https://api.x.com"];
export const X_ANON_USER_AGENT = "curl/8.7.1";
export const X_ANON_NAV_TIMEOUT_MS = 20_000;
export const X_ANON_HTTP_TIMEOUT_MS = 15_000;
export const X_ANON_HTTP_MAX_BYTES = 3_000_000;
export const X_ANON_MAX_REDIRECTS = 3;
export const X_ANON_MIN_REQUEST_GAP_MS = 1_000;
export const X_ANON_MAX_BROWSER_RESOLUTIONS_PER_RUN = 10;
export const X_ANON_PARSE_FAILURE_BREAK_THRESHOLD = 3;
export const X_ANON_COOLDOWN_MS = 15 * 60 * 1000;
```

Overridable per step via existing `PipelineStepDecl.options`
(`{ webFallback?: boolean /* default true */, maxBrowserResolutions?, minRequestGapMs? }`) —
defaults live in code, so no seed-template migration is needed.

## 11. Outcome Taxonomy & Run Reporting

Statuses flow through the existing `PipelineContactOutcome` / `formatStepSummaryMessage` /
`PipelineRunResult` machinery with **no type changes**; new reasons aggregate automatically in
the `skipped` reason map and thread summaries (aggregate counts only — privacy §11 unchanged).

| Outcome | status | reason | cached? | notes |
|---|---|---|---|---|
| hydrated (web) | `updated` | — | 30 d success | `detail.source: "x_web_anon"` |
| doesn't exist | `skipped` | `not_found` | 30 d miss | same reason string as API path |
| suspended | `skipped` | `x_suspended` | 30 d miss (`status:"suspended"`) | |
| fresh / cached miss | `skipped` | `fresh` / `not_found_cached` | — | unchanged shared gate |
| login wall / challenge | `skipped` | `x_web_login_wall` / `x_web_challenged` | no | breaker |
| HTTP 429 | `skipped` | `x_web_rate_limited` (+`retryAfter`) | no | breaker |
| parse drift / shell / http error | `skipped` | `x_web_parse_failed` / `x_web_http_<n>` | no | breaker after 3 |
| id mismatch after fresh resolve | `skipped` | `x_web_id_mismatch` | no | breaker after 3 |
| resolve timeout / unclassified | `skipped` | `x_web_resolve_failed` | no | retryable |
| browser/RTX unavailable | `skipped` | `x_web_unavailable` | no | retryable |
| logged-in session detected | `skipped` | `x_anon_session_contaminated` | no | aborts run's web work |
| over browser budget / cooldown | `skipped` | `x_web_deferred` | no | retryable |
| DB write error | `failed` | message | no | same as API path |

Protected profiles: X serves name/bio/avatar metadata for protected accounts anonymously — they
hydrate as `updated`; only their posts are private. No special reason needed.
Renamed profiles: resolved by numeric ID to the new handle; missing fields fill; an existing
stale `platformHandle` is preserved by the fill-gaps contract (same as API path).

## 12. Security & Safety Tests (prove the invariants)

1. **No credentials on the wire (I2):** transport tests run with a spy `fetchImpl` that fails
   the assertion if any request carries a `cookie`/`authorization` header (any casing) or a
   non-allowlisted origin — asserted across success, redirect, retry, and breaker paths.
2. **Never signals-publish (I3):** resolver unit test asserts `X_ANON_SESSION_NAME !==
   RTX_PUBLISH_SESSION_NAME`; the resolver factory throws when constructed with the publish
   session name; a fake RTX CLI records every session-name argument and the test asserts only
   `signals-x-anon` appears. No import of `loadSession`/`createSessionContext` from the anon
   modules (lint-greppable assertion in test).
3. **Origin fencing (I4):** redirect to `https://evil.example` aborts; final-URL mismatch
   aborts; standalone `context.route` filter aborts non-allowlisted requests (unit-test the
   filter predicate).
4. **Contamination (§4.4):** fake resolver returning `contaminated` → every candidate skips
   `x_anon_session_contaminated`, zero fetches issued.
5. **API preference (I1):** account with credentials → `lookup` called, web transport never
   invoked; account without credentials → web transport invoked, `lookup` never called;
   `needs_reauth` with credentials → `x_reauth_required`, neither invoked.

## 13. Test Plan (fixtures/mocks only — no live X)

- **Parser** (`web-profile-parser.test.ts` + `web-fixtures/*.html`): sanitized captured fixtures
  for full profile (JSON-LD + og), og-only (no JSON-LD → `parse_failed` on missing identifier),
  generic logged-out shell, suspended, doesn't-exist, protected-with-metadata, malformed JSON-LD,
  oversized/truncated HTML. Field-level assertions incl. avatar origin filter + suffix
  normalization, counts mapping, canonical URL.
- **Resolver:** unit tests with a fake CDP/page layer for classification (resolved / login wall /
  empty states / timeout / contaminated), mutex serialization, dispose-on-finally, publish-name
  refusal. No real browser in CI.
- **Transport:** fake resolver + spy fetch: handle-first path, browser fallback on stale handle,
  redirect validation, identifier verification both directions, pacing (injected sleeper),
  budget, every breaker trigger, cooldown short-circuit, outcome map completeness.
- **Handler** (`hydrate-x-profiles.test.ts` extension): fallback trigger matrix (§12.5),
  fill-gaps preservation of user-edited fields, placeholder contact-name update, miss caching +
  `not_found_cached` on both miss statuses, `anonHandleResolution` write/consume, provenance
  fields, enrichment recalc, and an integration-style test that runs `hydrate` then
  `enrich_contact_avatars` to prove the same-run avatar handoff (web-sourced
  `profile_image_url` → `avatarUrl` with `_400x400` upgrade).
- `npm run check` green.

## 14. Acceptance Matrix (issue #186 AC → design → test)

| AC | Design | Test |
|---|---|---|
| Numeric ID resolves in demonstrably logged-out dedicated session | §4.1–4.5 | §13 resolver; §12.2/12.4 |
| Canonical page fetched w/o cookies/auth; yields name, handle, bio, avatar, canonical URL, counts | §5, §6 | §12.1; §13 parser |
| Fill-gaps only; user edits preserved | §7 (D2) | §13 handler |
| Anonymous-web provenance + enrichment recalc | §7 | §13 handler |
| API preferred when usable | §2 (D1) | §12.5 |
| Missing credentials falls back instead of `x_not_connected` | §2 | §12.5 |
| Renamed/suspended/missing/protected/challenged/rate-limited/malformed → bounded retryable outcomes | §6, §8, §9, §11 | §13 transport/parser |
| Cached/idempotent; fresh profiles not re-fetched | §8 | §13 handler |
| Run detail/totals distinguish hydrated, skipped, challenged/rate-limited, remaining backlog | §11 (reason map + `detail.source`; `remainingBacklog` unchanged) | §13 handler |
| Tests prove no user-session credentials and never `signals-publish` | §12.1–12.2 | §12 |
| Focused tests + `npm run check` pass | §13 | CI |

## 15. Design Decisions (mini-ADRs)

- **D1 Fallback scope = `x_not_connected` branch only.** Keeps credential problems visible;
  gives up web hydration for reauth/tier-restricted installs (revisit on demand).
- **D2 Adapter into `updateIdentityFromUser`.** One projection to maintain; write semantics
  provably identical. Gives up web-only fields that don't fit `XUser` (none needed today).
- **D3 Handle-first, browser-second.** Minimizes browser dependency and X traffic; costs one
  wasted HTTP fetch when a known handle is stale.
- **D4 Dedicated RTX session `signals-x-anon`, per-run acquire/stop, in-process mutex.**
  Auditable in RTX Settings → Browser; persistent guest profile reduces challenges. Gives up
  per-run cold anonymity in RTX mode (standalone mode is fully cold each run).
- **D5 No account-scoped rate-limiter reuse; in-memory cooldown only.** Simpler; cooldown lost
  on restart is an accepted bound.
- **D6 Ambiguity never caches a miss.** Only browser-classified or explicitly-marked terminal
  states write 30-day misses; the generic shell is always retryable. Prevents page drift from
  silently freezing the backlog for a month.
- **D7 curl UA constant.** Matches the only verified-working evidence; honest, deterministic,
  one-line revisable. Gives up browser-UA camouflage on the HTTP stage (browser stage covers the
  paths that need a real browser).

## 16. Implementation Order (dev slices)

1. Parser + fixtures (+ `parseCanonicalXProfileUrl`) — pure, fastest feedback.
2. Constants + anon fetch helper + redirect validator + transport skeleton with fake resolver
   (pacing, breaker, cooldown, outcome map).
3. Browser resolver (RTX + standalone lifecycle, contamination probe, classification, mutex).
4. Handler integration: shared candidate selection refactor, fallback branch, adapter,
   miss-status extension, `anonHandleResolution`, provenance.
5. Handler/avatar-handoff/security test suites; spec §5.4 pointer edit; `npm run check`.

Slices 1–2 and 3 are parallelizable; 4 depends on both.
