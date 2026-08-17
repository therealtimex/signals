# P6a — X publish via RTX Browser (browser-only)

**Status:** **Approved v1.1** — System Design, 2026-08-16 (v1 2026-08-16; v1.1 auth amendment §4.3 approved)  
**Epic:** [#1](https://github.com/therealtimex/signals/issues/1) · **Companion:** [#116](https://github.com/therealtimex/signals/issues/116) (CLI lane)  
**Supersedes (in part):** in-process `publishToX` / Signals Playwright session for X publish only

## 1. Scope

Migrate **X (Twitter) content publishing** from Signals in-process Playwright (`src/lib/browser/publishers/x-publisher.ts`) to **RealTimeX Browser + deterministic CDP automation**.

### In scope (P6a)

1. **Auto-publish** — headless/scripted flow posts tweet or thread without user clicking Post in UI
2. **Review-publish** — automation opens compose, fills text/media, leaves RTX Browser tab open for human to click Post; Signals polls for completion
3. **Wire `POST /api/content/publish`** (`platform: "x"`) to the new executor (preserve request/response contract)
4. **Session model** — logged-in X tab on RTX Browser; **no** Signals `~/.signals/sessions/` cookie jar for publish
5. **Error taxonomy** — preserve `PublishErrorCode` semantics (`session_expired`, `captcha`, `upload_failed`, `timeout`, `unknown`)
6. **Content bookkeeping** — unchanged: `content_items.status`, `content_posts`, variant publish projection on success

### Out of scope (P6a)

- LinkedIn publish (P6b)
- Settings browser-session card removal (P6c)
- Playwright dependency removal (P6d)
- X/LI **engage** (like/reply) — follow-on within #6, separate design slice
- X OAuth **write** APIs (`postTweet`) — explicitly rejected per #6 doctrine
- Gmail/CLI migration (#116)

## 2. Design decisions (System Design)

1. **RTX Browser owns the browser.** Signals never launches Chromium for publish. RealTimeX allocates `remoteDebugPort`; automation attaches via CDP (see `agent-browser` skill: connect to content `https://` tab, never Electron shell).
2. **Deterministic script, not LLM loop, for auto-publish.** Port existing Playwright step sequence from `x-publisher.ts` to a CDP runner (Playwright-over-CDP **or** agent-browser command sequence). LLM agents remain for enrichment; publish must be repeatable and testable.
3. **Preserve `POST /api/content/publish` contract.** Compose UI and Launch flows keep calling the same route; only the executor changes. For `platform: "x"`, the hard `getPlatformAccountByPlatform` 400 is replaced by ensure-account + RTX login pre-flight (decided in §4.2).
4. **Review mode does not close the browser.** Match current behavior: leave RTX session/tab open after fill; poll for compose modal close up to 5 minutes.
5. **Media upload path unchanged at CRM layer.** Publish request still carries `mediaAssetIds` / `threadMediaIds`; executor resolves filesystem paths via existing `resolveMediaPaths` logic before `setInputFiles` equivalent on CDP.
6. **Session validation moves to RTX.** Pre-flight: RTX Browser session exists, X content tab reachable, logged-in selectors present (`[data-testid="primaryColumn"]`). Failure ⇒ `session_expired` with message pointing to RTX Browser login (not Signals Settings browser session).
7. **Embedded Local App only for v1 executor.** Standalone `npx @realtimex/signals` returns explicit “publish requires RealTimeX Local App” until a standalone fallback is designed.

## 3. Architecture

```
ComposeDialog / Launch UI
  → POST /api/content/publish { platform: "x", mode, text, mediaAssetIds, threadTexts, ... }
  → publish orchestrator (new: src/lib/browser/rtx-publish/)
      → resolve RTX Browser session (Local App HTTP /cli/*-browser-session + x-app-id, §4.3)
      → attach CDP (playwright.chromium.connectOverCDP or agent-browser connect)
      → run x-publish-steps (ported from x-publisher.ts)
      → PublishResult { success, platformUrl, platformPostId, errorCode }
  → content queries (existing): updateContentItem, createContentPost, publishVariantForContentItem
```

### Lane alignment (#6 / #1)

| Lane | P6a usage |
|------|-----------|
| **Browser** | X publish + review (this spec) |
| **CLI** | — |
| **CRM** | content_items / content_posts (unchanged) |

## 4. API & contracts

### 4.1 `POST /api/content/publish` (unchanged shape)

Request (existing `publishSchema`):

```typescript
{
  contentItemId: string;
  platform: "x";           // P6a: only x wired to RTX executor
  mode: "auto" | "review";
  text: string;
  mediaAssetIds?: string[];
  threadTexts?: string[];
  threadMediaIds?: string[][];
}
```

Success response (unchanged):

```typescript
{ success: true, platformUrl?: string, platformPostId?: string }
```

Failure response (unchanged):

```typescript
{ success: false, error: string, errorCode?: PublishErrorCode }
```

**Behavioral change:** `platform === "linkedin"` continues to use legacy Playwright path until P6b. `platform === "x"` uses RTX executor.

### 4.2 Platform account precondition

**Current:** requires `getPlatformAccountByPlatform("x")` (OAuth row).

**Options considered:**

| Option | Behavior |
|--------|----------|
| A | Keep OAuth row required (identity for `platformAccountId` on `content_posts`) |
| B | **Decided:** Require RTX X login for publish; resolve `platformAccountId` from an existing account row if present, else create a **browser-session account row** (`auth_type: "session"`) |
| C | Drop account check entirely for browser publish |

**Decision (System Design, approved): B — via a session-type account row, no schema change.**

Schema facts (checked against `src/lib/db/schema.ts`):

- `content_posts.platform_account_id` is `NOT NULL` with a cascade FK (`schema.ts:300-302`) **and** participates in `idx_content_posts_platform_id` unique index (`platformPostId, platformAccountId`). Making it nullable would require a SQLite table rebuild **and** weaken dedup (SQLite treats each NULL as distinct in unique indexes). Rejected.
- `platform_accounts.auth_type` already has enum value `"session"` (`schema.ts:26`) — a browser-session account is a first-class concept today.

Implementation: publish pre-flight replaces the hard `getPlatformAccountByPlatform("x")` 400 with *ensure-account*: use existing X account row if any; otherwise create one with `auth_type: "session"`, `credentialsEncrypted: null`, `displayName` from the logged-in handle detected in the RTX tab (fallback `"X (RTX Browser)"`). `content_posts` rows always carry a real `platformAccountId`; if the user later connects OAuth, sync can reconcile rows by platform handle (out of P6a scope).

### 4.3 RTX session resolution (new internal contract)

```typescript
type RtxBrowserSessionRef = {
  sessionName: string;
  remoteDebugPort: number;
  contentTabUrl?: string; // https://x.com/... after attach
};

// Throws PublishError session_expired when unavailable
function resolveRtxPublishSession(platform: "x"): Promise<RtxBrowserSessionRef>;
```

Resolution order (embedded app) — **v1.1 amendment, Approved (System Design, 2026-08-16)**, superseding the v1 pp-cli path for the executor:

1. **Embedded Local App (primary):** HTTP `/cli/list-browser-sessions`, `/cli/create-browser-session`, `/cli/start-browser-session/:name`, `/cli/stop-browser-session/:name` with `x-app-id` header (same `validApiKey` middleware as `/sdk/register`).
2. **Dev/test override:** `SIGNALS_RTX_CDP_PORT` direct CDP attach.
3. Fail closed with actionable `session_expired` error.

**Why v1 was superseded:** the v1 pp-cli path assumed terminal-injected auth, but `REALTIMEX_TERMINAL_SESSION_TOKEN` is not injected into Local App processes (Review reproduced HTTP 403). The amendment was verified against the RealTimeX app source before approval: all four routes exist in `server/endpoints/cli/browserSessions.js` behind `validApiKey`, and `validApiKey` explicitly accepts `x-app-id` for Local App authentication (`validApiKey.js:54-57`). The HTTP path is also structurally better for a server route than v1: no subprocess spawn, app-scoped identity instead of borrowed terminal auth, and it fails closed in standalone mode (no `RTX_APP_ID`) consistent with §2.7.

Terminal `realtimex-pp-cli` remains valid for agent-browser workflows but is **not** wired into the publish executor; a standalone/terminal executor path would require a new System Design decision.

A speculative `RTX_BROWSER_SESSION` env bridge from Local AppsManager is **not** part of v1 — do not block on it (see §10 Q2).

## 5. Publish step script (port from `x-publisher.ts`)

Sequential steps (auto mode):

| Step | Action | Selector / note |
|------|--------|-----------------|
| 1 | Navigate | `https://x.com/home` |
| 2 | Session check | `primaryColumn` present; `loginButton` absent |
| 3 | CAPTCHA check | existing `detectCaptcha` heuristic |
| 4 | Open compose | `[data-testid="SideNav_NewTweet_Button"]` |
| 5 | Type main text | `[data-testid="tweetTextarea_0"]` + human delay |
| 6 | Upload media | `input[data-testid="fileInput"]` + `attachments` wait |
| 7 | Thread loop | `addButton`, `tweetTextarea_{n}`, per-tweet media |
| 8 | Submit | `[data-testid="tweetButton"]` click |
| 9 | Verify | capture pre-submit profile baseline; require **new** owned status ID + text match on logged-in handle |

Review mode: steps 1–7, then poll until `tweetTextarea_0` hidden (5 min cap), then step 9.

**Fragility:** selectors are owned by X; centralize in `x-publish-selectors.ts` for single-file updates.

## 6. Module layout (proposed)

```
src/lib/browser/rtx-publish/
  types.ts              # re-export PublishRequest/Result or thin aliases
  resolve-session.ts    # RTX Browser session + tab selection
  x-publish-steps.ts    # step functions (CDP Page)
  x-publish-executor.ts # orchestrates auto vs review
  connect.ts            # playwright.connectOverCDP(remoteDebugPort)
```

`src/app/api/content/publish/route.ts` calls `executeXPublishRtx(request)` instead of `publishToX`.

Keep `x-publisher.ts` until P6a ships and tests pass; then delete in P6d.

## 7. UI / UX

| Surface | P6a change |
|---------|------------|
| ComposeDialog | No contract change; error strings may reference RTX Browser login |
| Settings → Browser Sessions (X) | **No removal in P6a** — add helper text: “Publish migrates to RealTimeX Browser (P6c)” optional |
| Launch & Deploy | Unchanged invoke path |

Review mode toast: keep “Browser opened — review and publish in the browser window…” — window is RTX Browser, not Signals Chromium.

## 8. Testing

| Layer | Approach |
|-------|----------|
| Unit | Selector helpers, session-expired detection mocks, media path resolution |
| Integration | CDP against fixture HTML or recorded compose DOM (no live post in CI) |
| Smoke | **Opt-in** manual / staging: post to test account via RTX Browser |
| CI default | Mock `resolveRtxPublishSession` + stub Page; route returns shaped `PublishResult` |

Do not require live X login in `npm run check`.

## 9. Phased implementation (Dev, post-approval)

| Step | Task |
|------|------|
| 1 | Spike: resolve `signals-publish` session via Local App HTTP `/cli/*-browser-session` (`x-app-id`), then `connectOverCDP` to the returned `remoteDebugPort` (embedded mode) — *v1.1: HTTP path replaces the v1 pp-cli spike* |
| 2 | Port step script + executor |
| 3 | Wire `publish/route.ts` for `platform === "x"` |
| 4 | Error mapping + compose error display |
| 5 | Docs: extend `docs/rtx-agent-browser-enrichment.md` or new `docs/rtx-browser-publish.md` |
| 6 | Delete `publishToX` usage for X (keep file until P6d) |

## 10. Open questions — resolved (System Design, 2026-08-16)

1. **`content_posts.platform_account_id` nullable?** — **No.** Column stays `NOT NULL`; browser-only publish creates/reuses a `platform_accounts` row with `auth_type: "session"` (already in the enum). Nullable FK would force a SQLite table rebuild and break `idx_content_posts_platform_id` dedup semantics (NULLs are pairwise distinct). See §4.2.
2. **RTX session bridge** — **Resolved v1.1 (approved 2026-08-16):** embedded Local App HTTP `/cli/*-browser-session` calls with `x-app-id` (§4.3), superseding the v1 pp-cli path for the executor. pp-cli auth is terminal-scoped and unreachable from Local App processes; the HTTP endpoints and `x-app-id` support in `validApiKey` were verified in the RealTimeX app source.
3. **Named session** — **Fixed `signals-publish`.** A dedicated named session gives a persistent profile (X login survives restarts), isolation from tabs the user or other agents are driving, and deterministic tab targeting. Login is a one-time manual step in that session. Reusing an arbitrary user tab is rejected: ownership is ambiguous and an agent may be mid-interaction. The session is **stopped, never deleted** after publish (deleting would destroy the logged-in profile); review mode leaves it running per §2.4.
4. **Playwright-over-CDP vs agent-browser CLI** — **`playwright.chromium.connectOverCDP` inside the Signals server route.** Rationale: synchronous API route needs in-process control; the step script ports nearly 1:1 from `x-publisher.ts` (same Playwright `Page` API incl. `setInputFiles` for media); typed error mapping stays in TypeScript. The `agent-browser` CLI remains the tool for interactive/agent flows, not this deterministic executor. Constraint from the skill doctrine: attach only to the `https://x.com` content target — never the Electron shell; filter CDP targets/contexts by URL.

## 11. Acceptance criteria (P6a done)

- [ ] `POST /api/content/publish` with `platform: "x"` and `mode: "auto"` posts via RTX Browser without Signals Playwright launch
- [ ] Review mode fills compose on RTX Browser and completes when user posts
- [ ] Media + thread payloads work parity with current `x-publisher.ts`
- [ ] `session_expired` / `captcha` / `timeout` error codes preserved
- [ ] CI green without live X credentials
- [x] Spec status → **Approved v1.1** (System Design, 2026-08-16); Dev implements exactly this surface
