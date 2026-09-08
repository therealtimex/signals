# Anonymous X Web Hydration Fallback (`hydrate_x_profiles`, issue #186)

Extends `specs/contact-profile-pipeline-workflow.md` §5.4. When the official X API path is
unusable because no OAuth credentials exist, `hydrate_x_profiles` falls back to a best-effort
anonymous-web transport: every read runs in a dedicated logged-out browser session — numeric ID →
canonical handle resolution, then the profile page's public metadata — projected through the
**same fill-gaps-only write path** as the API transport.

> **Revised 2026-09-06 (issue #438).** The original design fetched profile pages over plain HTTP
> with a `curl/8.7.1` user agent. That stopped working: X now serves a metadata-free shell to any
> non-browser client, so the transport parsed nothing, tripped its own breaker every third
> request, and hydrated no one. §5 and §6 below describe the browser-based replacement. The
> superseded HTTP design is recorded in ADR-8.

Verified runtime evidence (2026-09-06, headed Chrome, no storage state, `loggedIn: false`
asserted in-page):
- Logged-out navigation to `https://x.com/i/user/568879807` resolves to `https://x.com/tri_dao`,
  unchanged from the original evidence. The browser stage still works.
- `https://x.com/DrJimFan` returns `og:title` "Jim Fan (@DrJimFan) on X", `og:description` (full
  bio), `og:image` `pbs.twimg.com/profile_images/…_200x200.jpg`, `link rel=canonical`, and
  `twitter:label2`/`twitter:data2` = "Joined" / "December 2012" — **in the initial response body**,
  before any script runs.
- `application/ld+json` is **absent**, in the browser as well as over HTTP. The original primary
  parser source is gone for good; `og:*` and `twitter:*` replace it.
- `curl https://x.com/DrJimFan` returns 240 KB with 57 meta tags and **no** `og:title`,
  `og:image`, or canonical link — the app shell. Sending a real Chrome user agent changes
  nothing, so the gate is not the UA and not JavaScript execution. Headless Chrome is refused
  outright (403 / `ERR_HTTP_RESPONSE_CODE_FAILURE`).
- A missing handle answers **404** with `og:title` "User Profile Not Found - X | 404 Error" and a
  body reading "this page doesn't exist"; a real account with no picture (`torvalds`) answers 200
  with an `abs.twimg.com/sticky/default_profile_images/…` avatar. The two are distinguishable.
- `twitter:image` is `pbs.twimg.com/profile_banners/<numeric user id>/<ts>` when the account has a
  banner. Both IDs sampled this way round-trip: `x.com/i/user/3888491` → `LinusEkenstam`,
  `x.com/i/user/1007413134` → `DrJimFan`. Accounts without a banner publish no `twitter:image`,
  so the numeric ID is **optional** now (§6, §6.5).

## 1. Scope & Hard Constraints

In scope: the `hydrate_x_profiles` pipeline step only. Out of scope (non-goals): automating a
connected user's X account, exporting/replaying cookies, any X mutation, treating private X web
APIs or page structure as a stable contract.

Non-negotiable invariants (each has a required test, §12):

- **I1 — API preferred.** When `platform_accounts.x` has `credentialsEncrypted`, the existing API
  path runs unchanged. The web fallback replaces **only** the `x_not_connected` early return.
- **I2 — no user credentials, ever.** The anonymous transport never reads, receives, or sends the
  connected user's cookies or tokens. It owns a dedicated logged-out browser session and reads
  only through it (§4, §5); the contamination probe (§4.4) aborts the run if that session ever
  shows a signed-in marker. Proven by test spies over the session lifecycle calls.
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

Candidate selection (active X identities keyed by a numeric ID **or** by a resolvable handle,
`identityNeedsHydration`, 30-day success/miss caches, per-user-ID and per-handle dedup) is
**shared** between both paths — refactor the existing selection block in `hydrateXProfiles` into
a helper both transports consume, so eligibility and cache semantics cannot diverge. Handle-keyed
identities are grouped under a lowercased handle key and dispatched as `handleOnly` requests
(§4.5, §6.5, §11).

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
- The session is **owned by the pipeline run scope**: acquired lazily (only when the fallback is
  engaged *and* at least one candidate needs browser resolution), reused as contact-major
  execution interleaves hydration with avatar/persona work, and disposed by deferred cleanup in a
  `finally` at run end (`stopRtxBrowserSession` best-effort + CDP client `browser.close()`). Direct
  batch callers use the same session abstraction and dispose it when their batch returns.
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

Only numeric-ID requests reach the resolver. A `handleOnly` request already carries its handle,
so the session never opens the browser for it (§11).

Navigate to `https://x.com/i/user/<id>`, wait up to `X_ANON_NAV_TIMEOUT_MS = 20_000` for the URL
to leave `/i/user/…` (poll, reusing the redirect-grace pattern), then classify:

- Final URL passes `parseCanonicalXProfileUrl` (§6.4) → `resolved` with the extracted handle.
- URL on a login/challenge path (`isXLoggedOutUrl` login-flow markers, `/account/access`, or a
  visible challenge/interstitial) → `login_wall`.
- Page settles on an X empty-state (`[data-testid="emptyState"]` text): "doesn't exist" →
  `terminal/not_found`; "suspended" → `terminal/suspended`; any other empty-state text →
  `timeout`-class retryable (do **not** cache ambiguous states as misses).
- Otherwise → `timeout` (retryable).

## 5. Anonymous Profile Read (browser)

### 5.1 Why there is no HTTP client here

X answers a plain HTTP client with an app shell containing none of the profile metadata, whatever
user agent it claims, and refuses headless Chrome outright. The only client it serves is a headed
browser — and the resolver already owns one. So `XAnonBrowser` (in `anon-browser-resolver.ts`)
exposes both stages and the transport never calls `fetch` for a profile:

```ts
export type XAnonBrowser = {
  resolve(userId: string): Promise<XAnonResolveResult>;      // /i/user/<id> → handle
  fetchProfile(handle: string): Promise<XAnonPageResult>;    // navigate to /<handle>
  capturePage(expectedHandle: string): Promise<XAnonPageResult>;  // read without navigating
  dispose(): Promise<void>;
};
```

`deps.fetchImpl` survives only to reach the RTX browser-session REST API. A transport test asserts
it is never called for a profile.

`capturePage` exists because `resolve` **leaves the tab on the canonical profile X redirected
to**. Reading it in place makes the numeric path cost one page load instead of two.

### 5.2 Landing & response policy

- Navigation uses `waitUntil: "domcontentloaded"` with `X_ANON_NAV_TIMEOUT_MS = 20_000`. The
  metadata is server-rendered, so no settle delay is needed.
- Redirects are followed by the browser, and the **origin fence** (`page.route`, §4.2) aborts any
  request off the X/twimg allowlist, so a redirect off-origin fails the navigation rather than
  being followed.
- The landed URL must satisfy `parseCanonicalXProfileUrl` (§6.4) and match the requested handle
  case-insensitively → else `unexpected_redirect`. A login/challenge path → `login_wall`.
- `429` → `rate_limited` (+ `retryAfterSeconds` from `retry-after`/`x-rate-limit-reset` on the
  navigation response) → breaker. `403` → `challenged` → breaker.
- Every other status, **including 404**, returns `ok` with the markup and the status. The page,
  not the status line, distinguishes "no such account" from "suspended" (§6). A 404 the markup did
  not explain is still treated as `not_found`.
- Headless is not an option: the local standalone fallback launches `headless: false` with
  `X_ANON_BROWSER_ARGS` and a real user agent, matching what `src/lib/browser/session.ts` already
  does for every other browser path in this repo.

## 6. Parser Contract (`web-profile-parser.ts`)

Pure function; no network, no DB. Fixture-tested exhaustively.

```ts
export type XWebProfile = {
  id?: string;                   // numeric; only when the page names one (§6.5)
  handle: string;                // canonical, without '@'
  name?: string;
  description?: string;
  avatarUrl?: string;            // only if origin === https://pbs.twimg.com
  canonicalUrl?: string;         // https://x.com/<handle>
  location?: string;
  websiteUrl?: string;
  createdAt?: string;            // ISO; month precision when read from "Joined <Month> <Year>"
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

1. **Schema.org ProfilePage metadata** — HTML microdata
   (`itemType="https://schema.org/ProfilePage"`) or JSON-LD
   `<script type="application/ld+json">`. The Person node supplies `identifier` (numeric id),
   `additionalName` (handle), `name`, `description`, `image.contentUrl`/`thumbnailUrl`,
   `sameAs`/`url` (website), `homeLocation.name`, `dateCreated`, and `interactionStatistic`.
   **Neither form appears in anonymous responses any more** (evidence, above). The readers stay
   because they cost nothing and X has served both before; nothing may depend on them.
2. `<link rel="canonical">` for `canonicalUrl` and handle.
3. **OpenGraph/Twitter meta — the live source.** `og:title` "Name (@handle) on X" → name and
   handle; `og:description` → bio; `og:image` → avatar; `twitter:image` → the numeric user ID,
   when it is a `profile_banners/<id>/…` URL; `twitter:label2`/`twitter:data2` → join month.

Rules:

- `status: "ok"` requires a valid `handle` and at least one profile signal; `id` is **optional**,
  because X names it anonymously only for accounts that publish a banner. The handle-reuse
  poisoning this rule used to prevent is now handled where it belongs, in the transport: a
  caller that already knows the numeric ID re-resolves through `/i/user/<id>` whenever the page
  cannot confirm it (§6.5). A page with neither profile metadata nor an error marker is still
  `shell`.
- `createdAt` from `twitter:data2` is month precision ("December 2012" → `2012-12-01T00:00:00Z`),
  so §7 only ever lets it fill a gap, never overwrite an API timestamp.
- `avatarUrl` is dropped (left undefined) unless its origin is exactly `https://pbs.twimg.com`
  **and** its path starts with `/profile_images/`. That excludes both the default egg
  (`abs.twimg.com/sticky/default_profile_images/…`) and banner URLs on the same origin, so an
  account with no picture falls through to initials instead of caching a grey egg.
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

The numeric ID is now evidence the page may or may not carry, so verification is stated as: **a
caller-supplied handle is only trusted when the page proves it still belongs to the requested ID.**

| request | ID on the page | outcome |
|---|---|---|
| `handleOnly` (no ID to check) | any | hydrate; the page's ID, if present, *is* the answer |
| `knownHandle` + numeric `userId` | matches | hydrate |
| `knownHandle` + numeric `userId` | differs | re-resolve through `/i/user/<id>` |
| `knownHandle` + numeric `userId` | **absent** | re-resolve through `/i/user/<id>` |
| browser-resolved handle | any | hydrate — X's own redirect established the binding |

The last-but-one row is the one that changed. A banner-less page cannot prove the handle was not
renamed or recycled, so it is not trusted on its own; X redirecting `/i/user/<id>` to a handle is
the authority, and the resolver's landing page is read in place (§5.1), so this costs one extra
navigation and never a wrong write.

Once a handle is browser-resolved, no ID check is applied: the redirect *is* the id→handle
binding, and re-checking it against a page that may not name an ID would reject valid profiles.

An identity is only promoted to a numeric `platformUserId` when the profile actually named one
(`/^\d+$/`); otherwise it stays handle-keyed and is retried later.

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
  v1 (`X_ANON_CONCURRENCY = 1`). Contact-major execution places downstream avatar/persona work
  between contacts without permitting concurrent X traffic; the batch is ≤ 50 contacts.
- **Pacing:** `X_ANON_MIN_REQUEST_GAP_MS = 1_000` plus 0–500 ms jitter between successive
  anonymous requests (browser navigations and HTTP fetches share the pacer). Injectable clock/
  sleep so tests run instantly.
- **Run volume bound:** the profile pipeline's existing `PROFILE_PIPELINE_MAX_BATCH = 50` cap is
  the only per-run contact limit. Anonymous resolutions are not truncated below that visible cap.
- **Circuit breaker (per run, in the transport):**
  - trip immediately on `login_wall`, `contaminated`, `x_web_challenged`, `x_web_rate_limited`;
  - trip after `X_ANON_PARSE_FAILURE_BREAK_THRESHOLD = 3` consecutive
    `parse_failed`/`shell`/`x_web_http_*`/`x_web_id_mismatch` outcomes;
  - once tripped, all unprocessed candidates skip with the tripping reason (so run totals show
    what actually happened), no further anonymous traffic is sent, and the resolver is disposed
    by the run's guaranteed cleanup.
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
export const X_ANON_BROWSER_ARGS = ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"];
export const X_ANON_BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; …) Chrome/131.0.0.0 Safari/537.36";
export const X_ANON_NAV_TIMEOUT_MS = 20_000;
export const X_ANON_MIN_REQUEST_GAP_MS = 1_000;
export const X_ANON_PARSE_FAILURE_BREAK_THRESHOLD = 3;
export const X_ANON_COOLDOWN_MS = 15 * 60 * 1000;
```

The HTTP constants (`X_ANON_USER_AGENT`, `X_ANON_HTTP_TIMEOUT_MS`, `X_ANON_HTTP_MAX_BYTES`,
`X_ANON_MAX_REDIRECTS`) are gone with the HTTP transport; the browser enforces the navigation
timeout, the redirect policy, and the response size.

Overridable per step via existing `PipelineStepDecl.options`
(`{ webFallback?: boolean /* default true */, minRequestGapMs? }`) —
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
| active anonymous-session cooldown | `skipped` | `x_web_deferred` | no | retryable |
| unusable handle (handle-only) | `skipped` | `x_handle_invalid` | no | malformed or reserved handle; no network call |
| DB write error | `failed` | message | no | same as API path |

Protected profiles: X serves name/bio/avatar metadata for protected accounts anonymously — they
hydrate as `updated`; only their posts are private. No special reason needed.
Renamed profiles: resolved by numeric ID to the new handle; missing fields fill; an existing
stale `platformHandle` is preserved by the fill-gaps contract (same as API path). A `handleOnly`
request has no ID to resolve from, so a rename is reported as `x_web_unexpected_redirect` instead
(§6.5).

Handle-only requests: `XAnonWebRequest.handleOnly` marks a request whose `userId` is an opaque
caller-supplied key, not a numeric X ID — the caller has no ID yet. The session fetches
`https://x.com/<knownHandle>` directly, never opens the resolver, and returns the outcome under
that key. `normalizeKnownHandle` rejects malformed and reserved handles up front (via
`parseCanonicalXProfileUrl` → `validHandle`, which filters `X_RESERVED_HANDLES`), so garbage
cannot reach the network, trip the login wall, or break the circuit for the rest of the batch. A
hydrated result promotes the identity to the numeric ID the page reported — see
[`contact-profile-pipeline-workflow.md`](./contact-profile-pipeline-workflow.md) §5.4 for the
promotion and unique-index conflict contract.

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
- **D3 Handle-first, browser-second.** ~~Minimizes browser dependency~~ — superseded by ADR-8;
  every read is a browser read now. Handle-first survives as *navigate straight to `/<handle>`
  when one is known*, which still saves the `/i/user/<id>` hop; it costs one wasted navigation
  when the handle is stale or unverifiable (§6.5).
- **D4 Dedicated RTX session `signals-x-anon`, per-run acquire/stop, in-process mutex.**
  Auditable in RTX Settings → Browser; persistent guest profile reduces challenges. Gives up
  per-run cold anonymity in RTX mode (standalone mode is fully cold each run).
- **D5 No account-scoped rate-limiter reuse; in-memory cooldown only.** Simpler; cooldown lost
  on restart is an accepted bound.
- **D6 Ambiguity never caches a miss.** Only browser-classified or explicitly-marked terminal
  states write 30-day misses; the generic shell is always retryable. Prevents page drift from
  silently freezing the backlog for a month.
- **D7 curl UA constant.** ~~Matches the only verified-working evidence~~ — superseded by ADR-8.
  The evidence expired and nothing detected it, which is the real lesson: the transport's only
  signal was `x_web_parse_failed`, a reason it also emits for ordinary drift.
- **D8 (2026-09-06, issue #438) Read every anonymous profile through the browser.** X stopped
  serving profile metadata to non-browser clients, so the HTTP transport in the original §5 could
  not work regardless of parsing. Rejected alternatives: **retire the anonymous path** (the data
  is public and reachable, so this discards working capability); **fail fast with a distinct
  reason** (honest, but still hydrates nobody); **fingerprint-matched HTTP client** (a real
  browser's TLS/HTTP2 signature is what X actually checks — chasing it is unbounded maintenance,
  and the resolver already owns a compliant browser). Cost: the numeric path pays a browser
  navigation it used to skip, and the local standalone fallback opens a visible window. Both were
  already true of the resolver stage.
- **D9 Numeric ID is optional evidence, not a precondition.** The old "no id ⇒ `parse_failed`"
  rule was a parser-level proxy for handle-reuse safety. With the ID usually absent it would
  reject nearly every real profile, so the check moved to the transport, where it can respond by
  re-resolving rather than by refusing (§6.5). Strictly safer: the parser refused, the transport
  verifies.

## 16. Implementation Order (dev slices)

1. Parser + fixtures (+ `parseCanonicalXProfileUrl`) — pure, fastest feedback.
2. Constants + anon fetch helper + redirect validator + transport skeleton with fake resolver
   (pacing, breaker, cooldown, outcome map).
3. Browser resolver (RTX + standalone lifecycle, contamination probe, classification, mutex).
4. Handler integration: shared candidate selection refactor, fallback branch, adapter,
   miss-status extension, `anonHandleResolution`, provenance.
5. Handler/avatar-handoff/security test suites; spec §5.4 pointer edit; `npm run check`.

Slices 1–2 and 3 are parallelizable; 4 depends on both.
