# Platform Targets: multiple identities with safe agent concurrency (issue #191)

Design for separating **browser connections** (the persistent RealTimeX browser profile),
**platform targets** (the identity an agent acts as), and **execution leases** (session-scoped
ownership that serializes different-target work in a shared switchable session).

Today the destination of every browse/publish action is identified by a bare platform string:
`getPlatformAccountByPlatform()` returns the singleton `platform_accounts` row
(`src/lib/db/queries/platform-accounts.ts:13`), `ensureSessionPlatformAccount()` silently renames
that row to whatever handle just validated or published
(`src/lib/publish/ensure-platform-account.ts:27-32`), publish jobs carry only
`platform` in their `targets` JSON (`src/lib/publish/types.ts:26-36`), and `complete_publish`
matches a result to a job target by platform alone
(`src/lib/agent-tools/publish-handlers.ts:170`). Agents cannot deterministically select, verify,
or audit the identity they act as.

Status: **Approved for implementation** (System Design, 2026-08-19, loop `loop-issue-191-7eb691ca`).

## 1. Scope & Hard Constraints

In scope: target registry schema + queries + backfill; session lease service; target-aware publish
jobs, completion callbacks, and content audit; agent-tools `list/get/prepare/release` +
`signals-pp-cli targets` command group; per-platform discover/activate/verify adapters for
X/LinkedIn/Facebook; Settings multi-target UI.

Non-goals (v1): LinkedIn organization pages; publish support for Facebook; acting-identity columns
on `engagements`/`interactions`/`content_activities`; a generic browser driver in
`signals-pp-cli`; cross-machine locking (Signals is a single local app; the lease arbiter is the
one Signals server process).

Non-negotiable invariants (each has a required test, §11):

- **I1 — serialized shared session.** Different targets in one shared browser context never
  execute concurrently. A session-wide lease covers the whole operation
  (acquire → activate → verify → act → verify result → release). True different-target
  concurrency requires dedicated browser connections (per-connection leases are independent).
- **I2 — verify before mutate, fail closed.** A persisted `active`/`lastVerifiedAt` flag is never
  trusted. Every mutating operation re-verifies the live browser identity against the target and
  fails with typed `TARGET_NOT_ACTIVE` on mismatch. `x-publish.cjs` receives a required
  `expectedHandle` and hard-fails on mismatch instead of publishing as whoever is signed in.
- **I3 — additive schema only.** Migration rules of `specs/schema-v0.5.md` §4 apply: new tables,
  new nullable columns, no drops/renames, DDL separated from idempotent provenance-tagged
  backfills, and the N-1 old-binary test holds. `platform_accounts` keeps its current shape and
  remains the credentials/sync-cursor owner.
- **I4 — names and handles are display metadata.** Identity is the stable `tgt_…` id plus
  `(platform, kind, externalId)` when the external id is known; handle changes update a row, they
  never fork one (§4).
- **I5 — deterministic legacy fallback.** Platform-only jobs and callbacks resolve the platform's
  **default target** through a deterministic order (§4.4) — never an unordered
  "first row for platform" query.
- **I6 — ownership boundary.** Signals owns the target registry, selection, activation, and
  verification (server-side CDP, same pattern as `detectLoggedInViaCdp`,
  `src/lib/platforms/browser-connection.ts:526`). Page navigation/manipulation for content work
  stays in `agent-browser`/the RTX browser layer. `signals-pp-cli` only calls REST.
- **I7 — forgetting ≠ clearing.** Forgetting a target soft-deletes a registry row; it never clears
  shared browser cookies. Clear-session remains a separate explicit action.

## 2. Domain Model

```
browser_connections 1 ── N platform_targets 1 ── N content_posts / publish-job target entries
browser_connections 1 ── 0..1 browser_session_leases        (at most one active lease per connection)
platform_targets    N ── 0..1 platform_accounts             (credential/sync bridge, unchanged table)
platform_targets    N ── 0..1 platform_targets              (authPrincipalTargetId: page → profile)
```

| Concept | Meaning | Backed by |
|---|---|---|
| Browser connection | A named persistent RTX browser session/profile holding logins | `browser_connections` (seeded from `signals-publish`) |
| Platform target | The identity acted as: X account, LinkedIn member, FB profile, FB Page | `platform_targets` |
| Execution lease | Whole-operation exclusive ownership of one connection | `browser_session_leases` |
| Auth principal | The signed-in identity that grants acting rights (FB Page acts via a profile) | `platform_targets.auth_principal_target_id` |
| Credential owner | OAuth/API credentials + sync cursors (unchanged) | `platform_accounts` via `platform_targets.platform_account_id` |

Target platforms are the browser-connect subset `SocialPlatform = "x" | "linkedin" | "facebook"`
(`src/lib/platforms/browser-connection.ts:37`) — not the 12-entry `PLATFORMS` registry and not
`PublishPlatformTarget`. Kinds: X login → `account`; LinkedIn member → `profile`; Facebook
personal → `profile`; Facebook Page → `page`; `organization` is reserved (LinkedIn org pages,
deferred).

Naming note: `publish_jobs.targets` / `PublishJobTarget` already mean "per-platform publish
target". The new concept is consistently `platform target` / `platform_targets` /
`list_platform_targets` in code and API; only the CLI command group is called `targets` (issue
contract).

## 3. Schema (one migration, additive only)

New tables in `src/lib/db/schema.ts`, generated as `src/lib/db/migrations/0026_platform_targets.sql`
(rename per repo convention + update the tag in `migrations/meta/_journal.json`). Register all new
tables in `src/test/db.ts` `resetCoreTables()`.

```ts
export const browserConnections = sqliteTable("browser_connections", {
  id: text("id").primaryKey(),                       // `bc_${nanoid()}`
  sessionName: text("session_name").notNull(),       // RTX browser session name
  kind: text("kind", { enum: ["shared", "dedicated"] }).notNull().default("shared"),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  metadata: text("metadata").default("{}"),          // JSON; provenance, notes
  ...timestamps,
}, (t) => [uniqueIndex("idx_browser_connections_session").on(t.sessionName)]);

export const platformTargets = sqliteTable("platform_targets", {
  id: text("id").primaryKey(),                       // `tgt_${nanoid()}`
  connectionId: text("connection_id").notNull()
    .references(() => browserConnections.id),
  platform: text("platform", { enum: PLATFORM_ENUM }).notNull(), // writes validated to SocialPlatform
  kind: text("kind", { enum: ["account", "profile", "page", "organization"] }).notNull(),
  externalId: text("external_id"),                   // platform-native id when discoverable
  name: text("name").notNull(),                      // display name (mutable)
  handle: text("handle"),                            // "@foo", "/in/foo", fb slug (mutable)
  handleNormalized: text("handle_normalized"),       // dedup key when externalId is null (§4.1)
  canonicalUrl: text("canonical_url"),
  authPrincipalTargetId: text("auth_principal_target_id"), // self-ref; FK enforced in write path
  platformAccountId: text("platform_account_id")
    .references(() => platformAccounts.id),          // credential/sync bridge
  capabilities: text("capabilities").notNull().default("[]"), // JSON string[] (§8)
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["active", "forgotten", "merged"] }).notNull().default("active"),
  mergedIntoTargetId: text("merged_into_target_id"),
  lastVerifiedAt: integer("last_verified_at"),
  metadata: text("metadata").default("{}"),
  ...timestamps,
}, (t) => [
  uniqueIndex("idx_platform_targets_identity").on(t.platform, t.kind, t.externalId)
    .where(sql`external_id IS NOT NULL`),
  index("idx_platform_targets_handle").on(t.platform, t.kind, t.handleNormalized),
  index("idx_platform_targets_connection").on(t.connectionId),
]);

export const browserSessionLeases = sqliteTable("browser_session_leases", {
  connectionId: text("connection_id").primaryKey()   // at most one lease per connection
    .references(() => browserConnections.id, { onDelete: "cascade" }),
  leaseId: text("lease_id").notNull(),               // fencing token, `lease_${nanoid()}`
  holder: text("holder").notNull(),                  // rtx runtime session id / job id / caller tag
  targetId: text("target_id").references(() => platformTargets.id),
  intent: text("intent"),                            // browse | publish | discover | verify
  acquiredAt: integer("acquired_at").notNull(),
  renewedAt: integer("renewed_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
```

One new column: `content_posts.target_id` (nullable text, FK → `platform_targets.id`,
`index("idx_content_posts_target")`). `content_posts.platform_account_id` stays NOT NULL and keeps
its meaning; the dedup index `(platform_post_id, platform_account_id)` is unchanged.
`publish_jobs` gets **no** new column — target ids travel inside the `targets` JSON entries (§6).

Notes for Dev: verify drizzle-kit 0.31.x emits the partial unique index correctly for SQLite; if
not, keep the plain index and enforce identity uniqueness in the registration transaction (all
writes go through the single server process; better-sqlite3 transactions are synchronous).
`authPrincipalTargetId` deliberately has no SQL FK (self-reference ordering); the write path
validates it (same pattern as `graph_edges` endpoints, schema-v0.5 §4 rule 7).

## 4. Target identity, dedup, and default resolution

New module `src/lib/db/queries/platform-targets.ts` (+ `src/lib/platforms/target-identity.ts` for
pure helpers). All registration goes through one upsert.

### 4.1 Handle normalization (pure, unit-tested)

| Platform | Raw forms | `handleNormalized` |
|---|---|---|
| x | `@Foo`, `Foo` | `foo` (strip `@`, lowercase) |
| linkedin | `/in/Foo-Bar`, `foo-bar` | `foo-bar` (strip `/in/`, lowercase) |
| facebook | `some.slug` | `some.slug` (lowercase) |
| facebook | `id:12345` (from `profile.php?id=`) | **not a handle** — becomes `externalId: "12345"` |

### 4.2 Registration upsert — `registerPlatformTarget(input)`

Input: `{ connectionId, platform, kind, externalId?, name, handle?, canonicalUrl?,
authPrincipalTargetId?, platformAccountId?, capabilities?, source }`. One transaction:

1. **externalId match**: if `externalId` present and an active/`merged` row exists for
   `(platform, kind, externalId)` → update mutable fields (`name`, `handle`, `handleNormalized`,
   `canonicalUrl`, `connectionId` re-home, `lastVerifiedAt`); resurrect `forgotten` → `active`.
2. **handle match**: else if `handleNormalized` matches an active row with `externalId IS NULL`
   for `(platform, kind)` → update mutable fields; if input carries `externalId`, **adopt** it
   (set on the row) unless another row already owns that externalId → **merge** (§4.3).
3. **create**: else insert with fresh `tgt_${nanoid()}`; first active target for a platform
   becomes `isDefault = true`.

Re-home rule: a target lives on exactly one connection (its current home). Registering the same
identity from another connection updates `connectionId` (previous home recorded in `metadata`).
A join table is deliberately deferred (ADR-191-1).

### 4.3 Merge (provisional row learns an externalId already registered)

Keep the row that owns the externalId (canonical); update its display fields. In the same
transaction: repoint `content_posts.target_id` from the provisional row to the canonical row, then
mark the provisional row `status = "merged"`, `mergedIntoTargetId = <canonical>`. `resolveTargetById()`
follows the merge pointer (single hop) so stale ids in publish-job JSON stay resolvable. Merged
rows never appear in listings and are never default.

### 4.4 Default resolution — `resolveDefaultTarget(platform)`

`status = 'active' AND is_default = 1` first; else oldest active by `(created_at, id)`;
else `undefined`. `setDefaultTarget(id)` clears other defaults for the platform in one
transaction. Forgetting a default clears its flag (fallback order takes over). This replaces every
`getPlatformAccountByPlatform()`-as-identity call site; `getPlatformAccountByPlatform()` itself
survives only as the credential lookup behind the bridge.

### 4.5 `ensureSessionPlatformAccount` behavior change

`validatePlatformBrowserSession` (`browser-connection.ts:714-746`) and `handleCompletePublish`
(`publish-handlers.ts:199`) stop renaming the platform's account row when a *different* identity
is detected. New behavior: `registerPlatformTarget` upserts the detected identity as a target;
`platform_accounts.display_name` is only updated when the detected identity resolves to the target
already bridged to that account row. This is the fix for "validation overwrites the platform-level
identity" and the "Target validation/upsert does not overwrite another target" AC.

## 5. Session lease contract

New module `src/lib/leases/session-lease.ts`. DB-backed (there is no reusable lock primitive in
the repo, and Next.js route handlers can run on separate workers — an in-process promise queue is
insufficient; see `src/lib/rtx/bootstrap.ts:34`). All operations are single better-sqlite3
transactions; the Signals server process is the sole arbiter. Locking is **cooperative**: it binds
every caller that goes through `prepare`/agent-tools; it cannot stop a rogue CDP client, which is
why I2 (verify-before-mutate) is mandatory everywhere.

### 5.1 Lifecycle

```
acquire(connectionId, { holder, targetId, intent, ttlSeconds = 300 })
  → row absent or expiresAt < now  ⇒ write lease, return { leaseId, expiresAt }
  → held by same holder            ⇒ re-issue/renew (idempotent re-entry)
  → held, not expired              ⇒ typed SESSION_LEASE_HELD { holder, targetId, expiresAt, retryAfterSeconds }

renew(leaseId, ttlSeconds?)        → extends expiresAt; unknown/stale leaseId ⇒ LEASE_LOST
release(leaseId)                   → deletes row; unknown/stale leaseId ⇒ LEASE_LOST (no-op safe)
```

- **TTL 300 s default** (bounded 30–1800). Renewal happens explicitly and implicitly: any
  `update_publish_job` / `complete_publish` call carrying a valid `leaseId` renews it.
- **Stale-owner recovery = steal on expiry.** The next `acquire` after `expiresAt` overwrites the
  row (new `leaseId`). No grace protocol: the old holder's next lease-scoped call gets
  `LEASE_LOST`, and I2 guarantees a stolen-from holder can no longer mutate as the wrong identity
  (its pre-mutation verify fails `TARGET_NOT_ACTIVE` after the new holder switches).
- **Fencing.** `leaseId` is the fencing token. `prepare` returns it; the agent passes it to
  lease-scoped calls. Completion reports (`complete_publish`) are **never rejected** for a stale
  lease — the browser action already happened and the audit record must be truthful — but the
  response carries `leaseStale: true` so the agent knows serialization was violated.
- **Same target, same connection**: v1 serializes too (one lease per connection, no read-only
  tab-ownership carve-out). Relaxation is a follow-up, not this issue.
- **Dedicated concurrency**: leases key on `connectionId`, so two connections never contend —
  this is the whole dedicated-session concurrency story (proof in §11).

### 5.2 Typed error taxonomy (shared by REST, agent-tools, CLI)

| Code | Meaning | Retryable |
|---|---|---|
| `TARGET_NOT_FOUND` | id unknown (after merge-pointer hop) | no |
| `TARGET_FORGOTTEN` | target soft-deleted | no |
| `TARGET_CAPABILITY_UNSUPPORTED` | e.g. `prepare --intent publish` on a Facebook target | no |
| `TARGET_ACTIVATION_UNSUPPORTED` | e.g. non-active LinkedIn member in a shared session (§8) | no |
| `CONNECTION_UNAVAILABLE` | RTX unreachable / no debug port / session won't start | yes |
| `LOGIN_REQUIRED` | probe shows logged out for the platform | after user login |
| `SESSION_LEASE_HELD` | lease held by another holder | yes (`retryAfterSeconds`) |
| `LEASE_LOST` | leaseId is not the current lease | no |
| `TARGET_NOT_ACTIVE` | live identity ≠ requested target after activation/verify | no (fail closed) |

Delivered as handler-level soft errors `{ error, code, details? }` inside the standard
`{ success: true, tool, result }` envelope (existing convention,
`src/lib/agent-tools/publish-handlers.ts:86`).

## 6. Target-aware publish pipeline

### 6.1 Job creation

- `POST /api/content/send-to-agent` (`route.ts:6-11`) gains optional
  `targets: [{ targetId }]`; `platforms: [...]` stays supported. `sendContentToAgent`
  (`send-to-agent.ts:87-100`) resolves each requested platform to a target —
  explicit `targetId` (validated active, platform-matching) or `resolveDefaultTarget(platform)` —
  and snapshots `{ targetId, expectedHandle: target.handle, sessionName: connection.sessionName }`
  into each `PublishJobTarget` (`types.ts:26-36`). A platform with no registered target falls back
  to a platform-only entry (legacy shape) so pre-UI flows keep working.
- Retry (`content-list-client.tsx:236-267`) replays `targetId`s from the job's own targets, not
  just `payload.platforms`.

### 6.2 `get_publish_job`

Response (`publish-handlers.ts:101-119`) additionally emits per-target `targetId`,
`expectedHandle`, `sessionName`, and top-level `prepareRequired: true` advisory. The legacy
top-level `browserSessionName` field stays.

### 6.3 Completion / update matching

- `completePublishSchema` / `updatePublishJobSchema` gain optional `targetId` and `leaseId`.
- Matching order in `handleCompletePublish` (`publish-handlers.ts:170`): entry with equal
  `targetId` → else legacy platform match. `targetMatchesResult` idempotency comparison includes
  `targetId` when present.
- Audit write (`publish-handlers.ts:199-211`): resolve the acting target
  (explicit `targetId` → job-snapshot targetId → `resolveDefaultTarget(platform)` → last resort
  `registerPlatformTarget` from the reported handle). `createContentPost` writes both
  `platformAccountId` (target's bridge, else `ensureSessionPlatformAccount` as today) and the new
  `targetId`. `publishVariantForContentItem` edge `properties` gain `targetId` (additive JSON,
  `variants.ts:204-213`).
- **Legacy queued jobs** (created before this change, JSON entries without `targetId`): remain
  readable untouched; completion resolves the default target at completion time per I5.

### 6.4 Skill and script

`.claude/skills/signals-publish` updates: the workflow becomes
`get_publish_job → targets prepare <targetId> --intent publish → x-publish (job.json now includes
expectedHandle from the job snapshot) → complete_publish { targetId, leaseId, … } → targets release`.
`x-publish.cjs` treats `expectedHandle` as **required** when the job supplies it and fails with new
`errorCode: "wrong_account"` on mismatch (today it silently falls back to whoever is logged in,
`x-publish.cjs:1118`). `complete_publish` maps `wrong_account` onto the failed target. Old skill
installs (no prepare, no targetId) keep working through the legacy fallbacks — serialization for
them is best-effort until the skill package is updated, which is truthful and documented.

## 7. Agent-tools, OpenAPI, and `signals-pp-cli targets`

### 7.1 New tools (registry `src/lib/agent-tools/registry.ts`, category: new `"platforms"` value widened onto `AgentToolCategory`)

| Tool | Input (zod, within `zodToParameters` subset) | Result |
|---|---|---|
| `list_platform_targets` | `{ platform?, kind?, connectionId?, includeForgotten? }` | `{ targets: TargetView[], connections: ConnectionView[] }` |
| `get_platform_target` | `{ targetId }` | `TargetView & { connection, lease: { held, holder?, expiresAt? } }` |
| `prepare_platform_target` | `{ targetId, intent: "browse"\|"publish", leaseId?, leaseTtlSeconds?, holder? }` | `{ targetId, platform, kind, sessionName, startUrl, expectedHandle, verified, verifiedHandle, activation: { switched }, lease: { leaseId, expiresAt } }` |
| `release_platform_target` | `{ leaseId }` | `{ released: true }` |

`prepare_platform_target` = resolve target → resolve connection → `ensureRtxSessionRunning`
(generalized to take a session name) → `acquire` lease → platform adapter `activate` if the live
identity differs (§8) → `verify` → persist `lastVerifiedAt` → return context. Any failure after
acquire releases the lease before returning the typed error. `startUrl` is the platform home URL
(or target `canonicalUrl` for pages); actual navigation is the agent's job via `agent-browser` (I6).

Handlers live in `src/lib/agent-tools/platform-target-handlers.ts` following the
`handle<PascalToolName>` + colocated schema conventions. Registry changes require
`npm run generate:agent-tools-openapi` (byte-checked in `npm run check`). `AGENT_TOOL_VERSION`
stays `"1"` — all changes are additive (schema-v0.5 §4 rule 3: existing tool contracts unchanged;
new capability = new tools). Update the tool table in `docs/agent-tools.md`.

### 7.2 CLI (transcendence-driven — ADR-191-5)

New `tools/signals-pp-cli/transcendence/targets.go`: `newTargetsCmd(flags)` parent with
`list [--platform] [--kind]`, `show <targetId>`, `prepare <targetId> --intent browse|publish
[--ttl N] [--lease <id>]`, `release --lease <id>`. Each calls `POST /api/agent-tools/invoke`,
prints the JSON result as the last stdout line, and maps codes to the spec §3 exit codes:
`TARGET_NOT_FOUND` → 3, auth → 4, everything else typed → 5 with the machine-readable `code`
(and `retryAfterSeconds` for `SESSION_LEASE_HELD`) in the JSON. Register via the
`requireReplace` extension point in `tools/signals-pp-cli/patch/patchSignalsCliSource.mjs:86`
(`rootCmd.AddCommand(newTargetsCmd(flags))`). Add a golden test mirroring
`scripts/test-signals-pp-cli-import.mjs`.

### 7.3 Internal REST (Settings UI; bare-payload convention of `/api/platforms/*`)

`/api/platform-targets` (GET list), `POST /api/platform-targets/register-current`
`{ platform, connectionId? }` (detect + register the live identity),
`POST /api/platform-targets/discover` `{ platform }`, `POST /api/platform-targets/[id]/default`,
`POST /api/platform-targets/[id]/verify`, `DELETE /api/platform-targets/[id]` (forget, I7).
Existing `/api/platforms/{platform}` payloads gain an additive `targets` array so current cards
keep rendering during the UI transition.

## 8. Per-platform v1 truth matrix (discover / activate / verify)

New seam `src/lib/platforms/target-adapters/{x,linkedin,facebook}.ts` implementing
`{ discover(page), activate(page, target), verify(page, target) }`, driven server-side over CDP
exactly like `detectLoggedInViaCdp` (playwright `connectOverCDP`, DI `(input, env, fetchImpl)`,
tab acquisition via RTX because `newPage()` fails against the RealTimeX browser). Verification
reuses/extends `detectPlatformHandle` (`browser-connection.ts:565`) and compares normalized
handle (or externalId when known) against the target; mismatch ⇒ `TARGET_NOT_ACTIVE`.

| | X | LinkedIn | Facebook |
|---|---|---|---|
| Register current | ✅ detected handle → target `kind: account` | ✅ detected `/in/` vanity → `kind: profile` | ✅ detected slug/`id:` → `kind: profile` |
| Discover | Best-effort: open account switcher (`X_SELECTORS.accountSwitcher`), enumerate signed-in accounts | ✅ current member only (no in-page multi-account enumeration) | Best-effort: profile-switcher dialog enumerates Pages → `kind: page`, `authPrincipalTargetId` = profile |
| Activate (shared session) | ✅ switcher click flow to the requested account | ❌ `TARGET_ACTIVATION_UNSUPPORTED` unless already active (guidance: manual re-login or dedicated connection) | ✅ switch-profile flow into Page / back to profile (best-effort) |
| Verify | handle match | vanity match | profile slug / Page identity match |
| Capabilities | `["browse","publish"]` | `["browse","publish"]` (publish stays beta/interactive) | profile `["browse"]`, page `["browse"]` — publish intent ⇒ `TARGET_CAPABILITY_UNSUPPORTED` |

Truthfulness notes: LinkedIn keeps one active member session per browser profile (`li_at`); v1
does not pretend to switch it — multiple LinkedIn members are supported via dedicated connections.
Discover flows are best-effort DOM enumeration and may return only the current identity; "Add
current target" is the guaranteed path everywhere. Facebook publish stays off the agent lane
(matches `docs/rtx-browser-publish.md`).

Dedicated connections v1: creatable via REST/Settings (name pattern `signals-target-<slug>`,
registered with the same `buildPublishSessionGuardrails()`); user logs in there and registers the
identity, which re-homes the target (§4.2). No automation opens extra sessions implicitly.

## 9. Settings UI

`src/app/dashboard/settings/page.tsx` replaces the three per-platform singleton cards with:

- one **browser connection** surface per connection (session name, running state, Open session,
  Clear session — clear is the only cookie-destructive action, I7);
- platform groups under the connection listing target rows: kind badge, name/handle, default
  star, capabilities, `lastVerifiedAt`, lease indicator when held;
- row/group actions: **Add current target**, **Discover targets**, **Set default**,
  **Switch & verify** (calls prepare with intent browse then releases), **Forget target**.

The per-platform triplicated state in `page.tsx:85-103` collapses into one `targets`-keyed state
fed by `/api/platform-targets`. `social-platform-card.tsx` becomes the group shell; row component
is new. OAuth "Advanced" section is untouched.

## 10. Migration, backfill, rollback

Order (each step independently shippable, N-1 safe):

1. **DDL** `0026_platform_targets.sql`: 3 tables + `content_posts.target_id` + indexes. No data
   movement (schema-v0.5 §4 rule 5).
2. **Backfill** `src/lib/db/backfill-platform-targets.ts`, wired into `instrumentation.ts`
   `register()` in its own try/catch like existing backfills; idempotent (natural-key lookups,
   `INSERT OR IGNORE` semantics), re-runnable, provenance `metadata.source =
   "backfill:platform-targets-v1"`:
   - ensure `browser_connections` row for `sessionName = "signals-publish"` (kind `shared`);
   - for each of x/linkedin/facebook with an existing `platform_accounts` row: create the default
     target (kind per §2; `handle` parsed from `display_name` only when it matches a handle shape,
     else name-only with `handleNormalized = NULL`); bridge `platformAccountId`; `isDefault = true`.
3. **Code cutover** behind the query layer: all identity reads go through
   `resolveDefaultTarget`/`resolveTargetById`; `getPlatformAccountByPlatform` remains only as the
   credential bridge lookup.

Rollback/compat: an N-1 binary sees only unknown tables and one nullable column — fully usable
(rule 8). The backfill is additive and re-runnable; a bad backfill is deletable by provenance tag
(rule 6). No feature flag needed: every legacy call path (platform-only jobs, old skill, old CLI)
resolves through the default-target fallback, and new fields are optional everywhere.

## 11. Test plan (proof required before routing Review → QA)

Focused suites (vitest, existing conventions: `resetCoreTables`, `vi.mock("playwright")`, injected
`env`/`fetchImpl`):

1. `platform-targets.test.ts` — upsert precedence (externalId → handle → create), handle
   normalization table, externalId adoption, merge repoints `content_posts` + tombstone
   resolution, re-home, forget/resurrect, default uniqueness + deterministic
   `resolveDefaultTarget` order, backfill idempotency (run twice ⇒ identical rows).
2. `session-lease.test.ts` — acquire/renew/release, contention (`SESSION_LEASE_HELD` +
   `retryAfterSeconds`), same-holder re-entry, expiry steal + `LEASE_LOST` fencing, independent
   leases on two connections (**dedicated-concurrency AC proof**).
3. `platform-target-handlers.test.ts` — list/get/prepare/release envelopes, prepare happy path
   (mocked adapter), each typed error in §5.2, lease released on post-acquire failure,
   capability gating (facebook publish), linkedin `TARGET_ACTIVATION_UNSUPPORTED`.
4. `publish-handlers.test.ts` (extend) — targetId matching, platform fallback on legacy jobs,
   default resolution at completion, `content_posts.target_id` written, idempotent replay with
   targetId, `wrong_account` mapping, `leaseStale` reporting.
5. `target-adapters/*.test.ts` — X switcher activate/verify, facebook page verify, linkedin
   verify-only, all against mocked pages (no live platforms).
6. `browser-connection.test.ts` (extend) — validation registers a second target instead of
   renaming the first (**the overwrite regression test**).
7. Golden CLI script test for `targets` (skips when binary absent) + regenerated
   `openapi/agent-tools.json`.

Gate: `npm run check` green (typecheck, lint, **openapi byte-check**, coverage, skill package,
provision verifier, `db:migrate`, build). Docs updated: `docs/agent-tools.md`,
`docs/rtx-browser-publish.md` (session doctrine), `.claude/skills/signals-publish/SKILL.md` +
`reference.md`, `specs/publish-via-terminal-agent.md` §3.3/§3.4/§7.5 deltas.

## 12. Acceptance matrix (issue #191 AC → design → proof)

| AC | Design | Proof |
|---|---|---|
| One connection retains multiple same-platform targets | §3 schema, §4.2 upsert | suite 1 |
| Validation/upsert doesn't overwrite another target | §4.5 | suite 6 |
| Stable ids; handle changes don't fork when externalId known | §4.2/4.3 | suite 1 |
| Settings lists multi X/LinkedIn + FB profile/Page | §8, §9 | suite 5 + manual QA |
| agent-tools + CLI list/show/prepare structured JSON | §7 | suites 3, 7 |
| Publish jobs carry targetId; matching not platform-only | §6.1/6.3 | suite 4 |
| Audit records retain acting target | §6.3 (`content_posts.target_id`) | suite 4 |
| Shared-session different-target work serialized whole-op | §5 (I1) | suite 2 |
| Dedicated sessions concurrent | §5.1 per-connection leases | suite 2 |
| Verify before mutate, fail closed | §5/§6.4/§8 (I2) | suites 3, 5 + `wrong_account` |
| Migration/default fallback covers legacy | §10, §6.3 | suites 1, 4 |
| Focused tests listed | §11 | — |

## 13. Design decisions (mini-ADRs)

- **ADR-191-1 — Two registry tables + bridge, no connection↔target join table.** Options: (a)
  widen `platform_accounts` with target columns — rejected: conflates credential ownership with
  acting identity, breaks the singleton readers silently, violates rule 3's spirit; (b) full
  N:M `connection_target_access` join — rejected for v1: the only real N:M case (same identity in
  shared + dedicated session) is handled truthfully by re-homing, and the join table triples the
  query surface before any consumer needs it; (c) **chosen**: `browser_connections` +
  `platform_targets` (1—N via `connectionId`, matching the issue contract shape) + nullable
  `platformAccountId` bridge keeping `platform_accounts` untouched as credentials/sync owner.
  Consequence: adding the join table later is additive (rule 1) if per-connection verification
  state is ever needed.
- **ADR-191-2 — Identity = (platform, kind, externalId) with normalized-handle fallback and
  adopt-or-merge.** Names/handles mutable; provisional rows (externalId NULL) dedup on
  `handleNormalized`; adoption fills externalId in place; conflict merges with audit repointing +
  tombstone (§4.3). Rejected: treating handle as permanent identity (breaks on rename), and
  requiring externalId up front (X DOM does not expose the numeric id — would block v1).
- **ADR-191-3 — DB-backed lease with fencing tokens, steal-on-expiry.** Rejected: in-process
  promise queue (`anon-browser-resolver.ts:46` pattern) — routes run on separate workers; RTX-side
  locking — no such API; job-status-as-lock — publish jobs are not the only lease consumers.
  Completion reports are recorded even with a stale lease (audit truth) but flagged.
- **ADR-191-4 — targetId travels in `publish_jobs.targets` JSON + new `content_posts.target_id`
  column; no new `publish_jobs` column.** Jobs are multi-target; the JSON entry is already the
  per-destination record and the completion matching key becomes `(jobId, targetId)`. The audit
  row gets a real column because it is queried relationally.
- **ADR-191-5 — CLI via transcendence Go commands, not OpenAPI path expansion.** Per
  `specs/signals-pp-cli.md` ADR-174-5 split; adding REST paths risks regenerated `root.go`
  breaking the patch regexes, and compound commands (prepare = resolve+lease+activate+verify) are
  exactly what transcendence exists for. The OpenAPI spec still gains the new tools automatically
  through the registry → invoke `oneOf`.
- **ADR-191-6 — LinkedIn v1 is verify-only in shared sessions.** One `li_at` member per browser
  profile is the platform reality; pretending to switch would violate "minimum truthful v1".
  Multi-LinkedIn = dedicated connections. Revisit if a reliable in-page switcher ships.
- **ADR-191-7 — Boot-time idempotent backfill, no SQL data movement.** Follows schema-v0.5 §4
  rule 5/6 and the existing `instrumentation.ts` backfill pattern; SQL migrations stay pure DDL.

## 14. Implementation order (dev slices, each lands green)

1. Schema + `platform-targets` query layer + identity/dedup + default resolution + backfill
   (suites 1, 6 groundwork).
2. Session lease service + typed errors (suite 2).
3. Agent-tools list/get/prepare/release (adapter mocked) + OpenAPI regen + docs (suite 3).
4. Publish pipeline threading: send-to-agent targets, get/complete/update, `content_posts.target_id`,
   legacy fallback, skill/`x-publish.cjs` `expectedHandle`+`wrong_account` (suite 4).
5. Target adapters X/Facebook/LinkedIn discover/activate/verify wired into prepare (suite 5).
6. CLI `targets.go` + golden test; Settings multi-target UI + internal REST; doc/spec updates.

Slices 1–2 unblock everything; 3–4 and 5–6 can proceed in parallel after them.
