# Publish via Terminal Agent (Signals CRM + RTX execution lane)

**Status:** Approved v1
**Issue:** [#118](https://github.com/therealtimex/signals/issues/118) — completes lane separation started by P6a ([#6](https://github.com/therealtimex/signals/issues/6), PR #117)
**Supersedes (at Phase 4):** the inline executor path of `specs/p6a-rtx-x-publish.md` (the deterministic step sequence and verification design from P6a are **ported, not discarded** — see §8)
**Author:** System Design (loop-issue-118-abd8d384)
**Date:** 2026-08-17

---

## 1. Problem and doctrine

P6a moved the browser to RTX but left orchestration inside Signals: `POST /api/content/publish` synchronously drives CDP from the Next.js server and holds the HTTP request open — up to 5 minutes in review mode (`x-publish-steps.ts:364`). The Compose modal exposes execution modes (Auto / Review / Thread) that are really *executor implementation details*, not user intent.

Doctrine (agreed at Origin):

- **Signals = source of truth.** Drafts, content items, publish intent, job records, CRM bookkeeping.
- **RealTimeX = execution lane.** A dedicated terminal agent thread owns the browser work, retries, and judgment calls.
- The bridge is the RTX **AI Editor pattern**: compose intent in Signals → launch a terminal CLI agent session with a task prompt → agent executes → agent writes results back through Signals agent-tools.

### Agreed product decisions (fixed inputs to this design)

1. Compose modal: remove Auto / Review / Thread toggles and the API Publish + Publish buttons → single primary **Send to agent**. Multi-platform chips. Updated title/subtitle copy.
2. Post-send: close modal → Content list; row shows publish status (`queued` → `publishing` → `published` / `failed`) + **Open thread** action.
3. Bridge: `POST {rtxApiBase}/sdk/desktop/runtime-sessions/launch-terminal-cli-agent` with `x-app-id`; add `desktop.runtime-sessions` to `rtx-manifest.json`.
4. No Thread toggle: the user expresses threading/format intent in the post body; the agent applies per-platform best practices.

### Non-goals (this issue)

- LinkedIn deterministic publish skill (X first; LinkedIn is best-effort, see §7.4).
- Removing Playwright from the repo entirely (P6d).
- OAuth "API Publish" path — hidden from Compose UI; `/api/platforms/x/compose` publish behavior itself is untouched.
- Server-side job watchdog / scheduler (v1 is lazy reconciliation, §6.4).
- Hard cancel of a running agent session from Signals UI.

---

## 2. Architecture overview

```
┌─────────────────────────── Signals (Local App) ───────────────────────────┐
│  ComposeDialog ──► POST /api/content/send-to-agent                        │
│                        │  1. snapshot payload → publish_jobs (queued)     │
│                        │  2. content_items.status = "queued"              │
│                        │  3. ensure workspace + create thread  (/cli/*)   │
│                        │  4. launch agent session              (/sdk/*)   │
│                        │  5. store session/thread refs on job             │
│  Content list ◄── job + item status (poll while active)                   │
│      └─ "Open thread" ──► POST /api/content/publish-jobs/:id/open-thread  │
│                                                                           │
│  Agent-tools (inbound, localhost/bearer):                                 │
│    get_publish_job · update_publish_job · complete_publish                │
└───────────────────────────────────────────────────────────────────────────┘
                 │ outbound x-app-id                      ▲ inbound HTTP
                 ▼                                        │
┌─────────────────────────── RealTimeX desktop ─────────────────────────────┐
│  SDK relay ──► terminal CLI agent session (chat-linked, in publish thread)│
│    agent loads `realtimex-signals` + `signals-publish` skills             │
│    ├─ get_publish_job → texts, media paths, platforms                     │
│    ├─ shapes thread/format per platform (LLM judgment)                    │
│    ├─ resolves RTX Browser session "signals-publish" (terminal-scoped     │
│    │   auth — available here, unlike the Local App process)               │
│    ├─ runs deterministic publish script per platform (ported P6a steps)   │
│    └─ complete_publish per platform → Signals finalizes item + post rows  │
└───────────────────────────────────────────────────────────────────────────┘
```

Boundary rule: **Signals never talks CDP again.** The deterministic browser mechanics move into a skill script executed inside the agent session. Signals' only RTX calls are workspace/thread provisioning, session launch, and (optionally) window focus.

### Division of deterministic vs LLM work

| Concern | Owner | Why |
|---|---|---|
| Publish intent, payload snapshot, job state, CRM rows | Signals server | Source of truth |
| Thread splitting, per-platform formatting, tone | Agent (LLM) | Product decision #4: intent lives in the body |
| Browser steps: login check, compose, media upload, submit, verification | Deterministic skill script (ported P6a) | P6a decision stands: "publish must be repeatable and testable" |
| Error recovery, re-login prompts, retries within the thread | Agent (LLM) | This is exactly what the agent lane buys us over P6a |
| Result recording, status transitions, post rows | Signals via `complete_publish` | Invariants enforced at the source of truth |

---

## 3. Data model

### 3.1 New table: `publish_jobs`

```ts
export const publishJobs = sqliteTable("publish_jobs", {
  id: text("id").primaryKey(),                       // pj_<nanoid>
  contentItemId: text("content_item_id").notNull()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["queued", "publishing", "completed", "partial", "failed", "superseded"],
  }).notNull().default("queued"),
  // Immutable payload snapshot at send time (user may edit the draft afterwards)
  payload: text("payload").notNull(),                // JSON PublishJobPayload
  // Per-platform progress, mirrored from agent callbacks
  targets: text("targets").notNull(),                // JSON PublishJobTarget[]
  // RTX execution lane references
  rtxWorkspaceSlug: text("rtx_workspace_slug"),
  rtxThreadSlug: text("rtx_thread_slug"),
  rtxRuntimeSessionId: text("rtx_runtime_session_id"),
  error: text("error"),                              // launch/system-level error
  errorCode: text("error_code"),                     // PublishErrorCode | "launch_failed" | "rtx_unavailable"
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
});
// indexes: idx_publish_jobs_content_item (contentItemId), idx_publish_jobs_status (status)
```

```ts
interface PublishJobPayload {
  text: string;                    // full body as authored (threading intent inline)
  mediaAssetIds: string[];         // ordered
  platforms: PlatformTarget[];     // ["x", "linkedin"]
  title?: string;
  composedAt: number;
}

interface PublishJobTarget {
  platform: "x" | "linkedin";
  status: "pending" | "publishing" | "published" | "failed" | "skipped";
  platformPostId?: string;
  platformUrl?: string;
  handle?: string;
  error?: string;
  errorCode?: string;              // P6a PublishErrorCode taxonomy preserved
  startedAt?: number;
  completedAt?: number;
}
```

Rationale (ADR-118-2, §11): a first-class table rather than `content_items.platformData` JSON because jobs have their own lifecycle, need indexed status queries for the list UI and lazy reconciliation, and an item accumulates multiple jobs over time (retry = new job, old one `superseded`).

### 3.2 `content_items.status` enum extension

Add `"queued"`, `"publishing"`, `"failed"` to the existing enum (`draft | review | approved | scheduled | published | imported`). SQLite stores TEXT with no CHECK constraint, so the migration is TS-level plus a drizzle snapshot bump — no data rewrite.

This also **repairs the P6a status overload**: `/api/content/publish` currently writes `status: "review"` as an in-flight marker (`route.ts:61`), colliding with human-review semantics. After this change `review` means human review only.

Fix the pre-existing drift while touching this: `query_content` agent-tool schema (`schemas.ts:148-153`) declares `["draft","scheduled","published","archived"]` — `archived` doesn't exist in the DB and `review/approved/imported` are missing. Align it with the DB enum + new values.

### 3.3 `content_posts` — unchanged

Per-platform published results remain `content_posts` rows (one per platform account), created **only at completion** by `complete_publish`, because `platformAccountId` is NOT NULL and the account row (auth_type `"session"`) can only be resolved once the agent has detected the logged-in handle. The P6a `ensureXPlatformAccount` helper is reused verbatim, generalized to `ensureSessionPlatformAccount(platform, handle)`.

### 3.4 Status derivation rules

Item status is **owned by the job state machine** while a job is active:

| Event | Job | Targets | Item |
|---|---|---|---|
| send-to-agent accepted | `queued` | all `pending` | `queued` |
| launch fails (RTX down, 503, permission) | `failed` + errorCode | — | **revert to `draft`** (user can edit/retry; failure surfaced via toast + job record) |
| first `update_publish_job(publishing)` from agent | `publishing` | that target `publishing` | `publishing` |
| `complete_publish` (success) for a target | recompute | target `published` | recompute |
| `complete_publish` (failure) for a target | recompute | target `failed` | recompute |
| all targets terminal, ≥1 published, 0 failed | `completed` | — | `published` |
| all targets terminal, ≥1 published, ≥1 failed | `partial` | — | `published` (per-platform detail from targets) |
| all targets terminal, 0 published | `failed` | — | `failed` |
| retry (new send-to-agent on same item) | old job → `superseded` | — | driven by new job |

Invariants:

- At most one non-terminal (`queued`/`publishing`) job per content item — enforced in `send-to-agent` (supersede or reject, §5.1).
- Job status transitions are monotonic; `complete_publish` on a terminal target is idempotent (returns the recorded result, no double `content_posts` row — the existing unique index `(platformPostId, platformAccountId)` backs this).
- Only `send-to-agent` and the agent-tools handlers may write `queued|publishing|failed` item statuses.

---

## 4. RTX bridge (outbound from Signals server)

New module `src/lib/rtx/runtime-sessions.ts`, following the `sdk.ts` header pattern (`x-app-id`, `resolveRtxApiBase`).

### 4.1 Manifest and registration

`rtx-manifest.json`: append `"desktop.runtime-sessions"` to `permissions`, bump version. `RTX_SDK_PERMISSIONS` picks it up automatically via `src/lib/rtx/manifest.ts`; `/sdk/register` will raise the consent prompt for the new permission on next bootstrap. `send-to-agent` must handle `403 PERMISSION_REQUIRED / PERMISSION_DENIED` as a first-class failure (§5.1) — the user may not have granted the toggle yet.

### 4.2 Workspace and thread provisioning

The SDK launch route **targets** a workspace/thread but creates neither. Provisioning uses the `/cli` surface (accepts `x-app-id` via `validApiKey`):

1. **Workspace** (once, get-or-create): slug from `SIGNALS_RTX_WORKSPACE_SLUG`, default `"signals"`. `POST /cli/create-workspace`; treat "already exists" as success.
2. **Thread** (one per job, never reused — mirrors the Personal Notes pattern of a fresh thread per editor session): `POST /cli/create-thread/:workspaceSlug` with name `Publish: <item title or first 40 chars> — <YYYY-MM-DD HH:mm>`. Store the returned slug on the job.

ADR-118-1 (§11) records why launch stays on `/sdk` while provisioning uses `/cli`, and flags the RTX-side enforcement gap (the `/cli` surface honors `x-app-id` without any permission check) as an upstream issue to file — Signals must not silently rely on that gap for *launching* sessions.

### 4.3 Launch contract

```
POST {rtxApiBase}/sdk/desktop/runtime-sessions/launch-terminal-cli-agent
x-app-id: {RTX_APP_ID}
```

```jsonc
{
  "workspaceSlug": "<provisioned>",
  "threadSlug": "<per-job thread>",
  "agentName": "<SIGNALS_RTX_AGENT_NAME, default \"claude\">",   // only required field
  "agentType": "terminal-cli",
  "interactionMode": "chat-linked",     // turn appears in the RTX chat thread
  "primarySurface": "chat",
  "firstTurnDelivery": "queued",
  "message": "<initial message, §7.2>",
  "spawnSource": "signals-publish",
  "requestedBy": "Signals",
  "reason": "Publish content item <id> to <platforms>"
}
```

Success → `{ success: true, descriptor }`; persist `descriptor.id` → `rtxRuntimeSessionId` (and reconcile slugs from `descriptor.linkage` if present).

Known SDK-boundary limitations (verified against `desktopRuntimeSessions.js`) and their mitigations:

| Limitation | Mitigation |
|---|---|
| `requiredSkillNames` is not forwarded (silently dropped) | Skill names referenced **in the prompt text** (Personal Notes pattern); skills provisioned into the workspace at setup time (§7.3) |
| `cwd` / `launchEnv` not client-specifiable | Not needed — the agent gets everything via agent-tools over HTTP; base URL and job id are in the prompt |
| Relay returns `503 DESKTOP_RUNTIME_SESSION_RELAY_ERROR` when the desktop renderer isn't running (120 s relay timeout) | Treat as `errorCode: "rtx_unavailable"` → job `failed`, item reverted to `draft`, actionable toast |
| No SDK resume endpoint | Out of scope; a failed session is retried as a **new job/thread** |

### 4.4 Error taxonomy for launch

| Condition | `errorCode` | User-facing behavior |
|---|---|---|
| standalone (no `RTX_APP_ID`) | `standalone` | Button disabled pre-flight (§6.5); API returns 400 |
| 403 permission | `permission_required` | Toast: "Grant 'Desktop Runtime Sessions' to Signals in RealTimeX → Local Apps" |
| 404 APP_NOT_FOUND | `rtx_unavailable` | Toast: re-register hint |
| 503 relay | `rtx_unavailable` | Toast: "RealTimeX desktop isn't running" |
| thread/workspace provisioning failure | `launch_failed` | Toast with error detail |

---

## 5. Signals API surface

### 5.1 `POST /api/content/send-to-agent` (new)

```ts
const sendToAgentSchema = z.object({
  contentItemId: z.string(),
  platforms: z.array(z.enum(["x", "linkedin"])).min(1),
  text: z.string().min(1),
  mediaAssetIds: z.array(z.string()).optional(),
});
```

Flow (synchronous, but fast — no browser work):

1. Load item; require status in `draft | approved | failed` (a `failed` item is retryable in place). 404 / 400 otherwise.
2. If a non-terminal job exists for the item: mark it `superseded` and proceed (retry semantics). The old agent session is *not* killed — its later `complete_publish` calls against a superseded job are accepted into the job record but do **not** drive item status (guard in §7.5 handlers).
3. Insert `publish_jobs` row (`queued`, payload snapshot, targets `pending`).
4. Set item `status = "queued"`.
5. Provision workspace/thread (§4.2), launch session (§4.3), persist refs.
6. On any launch failure: job → `failed` (+errorCode), item → `draft`, respond with the error.

Responses:

```jsonc
// 202
{ "success": true, "jobId": "pj_…", "rtxWorkspaceSlug": "signals", "rtxThreadSlug": "…", "status": "queued" }
// failure
{ "success": false, "error": "…", "errorCode": "rtx_unavailable" }   // 400/502 per §4.4
```

### 5.2 `GET /api/content/publish-jobs?contentItemId=` and `GET /api/content/publish-jobs/:id`

Returns job(s) with parsed `targets` and elapsed time. Backs list-row status detail, the per-platform chips, and polling. **Lazy staleness** (§6.4) is applied on read.

### 5.3 `POST /api/content/publish-jobs/:id/open-thread`

Server-side "bring the user to the thread" (§6.3): calls RTX `POST /sdk/desktop/runtime-sessions/open-launcher` with the job's `workspaceSlug`/`threadSlug` (raises + focuses the desktop window targeted at the thread context). Returns the thread path `/workspace/<ws>/t/<thread>` for the client to display regardless.

### 5.4 `POST /api/content/publish` (existing) — deprecation path

- **Phase 1–3:** route remains but is no longer reachable from the UI.
- **Phase 4:** route returns `410 Gone` with `{ error: "Replaced by /api/content/send-to-agent", errorCode: "gone" }`; `src/lib/browser/rtx-publish/` executor modules are deleted once their step logic is fully ported into the skill (§8). `/api/platforms/x/compose` (OAuth API path) is untouched — only hidden from Compose.

---

## 6. UI

### 6.1 Compose modal (`src/components/compose-dialog.tsx`)

Removed: publish-mode segmented control (Auto/Review), Thread/Single toggle, multi-post thread editor (`posts[]` collapses to a single body), **API Publish** and **Publish** buttons, the 5-minute blocking progress states, inline "Published successfully" link.

| Element | Spec |
|---|---|
| Title / subtitle | "Compose" / "Draft in Signals — a RealTimeX agent publishes it per platform." |
| Platform chips | Multi-select chips (X, LinkedIn) replacing the radio segmented control; ≥1 required to send; persisted per-draft in `platformTarget` (comma-joined) |
| Body | Single textarea, no per-platform char cap enforcement (agent reformats); soft counter showing X/LinkedIn limits as guidance |
| Media | Unchanged (`POST /api/media`) |
| Threading hint | Muted helper under body: "Want a thread? Just say so in your post — the agent will split it per platform." |
| **Save Draft** | Unchanged, CRM-only |
| **Send to agent** (primary) | Enabled when body non-empty ∧ ≥1 platform ∧ embedded mode. Flow: save/refresh draft via existing compose endpoint (`saveAsDraft: true`) → `POST /api/content/send-to-agent` → on 202: close modal, toast "Sent to agent — open the thread to follow progress" with an **Open thread** toast action; on failure: stay open, inline error per §4.4 copy |

### 6.2 Content list (`content-list-client.tsx`)

- Status badge column now renders all publish-relevant statuses: `draft` (yellow, existing), `queued` (gray, clock icon), `publishing` (blue, spinner), `published` (green), `failed` (red). This fixes the current gap where in-flight rows are visually indistinguishable from published ones.
- Per-platform detail: on `partial`/multi-platform jobs, small platform glyphs colored by target status (tooltip: error or URL).
- Row actions: existing `platformUrl` external link (from `content_posts`); **Open thread** button whenever the latest job has `rtxThreadSlug` (any status — the thread is the audit trail); **Retry** on `failed` (reopens Compose pre-filled? No — direct `send-to-agent` with the failed job's payload snapshot).
- Refresh: poll `GET /api/content/publish-jobs` every 5 s **only while** a visible row is `queued`/`publishing`; `router.refresh()` on terminal transition. (No SSE in v1 — the poll set is tiny and bounded.)

### 6.3 "Open thread" behavior

RTX has **no thread deep link today** (verified: protocol handler only routes share-join and auth callbacks). v1 therefore:

1. Client calls `POST /api/content/publish-jobs/:id/open-thread` → server fires `open-launcher` targeted at the workspace/thread, which raises the RTX window with the thread context focused.
2. The response's thread path is shown in the toast/tooltip ("Workspace *signals* → thread *Publish: …*") so the user can navigate manually if focus lands imperfectly.

**Upstream follow-up to file on `realtimex-ai-app`** (not blocking): add `POST /sdk/desktop/open-thread {workspaceSlug, threadSlug}` or a `realtimex-ai://workspace/thread?…` deep-link branch (small: one branch in `GlobalAuthListener` + `paths.workspace.thread`). When it exists, `open-thread` upgrades transparently server-side.

### 6.4 Stale jobs (no watchdog in v1)

On any job read: if `status ∈ {queued, publishing}` and `updatedAt` older than **30 min**, the API annotates `stale: true`; UI shows a warning tint + "Check the thread — the agent may need input" and enables **Mark failed** (`POST /api/content/publish-jobs/:id/fail`, guard: only stale non-terminal jobs; sets job `failed`/`errorCode: "timeout"`, item `failed`). No automatic state flips — the agent may legitimately be waiting on a human (e.g. X login) in the thread.

### 6.5 Standalone mode (no `RTX_APP_ID`)

`isRtxEmbedded()` is already the single switch. Standalone: **Send to agent** disabled with tooltip "Publishing requires the RealTimeX Local App" (same doctrine as P6a's `STANDALONE_MESSAGE`); Save Draft fully functional; `send-to-agent` API double-checks and 400s with `errorCode: "standalone"`. Compose remains useful as a drafting tool.

---

## 7. Agent lane

### 7.1 Agent-tools additions (3 tools + 1 schema fix)

Follows the 4-edit convention (schema → handler → registry → docs/reference). Category: `content`. Auth: existing mechanism (localhost or `SIGNALS_AGENT_TOOL_TOKEN` bearer) — the terminal agent runs on the same machine; no new auth channel. Structural precedent: `complete_simulation_run`.

**`get_publish_job`** `{ jobId }` →

```jsonc
{
  "jobId": "pj_…", "status": "queued",
  "contentItem": { "id": "…", "title": "…" },
  "payload": {
    "text": "…full body…",
    "platforms": ["x"],
    "media": [ { "assetId": "…", "path": "/abs/path/img.png", "mimeType": "image/png" } ]  // resolved via existing resolveMediaPaths
  },
  "targets": [ { "platform": "x", "status": "pending" } ],
  "browserSessionName": "signals-publish"
}
```

**`update_publish_job`** `{ jobId, platform?, status: "publishing", note? }` — marks target(s) and job in-flight; drives item → `publishing` (unless job superseded). Also accepts `{ status: "failed" }` per target *before* attempting (e.g. unsupported platform → target `skipped`/`failed` with reason).

**`complete_publish`** `{ jobId, platform, success, handle?, platformPostId?, platformUrl?, error?, errorCode? }` —

1. Validate job exists and target is for `platform`; idempotent if target already terminal with same result.
2. On success: require `handle` + `platformPostId`; `ensureSessionPlatformAccount(platform, handle)`; `createContentPost({ status: "published", … })`; `publishVariantForContentItem`.
3. Update target, recompute job + item status per §3.4 table. Superseded-job guard: record into the job but never touch the item.
4. Returns the recomputed job so the agent can report remaining targets.

**Schema fix:** align `query_content.status` enum with the DB (§3.2).

Documentation edits: `docs/agent-tools.md` (including revising the line "publish … not exposed here" at `:79`), `.claude/skills/realtimex-signals/SKILL.md:59` + `reference.md`.

### 7.2 Initial message template (composed server-side, Personal Notes pattern)

```
You are the publish agent for Signals CRM.

Job: {jobId} — publish content item "{title}" to: {platforms}.
Signals base URL: {baseUrl}

1. Load the `signals-publish` skill (and `realtimex-signals` for the agent-tools API) — use those exact names.
2. Call agent-tool `get_publish_job` with jobId "{jobId}" to get the full text, media file paths, and targets.
3. The author's threading/format intent is expressed in the post body. Apply each platform's best practices (e.g., split into a thread on X if the content warrants it; single post on LinkedIn).
4. Publish deterministically using the skill's publish script against the RealTimeX Browser session "signals-publish". Call `update_publish_job` when you start each platform.
5. After each platform, call `complete_publish` with the result (success requires the detected handle, post id, and URL; failures need error + errorCode from: session_expired, captcha, upload_failed, timeout, unknown).
6. If the browser isn't logged in, say so in this thread and wait for the user to sign in in the RealTimeX Browser window, then retry.

IMPORTANT: Only publish this job's content. Do not post anything else. Report a one-line summary per platform when done.
```

### 7.3 New skill: `signals-publish`

Location: `.claude/skills/signals-publish/` (sibling of `realtimex-signals`), packaged by extending `scripts/package-realtimex-signals-skill.sh` (or a parallel packager). Add `.claude/skills/` to `package.json` `files[]` **or** document that skills install from the repo/zip — decision left to dev, but the npm tarball gap is a known ship-blocker to resolve in Phase 3.

Contents:

- `SKILL.md` — workflow: resolve browser session (list/create/start `signals-publish` via `realtimex-pp-cli` or the `agent-browser` skill — **terminal-scoped auth is available in the agent session**, which is exactly the capability the Local App process lacked in P6a v1.1), run script, report, callback.
- `scripts/x-publish.mjs` — the deterministic executor, **ported from** `src/lib/browser/rtx-publish/` (§8). CLI contract:
  ```
  node scripts/x-publish.mjs --port <cdpPort> --payload <job.json>
  # job.json: { text | threadTexts[], mediaPaths[][], expectedHandle? }
  # stdout (last line): {"success":true,"handle":"…","platformPostId":"…","platformUrl":"…"}
  #                  or {"success":false,"error":"…","errorCode":"session_expired|captcha|upload_failed|timeout|unknown"}
  ```
  Self-contained (bundled or minimal deps — `playwright-core` for `connectOverCDP`, same as P6a). Preserves: login/handle detection, selector table, human-type fill, media upload with retry, thread loop, submit, **snowflake-verified ownership check** (baseline → new owned status id → text match). Review-mode polling is dropped — human review now happens *in the thread* (the agent can pause before submit if the user asks, but that's conversational, not a mode).
- `reference.md` — selector table, error taxonomy, session doctrine (named session `signals-publish`, stop-not-delete, never log out).

Provisioning: install both skills into the `signals` workspace at setup. Extend `scripts/qa/provision-signals-local-app.mjs` to upload via the workspace agent-skills endpoint (as printed by the packager) or document the `realtimex-pp-cli create/enable-workspace-agent-skill` path. Degraded mode: the initial message plus `realtimex-signals`'s HTTP conventions are sufficient for a capable agent even if `signals-publish` is missing — the skill adds determinism, not reachability.

### 7.4 LinkedIn (best-effort tier)

The job model, tools, and UI are platform-generic. v1 acceptance covers X only. A LinkedIn target without a deterministic script: SKILL.md directs the agent to use `agent-browser` interactively (logged-in session required) and still report via `complete_publish`; if it declines, it must `complete_publish` with `success: false, errorCode: "unknown", error: "LinkedIn deterministic publish not yet supported"` so the target lands `failed`, item `partial`-aware per §3.4. LinkedIn chip carries a "beta" affordance in Compose.

### 7.5 Failure & edge modes (agent lane)

| Mode | Handling |
|---|---|
| Browser session missing/logged out | Script exits `session_expired`; agent messages the thread asking the user to sign in, retries; if abandoned, job goes stale (§6.4) |
| CAPTCHA | `captcha` → agent reports in thread, completes target as failed (no CAPTCHA solving) |
| Agent session dies mid-job | Job stalls → stale flow (§6.4); retry = new job (old → superseded) |
| Superseded job's late callbacks | Recorded on the job, never drive item status |
| Duplicate `complete_publish` | Idempotent (§7.1); post-row uniqueness backstopped by `(platformPostId, platformAccountId)` index |
| Agent posts wrong/extra content | Verification only confirms *this* text was posted; guardrail line in prompt; residual risk accepted (same trust level as any terminal agent with browser access) |

---

## 8. Migration from P6a inline executor

| P6a asset (`src/lib/browser/rtx-publish/`) | Disposition |
|---|---|
| `x-publish-steps.ts`, `x-publish-verification.ts`, `x-publish-selectors.ts`, `x-publish-login.ts`, `connect.ts`, `cdp-json-list.ts`, `x-publish-url.ts` | **Port** into `skills/signals-publish/scripts/x-publish.mjs` (logic and selector table preserved; unit tests ported alongside — selector/verification tests keep running in `npm run check` against the skill script source) |
| `resolve-session.ts`, `browser-session-client.ts`, `desktop-browser-client.ts`, `pp-cli.ts` | **Retire** (Phase 4). Session resolution moves to the agent (pp-cli/agent-browser with terminal auth) |
| `ensure-platform-account.ts` | **Keep in Signals**, generalized; now called from `complete_publish` handler |
| `constants.ts` (`RTX_PUBLISH_SESSION_NAME = "signals-publish"`) | Session name stays canonical; constant referenced by `get_publish_job` response + skill |
| `x-publish-executor.ts`, `publishers/x-publisher.ts` (Playwright) | **Delete** in Phase 4 (Playwright full removal remains P6d) |
| `PublishErrorCode` taxonomy | **Preserved** end-to-end (script → complete_publish → job target → UI) |

`docs/rtx-browser-publish.md` gets rewritten for the agent-lane flow in Phase 4.

---

## 9. Phased implementation plan

Each phase leaves `main` shippable; the legacy publish path keeps working until Phase 4.

- **Phase 1 — Foundation (server):** `publish_jobs` table + migration; status enum extension; `send-to-agent` + `publish-jobs` + `open-thread` + `fail` routes; `runtime-sessions.ts` bridge; manifest permission + version bump; agent-tools `get_publish_job` / `update_publish_job` / `complete_publish` + `query_content` schema fix; unit tests (job state machine table §3.4 is the test matrix).
- **Phase 2 — UI:** Compose rework (§6.1), content-list statuses + Open thread + polling + stale flow (§6.2–6.4), standalone gating (§6.5). Legacy Publish buttons removed here — from this phase on, the UI only sends to agent.
- **Phase 3 — Agent lane:** `signals-publish` skill + ported `x-publish.mjs` (+ ported tests); packaging/provisioning (incl. npm `files[]` decision); end-to-end QA against a live RTX with the `signals-publish` browser session.
- **Phase 4 — Retirement:** `/api/content/publish` → 410; delete retired modules per §8; docs rewrite; file the two upstream RTX issues (thread deep link / `open-thread` endpoint; `/cli` permission-gap).

Suggested story split for dev: P1 is 3 stories (schema+jobs, bridge+send-to-agent, agent-tools), P2 is 2 (compose, list), P3 is 2 (skill script port, provisioning+QA), P4 is 1.

---

## 10. Acceptance criteria (loop-level)

1. Compose shows no Auto/Review/Thread controls, no API Publish/Publish; **Send to agent** + multi-platform chips per §6.1 copy.
2. Sending: modal closes ≤2 s after 202; row shows `queued` without reload; RTX opens a chat-linked terminal session in a fresh thread under the `signals` workspace whose first turn is the §7.2 message.
3. Agent path (X, logged-in session): row transitions `queued → publishing → published`; `content_posts` row exists with verified `platformPostId`/`platformUrl`; variant projected; **Open thread** raises RTX focused on the job thread.
4. Failure path: logged-out browser → target fails `session_expired` OR agent asks for login in-thread and succeeds after sign-in; all-failed job → row `failed` with Retry; retry supersedes and re-runs.
5. Multi-platform X+LinkedIn: X published + LinkedIn failed → job `partial`, item `published`, per-platform glyphs correct.
6. Standalone (`RTX_APP_ID` unset): Send to agent disabled with tooltip; drafts unaffected.
7. RTX desktop not running: send fails with "RealTimeX desktop isn't running" toast; item back in `draft`.
8. `npm run check` green with ported selector/verification tests; no live X login required in CI (P6a testing doctrine preserved).

---

## 11. ADRs

### ADR-118-1: Launch via `/sdk/desktop/runtime-sessions`, provision via `/cli`

**Accepted.** Context: Origin fixed the SDK launch route + `desktop.runtime-sessions` permission (user-visible consent is the point). But the SDK route cannot create workspaces/threads, and only `/cli` (which honors `x-app-id` with *no permission check*) can. Decision: launch — the privileged operation — goes through the permission-gated SDK route; provisioning uses `/cli` get-or-create. Consequences: (+) user consent gates agent spawning; (+) zero RTX-side changes required to ship; (−) two surfaces in one flow; (−) we knowingly use an unpermissioned surface for provisioning — filed upstream as an RTX hardening issue rather than blocked on here. Rejected alternative: `/cli/open-terminal-session` for everything (richer contract, but bypasses the consent model entirely).

### ADR-118-2: First-class `publish_jobs` table

**Accepted.** Context: issue text suggested storing refs on the content item. Decision: dedicated table with payload snapshot + per-target JSON; `content_items` gains only status values. Consequences: (+) retry/supersede history, indexed status queries, immutable payload isolates later draft edits; (−) one more table + join for the list view. Rejected: `platformData` JSON on the item (no history, races with agent writes, unindexable).

### ADR-118-3: Deterministic publish script inside the skill; LLM owns shaping and recovery

**Accepted.** Context: P6a proved deterministic CDP publish; decision #4 gives the agent formatting judgment. Decision: port the P6a step/verification sequence into a self-contained script the agent executes; the agent never drives publish clicks freeform on X. Consequences: (+) repeatable, testable, preserves the verification invariant (new owned snowflake + text match); (+) recovery/login conversations become possible (the P6a review-mode 5-minute poll disappears); (−) script duplication of logic that briefly lives in both places until Phase 4; (−) skill distribution becomes a deliverable. Rejected: freeform agent-browser publishing (unverifiable, selector drift becomes silent misposts); keeping the executor in Signals behind an agent-tool (breaks lane separation — Signals would still own CDP).

### ADR-118-4: No server-side watchdog in v1

**Accepted.** A publishing agent may legitimately block on a human (login, CAPTCHA) for a long time inside the thread. Lazy staleness annotation + manual **Mark failed** keeps the human in the loop instead of a timer guessing. Revisit if stale jobs become common.

---

## 12. Open items for dev (non-blocking, resolve during implementation)

1. Verify `open-launcher` UX when targeted at an existing thread (window focus + context). If unacceptable, ship the toast-with-path fallback only and prioritize the upstream `open-thread` endpoint.
2. Confirm `/cli/create-workspace` / `create-thread` idempotency semantics and exact response shapes (explorer verified existence + auth, not full bodies).
3. `x-publish.mjs` dependency strategy: bundle vs. rely on `playwright-core` being resolvable in the skill sandbox — pick during Phase 3, keep the CLI contract fixed.
4. Whether Compose platform chips persist to `platformTarget` as comma-joined or a JSON field on `platformData` — either is fine; keep `listContentItems` platform filter working.
