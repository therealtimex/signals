# Browser connection: allowed websites + blocked-URL recovery (#547)

Status: **data contract fixed; routed `needs_ux` to Product/UX** (System Design, 2026-10-16,
loop `loop-issue-547-745a3bcb`). Issue: [#547](https://github.com/therealtimex/signals/issues/547).
Decisions are numbered ADR-547-1 … ADR-547-14; Dev, Product/UX, Review and QA should challenge
those, not re-derive them. Branch `issue-547` from `origin/main 0b0e635`.

Deliverable split (ADR-547-13): **Slice A** (normalization, persistence, effective policy, RTX
apply, typed denial, `lnkd.in` default) is fully specified here and needs no UX input.
**Slice B** (Allowed websites control, blocked-URL recovery dialog) waits for the UX contract.

## 1. Facts about the current system (verified 2026-10-16, read-only)

RealTimeX = `~/rtgit/realtimex-ai-app` @ `f57733b995` (realtimex-dev). Signals = this worktree.

| # | Fact | Evidence |
|---|------|----------|
| F1 | **Re-declaring guardrails on an existing session is the supported update path, and it is a field-wise *replace*, not a union.** `POST /cli/create-browser-session` for an existing name reaches `ensureCliBrowserSessionRecord` → existing branch → `normalizeCliBrowserSessionGuardrails(requested, { existingGuardrails })`. Each of `mode`, `primaryOrigin`, `allowedOrigins`, `blockedOrigins`, `allowNewTab`, `allowCloseTab` is taken from the request when the key is present (`!== undefined`) and from the existing record otherwise. Response `created:false`, HTTP 200; no restart, no tab. | `frontend/src/electron/cliBrowserControl.cjs:92-152, 442-515`; `server/endpoints/cli/browserSessions.js:117-185` |
| F2 | **The change applies to a running session immediately.** Every guarded action (`create-tab`, `navigate-tab`, `open-url`, `close-tab`) calls `getRuntime` → `resolveBrowserIdentity`, which re-reads the session registry JSON on every call; `evaluateCliBrowserSessionGuardrails` evaluates `runtime.guardrails` fresh. The next RTX-routed navigation after the write sees the new list. | `cliBrowserRuntimeService.cjs:1033-1100, 1517, 2070, 2171, 2267` |
| F3 | There is no `update-browser-session` CLI route (`openapi.js` route map; pp-cli has create/start/stop/delete/list only). An internal `updateCliBrowserSessionRecord` exists but is not exposed. | `server/endpoints/cli/openapi.js:1094`, `realtimex-pp-cli --help` |
| F4 | **RTX enforces guardrails only on RTX-routed actions, against the *requested* URL's origin, at request time.** The RealTimeX Browser process (`frontend/src/cli-browser/*.js`) has no `will-navigate`/`will-redirect`/guardrail hook; `urlPolicy.js`, `navigationHandoff.js`, `popupPolicy.js` contain no origin allowlist. In-page navigation, HTTP redirects and CDP clients are never checked. Signals' own doc already records this. | grep of `frontend/src/cli-browser`; `docs/rtx-browser-publish.md:54-57` |
| F5 | Denial payload: `{ success:false, reason:"guardrail-origin-not-allowed", error:"The RealTimeX Browser session does not allow <origin>.", runtime, session, guardrail:{ action, policy:"session-guardrail", targetOrigin, primaryOrigin, guardrails } }`. HTTP status is **503** (guardrail reasons fall to the `default` branch of `resolveDesktopBrowserResultStatus`). | `cliBrowserRuntimeService.cjs:502-527, 648-672`; `server/utils/DesktopBrowser/desktopBrowserRequest.js` |
| F6 | RTX origin normalization = `new URL(v).origin.toLowerCase()`, http(s) only, Set-deduped; matching is exact string equality (no wildcard, no subdomain, `www.linkedin.com` ≠ `linkedin.com`). | `cliBrowserControl.cjs:47-80` |
| F7 | `GET /cli/list-browser-sessions` returns each session's `guardrails` (record when stopped, runtime when running), so Signals can read back what RTX holds. | `cliBrowserRuntimeService.cjs:360-381` |
| F8 | Signals re-declares `{mode:"unrestricted", allowedOrigins: PLATFORM_URLS origins, blockedOrigins:[]}` on **every** connect for whichever `sessionName` it is driving (`ensureRtxSessionRunning` is called with the connection's session name by `withPlatformBrowserPage`), so dedicated connections get the same fixed list as `signals-publish`. Any user addition made outside this call is clobbered on the next connect (F1). | `src/lib/platforms/browser-connection.ts:84-106, 808-865` |
| F9 | **Signals' own server never routes a user-supplied URL through RTX**; only `PLATFORM_URLS` (and the anon X resolver's fixed list) go through `start-browser-session --url`. Server-owned page loads use Playwright `page.goto` over CDP (bypasses F4). The `lnkd.in` denial in the issue comes from terminal agents and the seed scout, which open URLs with `realtimex-pp-cli start-browser-session <session> --url <seed>` (→ RTX `create-tab` → F4 check) and default to `signals-publish`. The denial is therefore **asynchronous** to the Signals UI and surfaces today as a workflow error string matched by `format-error.ts` pattern 12, whose advice ("Reconnect the platform") is wrong for this case. | agent-browser `SKILL.md:138`; `scripts/snowball-seed-scout/lib/browser.sh:122-127`, `lib/resolve.py` ("defaults_to_publish"); `src/lib/workflows/format-error.ts:191-199`; `workflow-step-timeline.tsx:160-170` |
| F10 | `https://lnkd.in/p/ggz83Nmd` → `301` → `https://www.linkedin.com/posts/…` → `200` (curl, 2026-10-16). One hop, destination already in the defaults. | network probe |
| F11 | Signals-side identity of a connection is `browser_connections` (`id`, unique `session_name`, `kind shared|dedicated`, `status`, `metadata` JSON). The `signals-publish` row is created lazily by `ensureBrowserConnection`; `listBrowserConnections()` feeds `/api/platform-targets` and the agent-tools `list_platform_targets`. Drizzle migrations run to `0037`; `npm run db:generate`. No settings table exists; settings live in `~/.signals/config.json` helpers under `src/lib/settings/`. | `src/lib/db/schema.ts:63-78`, `queries/platform-targets.ts:96-134`, `src/lib/db/migrate.ts` |
| F12 | ADR-541-5: a Dev instance may not create/start/stop `signals-publish`; `assertPublishSessionEffectAllowed` is already inside `createRtxBrowserSession`/`startRtxBrowserSession`/`stopRtxBrowserSession`. | `src/lib/rtx/browser-sessions.ts:22-29` |
| F13 | Settings tabs are `platforms | agents | personality`. The Platforms tab is one "Platform Connections" card with three `SocialPlatformCard`s; there is no per-connection surface yet (`specs/platform-targets.md §9` planned one). | `settings-tabs.ts`, `platforms-tab.tsx` |

## 2. Answers to the Dev handoff questions

1. **RTX update semantics** — replace per field (F1), live (F2), unrelated fields preserved when omitted (F1), re-create *is* the update endpoint (F3). RTX can update a running session's policy safely; **no cross-repo dependency for this point**. Consequence: Signals must always send the **complete** effective `allowedOrigins`, never a delta (ADR-547-1).
2. **Redirect enforcement** — RTX does **not** check redirect hops (F4). `lnkd.in → www.linkedin.com` passes only because nothing is checked after the request-time origin test. "lnkd.in → unlisted origin is still blocked" is not true today and cannot be made true from Signals without widening scope. Cross-repo dependency filed as RTX issue (see §6, ADR-547-9). Signals does not widen policy to compensate.
3. **Persistence** — new table keyed by `browser_connections.id` (ADR-547-4); the RTX key is the row's `session_name`. Effective policy = defaults ∪ custom, recomputed on every connect (ADR-547-2).
4. **Normalization** — ADR-547-5. Default ports dropped and IDNs punycoded by `URL.origin` itself, which matches RTX's own normalizer (F6), so what Signals stores is byte-identical to what RTX compares. Defaults are fixed, not removable, not shadowable.
5. **Blocked-navigation error shape and retry ordering** — ADR-547-7 and ADR-547-8.
6. **`https://lnkd.in`** — ADR-547-3: a per-platform `extraOrigins` field beside `PLATFORM_URLS`, so the "adding a platform extends the allowlist" property survives.

## 3. Decisions

### ADR-547-1 Apply = re-declare the full effective guardrails via `create-browser-session`

Signals updates a connection's RTX policy by calling `createRtxBrowserSession({ sessionName, guardrails })` with the **complete** effective object (ADR-547-2) and **only** the keys `mode`, `allowedOrigins`, `blockedOrigins`. `primaryOrigin`, `allowNewTab`, `allowCloseTab` are never sent, so RTX preserves them (F1) — this is how AC "preserve all unrelated guardrail fields" is met. No `url` is ever sent on this call (existing rule; a `url` starts the session and opens a tab).

After the call Signals **verifies** by `listRtxBrowserSessions()` → `findRtxBrowserSession(sessionName).guardrails.allowedOrigins`, normalizes both sides (ADR-547-5) and reports `applied: true` only when the RTX set equals the effective set. Anything else is `applied: false` with the observed RTX list attached.

Rejected: waiting for an `update-browser-session` endpoint (unnecessary, F1/F2); sending a delta (RTX replaces, F1 — a delta would drop the defaults).

### ADR-547-2 Effective policy is per connection and recomputed on every connect

`buildPublishSessionGuardrails()` becomes `buildConnectionGuardrails(sessionName)`:

```
effective(sessionName) = {
  mode: "unrestricted",
  allowedOrigins: dedupe([ ...SIGNALS_DEFAULT_ALLOWED_ORIGINS, ...customOrigins(connectionOf(sessionName)) ]),
  blockedOrigins: [],
}
```

- `connectionOf` = `getBrowserConnectionBySessionName` (read-only; **not** `ensureBrowserConnection`, which would create rows as a side effect of a connect). No row → custom set is empty → defaults only.
- `ensureRtxPublishSessionRegistered(env, fetch, sessionName)` sends `effective(sessionName)`. Because this runs on every connect (F8), reconnect and provisioning can never drop user additions: the additions live in Signals and are projected onto RTX each time (AC3 "reconnect/provisioning does not overwrite user additions").
- The anon X resolver session (`X_ANON_SESSION_NAME`) is not a browser connection and keeps its fixed list; it is out of scope.
- Dependency direction: the pure policy module (`src/lib/browser/allowed-origins.ts`, ADR-547-5) knows nothing about Drizzle or RTX; `browser-connection.ts` composes defaults + a repository read + the RTX adapter.

### ADR-547-3 Defaults: `PLATFORM_URLS` origins plus per-platform `extraOrigins`, with `https://lnkd.in` under LinkedIn

`PLATFORM_URLS[platform]` gains `extraOrigins: string[]` (`linkedin: ["https://lnkd.in"]`, others `[]`). `buildPublishSessionAllowedOrigins()` (renamed `SIGNALS_DEFAULT_ALLOWED_ORIGINS` / `buildDefaultAllowedOrigins()`) adds them. Defaults are **fixed**: the UI shows them read-only and separately; a user cannot remove or shadow one; adding a URL whose origin is a default is a no-op that reports `already_default` (not an error). `blockedOrigins` stays `[]` in v1 — blocking is not in the issue.

Not decided here (PM follow-up, §7): whether the apex `https://linkedin.com` and `https://twitter.com` belong in the defaults. They are exact-match-distinct from `www.linkedin.com`/`x.com` (F6).

### ADR-547-4 Persistence: `browser_connection_origins` table, keyed by connection id

```
browser_connection_origins
  id             text PK
  connection_id  text NOT NULL REFERENCES browser_connections(id) ON DELETE CASCADE
  origin         text NOT NULL            -- normalized (ADR-547-5), e.g. "https://lnkd.in"
  source         text NOT NULL            -- enum: "settings" | "recovery"
  created_at / updated_at                 -- repo `timestamps`
  UNIQUE (connection_id, origin)
```

Migration `0038_*` (additive; `npm run db:generate`, journal + snapshot committed). Queries in `src/lib/db/queries/browser-connection-origins.ts`: `listConnectionOrigins(connectionId)`, `addConnectionOrigin({connectionId, origin, source})` (idempotent on the unique key; returns `{ created: boolean }`), `removeConnectionOrigin(connectionId, origin)`.

Why a table and not `browser_connections.metadata` JSON: the unique key dedupes at the storage boundary; `ON DELETE CASCADE` follows the connection; `source`/timestamps give an audit trail for a security-relevant list; no read-modify-write race with other metadata writers (`ensureBrowserConnection` writes `metadata` today). Why not `~/.signals/config.json`: the list is per connection, and connections already live in the DB.

"Selected browser connection" = one `browser_connections` row chosen in the UI (default: the `signals-publish` row, created via `ensureBrowserConnection` if missing when the Settings surface loads — a UI-initiated write, not a connect-time one). Archived connections keep their rows and additions; they are hidden, not deleted.

### ADR-547-5 Normalization rules (pure module, exhaustively unit-tested)

`src/lib/browser/allowed-origins.ts` — `normalizeAllowedOrigin(input): { ok: true, origin } | { ok: false, code }`:

| Step | Rule | Code on failure |
|------|------|-----------------|
| 1 | `trim()`; empty → reject | `invalid_url` |
| 2 | `new URL(input)` must parse (absolute URL only; no base) | `invalid_url` |
| 3 | `protocol` ∈ {`http:`, `https:`} | `unsupported_scheme` |
| 4 | `username === "" && password === ""` | `credentials_not_allowed` |
| 5 | `hostname !== ""` and `origin !== "null"` | `invalid_url` |
| 6 | result = `url.origin` | — |

Properties guaranteed by WHATWG `URL.origin` (assert them in tests, do not re-implement): path/query/fragment dropped; host lowercased; default port dropped (`https://x.com:443` → `https://x.com`), non-default port kept; IDN host serialized as punycode (`https://bücher.example` → `https://xn--bcher-kva.example`). This equals RTX's normalizer (F6), so Signals' stored value is exactly the string RTX compares against.

Classification helper `classifyOrigin(origin, defaults, custom)` → `default | custom | new`; the API maps `default` → `already_default` (200, no write), `custom` → `already_added` (200, no write). Dedupe is by normalized origin. No wildcard or subdomain syntax (`*.linkedin.com` → `invalid_url`); the UI copy must say "exact website address (scheme + host + port)".

`isOriginAllowed(effectiveOrigins, url)`: `normalizeAllowedOrigin(url).origin ∈ effectiveOrigins` — used for redirect checks (ADR-547-9) and tests.

### ADR-547-6 Internal REST contract (bare-payload convention of `/api/platforms/*`)

Base: `/api/browser-connections/[id]/allowed-origins`. `id` = `browser_connections.id`.

- `GET` → `200 { connectionId, sessionName, defaults: string[], custom: [{ origin, source, addedAt }], effective: string[], runtime: null | { reachable: boolean, allowedOrigins: string[] | null, applied: boolean | null, error?: string } }`. `runtime` is `null` when not RTX-embedded; `reachable:false` when `list-browser-sessions` fails; `applied` = effective ⊆ runtime list.
- `POST { url }` → sequence **normalize → guard → persist → apply → verify**:
  - `400 { code: "invalid_url" | "unsupported_scheme" | "credentials_not_allowed" }`
  - `403` `externalEffectDeniedResponse` when `sessionName === "signals-publish"` on a Dev instance (ADR-547-10) — evaluated **before** persisting.
  - `200 { origin, status: "already_default" | "already_added" | "added", persisted: true, applied: true, effective, runtime }`
  - `502 { origin, status: "added", persisted: true, applied: false, effective, runtime, error }` — the row is kept; RTX will self-heal on the next connect (ADR-547-2). The UI must show "saved, not active yet", never success.
- `DELETE /api/browser-connections/[id]/allowed-origins/[origin]` (`origin` percent-encoded) → same guard → delete row → apply → verify → `200 { origin, removed: boolean, applied, effective, runtime }` | `502` as above. Deleting a default → `400 { code: "default_origin" }`.
- `POST /api/browser-connections/[id]/allowed-origins/apply` → re-apply + verify only (the retry for a `502`).
- `GET /api/browser-connections` → `{ connections: BrowserConnectionView[] }` (reuse `listBrowserConnections()`), for the selector. The existing `POST /api/platform-targets/connections` stays as is.

All routes catch `ExternalEffectDeniedError` → 403 and surface RTX transport errors as `502` with the RTX `error` text, never as a thrown 500.

### ADR-547-7 Typed denial: `RtxNavigationBlockedError` and one wire shape

`src/lib/rtx/browser-sessions.ts` parses every failed RTX body: when `body.reason` starts with `guardrail-origin-` it throws `RtxNavigationBlockedError` (extends `Error`) with `{ reason, action, sessionName, deniedOrigin: body.guardrail?.targetOrigin ?? parsed from error text, requestedUrl, primaryOrigin }`. Detection is by `reason`, **never** by HTTP status (F5: 503 today). Other `guardrail-*` reasons keep today's descriptive string.

Wire shape, shared by REST, workflow errors and future agent-tools:

```json
{
  "code": "RTX_NAVIGATION_BLOCKED",
  "reason": "guardrail-origin-not-allowed",
  "action": "create-tab",
  "sessionName": "signals-publish",
  "connectionId": "bc_…",            // null when the session has no browser_connections row
  "deniedOrigin": "https://lnkd.in",
  "requestedUrl": "https://lnkd.in/p/ggz83Nmd",
  "recoverable": true,
  "recovery": { "kind": "allow_origin", "connectionId": "bc_…", "origin": "https://lnkd.in" }
}
```

`recoverable` is `true` only for `guardrail-origin-not-allowed` with a resolvable connection; `guardrail-origin-mismatch` (anchored sessions outside Signals' management) is `false` with `recovery: null`. REST routes that proxy an RTX navigation (today `POST /api/platforms/*/browser-session` `setup`) return this body with HTTP **409**.

Workflow errors: canonical string `RTX_NAVIGATION_BLOCKED:<json>` for producers that can emit it. For the **existing** plain RTX text (`The RealTimeX Browser session does not allow https://lnkd.in.`), `formatWorkflowError` pattern 12 is split: `does not allow <origin>` → category `navigation_blocked`, title "Website not allowed in the browser connection", `detail` names the origin, and the formatter returns a new optional `recovery` field (`{ kind: "allow_origin", origin }`; the run view resolves `connectionId` from the run's bound `browserSessionName`). `is locked to`/`blocks` keep today's text. This covers the lnkd.in case (F9) without changing shell scripts or skills.

### ADR-547-8 Recovery flow and retry ordering

Trigger classes (both must be in the UX contract):

- **(a) Synchronous** — a Signals API call that routes a URL through RTX fails with `RTX_NAVIGATION_BLOCKED` (today only platform URLs; after this change any future "open in browser connection" action).
- **(b) Asynchronous** — a terminal agent / scout denial recorded on a workflow run or step (F9). This is the actual `lnkd.in` case.

Dialog content: denied origin, the full requested URL, the connection (session name), and the sentence "Allowing a website lets this browser connection open it. It does not authorize publishing or any outbound action." Actions: **Allow website and retry** (primary, class a) / **Allow website** (class b, when no retry handle exists) / **Cancel**.

Ordering for "Allow website and retry":

1. `POST …/allowed-origins { url: requestedUrl }` (persist → apply → verify, ADR-547-6).
2. On `200 applied:true` → re-issue the **original operation** (the caller passes a retry thunk; class a = the same request; class b = the run's existing re-run/relaunch action with the same seed, if the surface has one).
3. The retry's own result is what the UI reports. If it is blocked again (another origin), the dialog reappears for the new origin; the loop is bounded by user clicks, no automatic retry.
4. On `502 applied:false` → "Saved, but RealTimeX did not accept the update. Navigation was not retried." with **Retry apply** (`…/apply`). Never claim navigation succeeded.
5. On `400`/`403` → show the code's message; nothing persisted.
6. **Cancel** → no request is made; policy unchanged.

### ADR-547-9 Redirects: enforcement stays in RTX; Signals does not widen and files the dependency

Facts F4/F10. Signals' deliverable for AC5:

- **No widening**: nothing in Signals adds redirect destinations to the policy; allowing `https://lnkd.in` adds exactly one origin (test).
- **No compensating blocker**: a CDP post-hoc check cannot prevent a load that already happened in a signed-in profile; Signals will not pretend otherwise.
- **Check helper**: server-owned navigations that *consume* a page (`snowball-identity-evidence.ts`, `event-browser.ts` `page.goto` paths) call `isOriginAllowed(effective, page.url())` after settle and refuse to use evidence from a final origin outside the connection's effective list (`RTX_NAVIGATION_BLOCKED`-shaped error, `action: "redirect"`). This is evidence hygiene, not enforcement, and the docs say so.
- **Cross-repo dependency**: RTX issue filed (§6) asking the RealTimeX Browser process to evaluate `allowedOrigins` on `will-navigate`/`will-redirect` for `unrestricted` sessions with a non-empty list, surfacing `guardrail-origin-not-allowed` in the tab, plus mapping `guardrail-*` reasons to HTTP 403. Until it lands, QA can verify only the Signals-side properties; the ADR records AC5's enforcement half as **blocked on RTX**, not as done.
- `docs/rtx-browser-publish.md` guardrails table gains `https://lnkd.in` and a sentence on redirect scope.

### ADR-547-10 Dev-instance guard

For `sessionName === "signals-publish"` the three mutating routes call `denyExternalEffect("browser-session.publish")` **before** persisting (so a Dev DB never collects rows RTX will never see); the apply path is already guarded inside `createRtxBrowserSession` (F12). Dedicated and scout connections stay allowed on Dev. No new `ExternalEffect` value.

### ADR-547-11 Settings placement and data the UI needs

The control lives in the existing **Platforms** tab as a new "Browser connection" section (card) *above* the platform cards: connection selector (default `signals-publish`; shows running state from `/api/platforms/*/browser-session` or `list-browser-sessions`), **Defaults** (read-only chips), **Added by you** (removable rows with `addedAt`/`source`), add input, and a runtime status line (`applied` / "not active yet — Retry apply" / "RealTimeX unavailable"). `VALID_SETTINGS_TABS` is unchanged; the issue's "Settings → Browser connection" names this section. Layout, copy, empty states and the dialog are Product/UX's to decide; the data contract above is not.

### ADR-547-12 Scope of policy management

Only sessions with a `browser_connections` row are manageable. Scout-owned `signals-scout-*` sessions created by shell scripts have no row and no Signals guardrails (they run RTX's default `anchored-origin` mode); they are out of scope and listed in §7.

### ADR-547-13 Delivery split and loop routing

Route `needs_ux` now with this contract. Slice A needs no UX decision and is specified to the file level so Dev can start on it the moment Product/UX returns `contract_agreed` (or earlier if the Human authorizes slice A on Origin). One PR, reviewable commits in this order: (1) `allowed-origins.ts` + defaults + `lnkd.in`; (2) migration 0038 + queries; (3) per-connection guardrails + apply/verify; (4) typed denial + `format-error`; (5) REST routes; (6) UI per UX contract; (7) docs.

### ADR-547-14 What stays stable

`createRtxBrowserSession`/`startRtxBrowserSession` signatures, `RTX_PUBLISH_SESSION_NAME`, the anon X resolver, `browser_connections`/`platform_targets` schemas, lease behaviour, ADR-541-5 chokepoints, and the "no `url` on the registration call" rule all stay as they are.

## 4. Scenarios against the acceptance criteria

| AC | Scenario | Design | Proof |
|----|----------|--------|-------|
| 1 normalize/reject/dedupe | paste `https://lnkd.in/p/abc?x=1#f` → `https://lnkd.in`; `https://u:p@h.com` → `credentials_not_allowed`; `ftp://h` → `unsupported_scheme`; `https://X.com:443/` → `https://x.com` → `already_default` | ADR-547-5 | unit |
| 2 inspect / add / remove without losing sign-in | POST/DELETE only touch `browser_connection_origins` and call `create-browser-session` without `url`; no stop/delete | ADR-547-1/4/6 | route test asserts RTX calls = create (no url) + list only |
| 3 effective = defaults ∪ custom; reconnect preserves; applied to RTX | `ensureRtxPublishSessionRegistered` body `allowedOrigins` ⊇ custom after a simulated "old build" connect; apply sends full set; verify reads back | ADR-547-2/1 | browser-connection test with fetch capture |
| 4 denied navigation → origin + Allow/Cancel; Cancel unchanged; failures surfaced | typed error from RTX body; 502 path keeps row, reports `applied:false`; Cancel issues no request | ADR-547-7/8 | route tests + format-error tests |
| 5 redirects subject to allowlist | allowing `lnkd.in` adds one origin; `isOriginAllowed` false for `https://evil.example`; **RTX enforcement blocked on RTX issue** | ADR-547-9 | unit + documented dependency |
| 6 `lnkd.in` default; short link lands on allowed LinkedIn | defaults contain both; F10 chain | ADR-547-3 | unit; QA manual open in RTX |
| 7 tests | see §5 | | |

## 5. Test plan (proof required before Review → QA)

1. `src/lib/browser/allowed-origins.test.ts` — table-driven normalization (every row of ADR-547-5, IDN, ports, credentials, scheme, `null` origin), `classifyOrigin`, `isOriginAllowed`.
2. `src/lib/db/queries/browser-connection-origins.test.ts` — add is idempotent, unique key, cascade on connection delete, remove, list order.
3. `browser-connection.test.ts` (extend "publish session guardrails") — `buildConnectionGuardrails` for a connection with custom origins; connect sends defaults ∪ custom and **only** `mode/allowedOrigins/blockedOrigins`; a second connection's custom set does not leak into the first (scoped runtime update); verify path compares normalized sets.
4. `src/app/api/browser-connections/[id]/allowed-origins/route.test.ts` — 400 codes, `already_default`, `already_added`, happy path call order (persist before create, list after create), 502 when RTX rejects / list disagrees (row still present), 403 Dev guard before persist for `signals-publish`, DELETE default → 400.
5. `browser-sessions.test.ts` — RTX denial body → `RtxNavigationBlockedError` fields; detection by `reason` with HTTP 503 and 403.
6. `format-error.test.ts` — plain RTX "does not allow" text → `navigation_blocked` + `recovery.origin`; `RTX_NAVIGATION_BLOCKED:<json>` → same; "is locked to" unchanged.
7. QA (RTX-embedded, canonical app, owner present): add `https://example.org` in Settings → `realtimex-pp-cli list-browser-sessions --json` shows it under `signals-publish.guardrails.allowedOrigins`; `start-browser-session signals-publish --url https://example.org` succeeds without restarting the session and sign-in persists; remove → the same start is denied with `guardrail-origin-not-allowed`; open `https://lnkd.in/p/ggz83Nmd` → lands on `www.linkedin.com`.

## 6. Cross-repo dependency

RTX issue [rtlab/rtwebteam/realtimex-ai-app#2502](https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/issues/2502) (filed 2026-10-16): "RealTimeX Browser: enforce session `allowedOrigins` on in-page navigation and redirects; map guardrail denials to 403". Blocks the enforcement half of AC5 only.

## 7. Risks and follow-ups

- **R1 Clobber by other RTX clients.** Any client re-creating `signals-publish` with guardrails replaces the list (F1). Signals self-heals on its next connect (ADR-547-2); the Settings runtime line shows `applied:false` in between.
- **R2 503 ambiguity.** Until RTX maps guardrail reasons to 403, Signals must parse `reason` before treating a 503 as "RTX down" (ADR-547-7).
- **R3 Registry write race.** RTX anchoring/`lastUsedAt` writes and Signals' re-declare are both read-modify-write on one JSON file; the window is small and self-heals on the next connect.
- **R4 Standalone mode.** Without RTX the routes persist and return `runtime: null`; the UI must not show "applied".
- **F/U-1** PM: apex `https://linkedin.com` / `https://twitter.com` as defaults?
- **F/U-2** Scout-owned `signals-scout-*` sessions have no connection row and run anchored mode (ADR-547-12).
- **F/U-3** Producers (scout scripts, `signals-publish` skill) could emit `RTX_NAVIGATION_BLOCKED:<json>` to carry `requestedUrl`; not required for v1 because the plain-text parse already yields the origin.
- **F/U-4** Blocked origins UI (`blockedOrigins`) — not requested.

## 8. Open questions for Product/UX (contract)

1. Where does the recovery dialog live for the asynchronous case — the workflow run error row (`workflow-step-timeline.tsx`) only, or also a toast when the run is open?
2. For class (b) denials with no re-run handle, is "Allow website" (no retry) acceptable copy, with guidance to re-run?
3. Connection selector when only `signals-publish` exists: hide the selector or show it disabled?
4. Confirm the "no publishing authorization" sentence appears in both the Settings section and the dialog.
