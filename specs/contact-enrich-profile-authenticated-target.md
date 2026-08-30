# Contact Enrich Profile: authenticated RTX browser target binding (#384)

**Status:** Accepted (System Design, 2026-08-30, loop `loop-issue-384-b512b84d`)
**Issue:** [therealtimex/signals#384](https://github.com/therealtimex/signals/issues/384)
**Parents:** [`contact-web-research-enrichment.md`](./contact-web-research-enrichment.md) (#369 / PR #383),
[`platform-targets.md`](./platform-targets.md), [`docs/rtx-browser-publish.md`](../docs/rtx-browser-publish.md)
**Out of scope:** verified email discovery (#385).

## 1. Problem

Manual validation of merged #383 showed two defects in the contact-detail **Enrich profile** lane:

1. The persistent Signals workspace thread is named **Contact Web Research** (derived from the
   seeded template name by `buildTemplateThreadName(template.name)`), but the user-facing name must
   be **Contact Enrich Profile** — including installs that already hold the old thread binding in
   `workflow_templates.rtx_thread_slug`.
2. The research brief only says "Open this in RealTimeX Browser". Nothing resolves, leases, or
   verifies an authenticated browser target before dispatch, and nothing tells the agent which
   session to attach to. The agent picked an anonymous profile: Google served a CAPTCHA, LinkedIn
   redirected to `/authwall`, relevant profile links were missed, and the run "recovered" on public
   X data — i.e. an unauthenticated run was reported as research.

## 2. What already exists (read before implementing)

| Concern | Existing surface | Notes |
|---|---|---|
| Target registry + default | `src/lib/db/queries/platform-targets.ts` — `resolveDefaultTarget(platform)`, `resolveTargetById`, `listPlatformTargets` | `isDefault` per platform; falls back to oldest active target of that platform. |
| Lease + verify | `src/lib/platforms/platform-target-service.ts` — `preparePlatformTarget({ targetId, intent, holder, leaseId?, leaseTtlSeconds? })` | Acquires the per-connection lease, opens the platform tab in the connection's RTX session, probes login, matches live handle, marks verified. Returns `{ targetId, platform, sessionName, startUrl, expectedHandle, verifiedHandle, lease: { leaseId, expiresAt } }`. Releases the lease itself on any failure. |
| Lease primitives | `src/lib/leases/session-lease.ts` | TTL 30–1800 s; `releaseSessionLease` throws `LEASE_LOST` when already gone. |
| Error codes | `src/lib/platforms/target-errors.ts` | `TARGET_NOT_FOUND`, `TARGET_FORGOTTEN`, `TARGET_CAPABILITY_UNSUPPORTED`, `TARGET_ACTIVATION_UNSUPPORTED`, `CONNECTION_UNAVAILABLE`, `LOGIN_REQUIRED`, `SESSION_LEASE_HELD`, `LEASE_LOST`, `TARGET_NOT_ACTIVE`. |
| Agent tools | `src/lib/agent-tools/platform-target-handlers.ts` — `list_platform_targets`, `get_platform_target`, `prepare_platform_target`, `release_platform_target` | Registered in `registry.ts`; documented in `docs/agent-tools.md` and `openapi/agent-tools.json`. |
| Shared session | `RTX_PUBLISH_SESSION_NAME = "signals-publish"`; guardrails declared on every connect (`buildPublishSessionGuardrails`) | `allowedOrigins` = x.com / www.linkedin.com / www.facebook.com only. **CDP navigation bypasses guardrails**; RTX-routed tab opens (`start-browser-session --url`) do not. |
| Dispatch | `src/lib/agents/run-template-via-rtx.ts` — `runTemplateViaRtx` | Health preflight → workspace → `getOrCreateTemplateThread` → brief → `dispatchTerminalAgentViaSendMessage` → stored run config (`rtxWorkspaceSlug`, `rtxThreadSlug`, `rtxRuntimeSessionId`). |
| Thread binding | `src/lib/rtx/template-thread.ts` — `getOrCreateTemplateThread` (`reused` / `created` / `recreated` / `fresh`) | Name is only used on create. Presence via `GET /cli/get-thread/:ws/:thread` (`{ thread: { name, slug, … } }`). RTX also exposes `POST /cli/rename-thread/:ws/:thread` `{ name }` (name-only update). |
| Completion | `src/lib/agent-tools/handlers.ts` — `handleCompleteWorkflowRun` | Emits cascade, posts thread message, `stopRunningRtxBrowserSessions({ stopAllRunning: true })`, schedules terminal release. **Does not release leases.** |
| Result state | `src/lib/contacts/web-research-state.ts` | `partial` when `result.partial`/`ambiguous`/errors/unresolvedFields; `failed` on run status failed. |
| Precedent brief | `src/lib/workflows/social-patrol.ts` P1/P2/P9 | Agent-side `prepare … --intent browse`, connect over CDP to the returned `sessionName`, release at end. |

Two latent defects surfaced during inspection and are in scope because they break the failure
classification this issue requires:

- `src/lib/platforms/target-adapters/linkedin.ts` `activate()` throws
  `TARGET_ACTIVATION_UNSUPPORTED` whenever `verification.active` is false — including the plain
  logged-out case — so `preparePlatformTarget` never reaches its `LOGIN_REQUIRED` branch for
  LinkedIn. The user would be told "account switching is not supported" instead of "sign in".
- The seeded prompt and brief say "Open this in RealTimeX Browser", which an agent can satisfy with
  `create-browser-session`/`start-browser-session --url <google>` — the former creates the anonymous
  profile observed in the repro; the latter is guardrail-blocked in `signals-publish`.

## 3. Decisions (ADR-384)

### ADR-384-1 — Signals resolves and prepares the target *before* dispatch; the agent only attaches

**Decision.** `runTemplateViaRtx` performs a research-target preflight for Contact Web Research
runs, server-side, after the Signals health check and thread resolution and before the brief is
written. It calls the existing `preparePlatformTarget({ targetId, intent: "browse", holder, leaseTtlSeconds })`
and freezes the result into the brief and the run config. The agent never chooses a target, never
calls `list_platform_targets` to pick one, and never creates a browser session.

**Why.** The failure mode was "agent chose". Moving selection + verification into Signals makes the
choice deterministic, lets the route fail fast with a user-actionable error *before* a terminal
agent is spawned, and reuses the lease/verify code path that publish already trusts. The social
patrol precedent (agent-side prepare) is kept for patrol; it is not the right shape for a
one-click contact action that must fail before dispatch.

**Rejected.** (a) Agent-side prepare in the brief (patrol style): cannot produce a pre-dispatch UI
error, and leaves target choice to the model. (b) Dedicated `signals-research` connection: has no
logins; the whole point is reusing the profile that holds the LinkedIn session.

### ADR-384-2 — Deterministic target selection order

**Decision.** New module `src/lib/workflows/contact-web-research-target.ts`:

```ts
export const CONTACT_WEB_RESEARCH_TARGET_PLATFORM_ORDER = ["linkedin", "x"] as const;
export const CONTACT_WEB_RESEARCH_LEASE_TTL_SECONDS = 600;
export const CONTACT_WEB_RESEARCH_LEASE_HOLDER_PREFIX = "contact-web-research:"; // + workflowRunId

export type ContactWebResearchTargetSelection = {
  targetId: string;
  platform: "linkedin" | "x";
  source: "config" | "default";
};

export type ContactWebResearchTargetError = {
  code: "NO_RESEARCH_TARGET" | PlatformTargetErrorCode;
  message: string;            // user-facing, includes the Settings repair path
  details?: Record<string, unknown>;
};

export function selectContactWebResearchTarget(config: Record<string, unknown>):
  | { ok: true; selection: ContactWebResearchTargetSelection }
  | { ok: false; error: ContactWebResearchTargetError };
```

Resolution:

1. `config.targetId` (run override) or `config.contactWebResearch.targetId` (template config) if
   present → `resolveTargetById`; must be `status: "active"` and have the `browse` capability;
   otherwise return the matching `PlatformTargetError` code (`TARGET_NOT_FOUND`, `TARGET_FORGOTTEN`,
   `TARGET_CAPABILITY_UNSUPPORTED`). An explicit target is never silently replaced by a default.
2. Else iterate `CONTACT_WEB_RESEARCH_TARGET_PLATFORM_ORDER` and take the first
   `resolveDefaultTarget(platform)` whose view includes `browse`.
3. Else `NO_RESEARCH_TARGET`.

**Why.** LinkedIn is the primary evidence source (+100 in the SERP scorer), so it is preferred. The
X fallback keeps X-only installs working (the #383 repro recovered via X) while still guaranteeing
an authenticated, cookie-bearing profile for Google. The order is a constant, not a heuristic.

**Consequence to document.** With an X target, LinkedIn pages will still authwall; those pages are
classified as source failures (ADR-384-6), not evidence, so the run ends `partial` with a clear
message rather than `succeeded`.

### ADR-384-3 — Preflight contract inside `runTemplateViaRtx`

```ts
export type ContactWebResearchPreparedTarget = {
  targetId: string;
  platform: "linkedin" | "x";
  source: "config" | "default";
  sessionName: string;        // from prepare — never assume "signals-publish"
  expectedHandle: string | null;
  verifiedHandle: string | null;
  leaseId: string;
  leaseExpiresAt: number;     // epoch seconds
  preparedAt: number;
};

export async function prepareContactWebResearchTarget(
  input: { config: Record<string, unknown>; workflowRunId: string },
  env?: EnvLike, fetchImpl?: typeof fetch,
): Promise<{ ok: true; target: ContactWebResearchPreparedTarget } | { ok: false; error: ContactWebResearchTargetError }>;

export function releaseContactWebResearchTarget(leaseId: string): void; // swallows LEASE_LOST
export function getContactWebResearchTargetFromRunConfig(config: string | null | undefined): ContactWebResearchPreparedTarget | null;
```

Wiring in `runTemplateViaRtx` (only when `isContactWebResearchTemplateConfig(runtimeConfig)`):

- Call `prepareContactWebResearchTarget` after `getOrCreateTemplateThread` and before
  `buildAgentWorkflowBrief`. Holder is `contact-web-research:<run.id>`; TTL is
  `CONTACT_WEB_RESEARCH_LEASE_TTL_SECONDS` (600 s). `preparePlatformTarget` already releases its own
  lease on failure.
- On failure: `updateWorkflowRun(run.id, { status: "failed", completedAt, errors: [message], errorItems: 1, result: JSON.stringify({ message, partial: true, blocked: error.code }) })`,
  create a step `{ stepType: "error", tool: "platform_target_preflight", error }`, and return
  `{ success: false, errorCode: "research_target_unavailable", httpStatus: 409, error: message, workflowRunId }`.
  No brief is written and no terminal agent is dispatched.
- On success: persist `researchTarget` into the run config immediately (`updateWorkflowRun` with
  the merged config) so the lease is discoverable even if dispatch fails later; pass
  `researchTarget` into `buildAgentWorkflowBrief` → `buildContactWebResearchBriefSection`; include
  it in `buildStoredRunConfig` output.
- Any later failure in the same call (`briefWrite` error, `launch.success === false`, thrown
  error) must call `releaseContactWebResearchTarget(leaseId)` before returning. Implement with a
  single `let preparedLeaseId: string | null` and release in each existing failure branch plus the
  `catch`.

**Why 600 s and not 1800 s.** The research budget is ~90 s plus agent start-up and write-back. A
held lease blocks publishing on the same connection; 10 minutes bounds the damage of an agent that
dies without completing. The brief tells the agent how to renew (ADR-384-5) if it legitimately needs
longer.

### ADR-384-4 — Route and UI: actionable failure, no anonymous fallback

`POST /api/contacts/[id]/web-research`:

- `errorCode === "research_target_unavailable"` → HTTP **409**, body
  `{ error, code: "RESEARCH_TARGET_UNAVAILABLE", details: { reason, targetId?, sessionName?, platform?, settingsPath: "/dashboard/settings", settingsTab: "Platform connections", workflowRunId } }`.
- `error` copy is built once in `contact-web-research-target.ts` (`describeResearchTargetError`) so
  the route, run errors, and the run result message agree. Per reason:
  - `NO_RESEARCH_TARGET`: "No authenticated LinkedIn or X browser target is connected for contact research. Open Settings → Platform connections, connect LinkedIn in the RealTimeX Browser session, then retry."
  - `LOGIN_REQUIRED` / `TARGET_NOT_ACTIVE`: "The {platform} browser session is signed out or signed in as a different account ({detectedHandle}). Open Settings → Platform connections and verify {targetName}, then retry."
  - `CONNECTION_UNAVAILABLE`: "The RealTimeX Browser session {sessionName} could not be started. Check Settings → Platform connections, then retry."
  - `SESSION_LEASE_HELD`: "The {sessionName} browser session is in use by {holder}. Retry in {retryAfterSeconds}s."
  - `TARGET_FORGOTTEN` / `TARGET_NOT_FOUND` / `TARGET_CAPABILITY_UNSUPPORTED` (explicit `targetId` only): "The configured research target {targetId} is unavailable. Re-discover targets in Settings → Platform connections or clear `contactWebResearch.targetId`."
- `enrich-contact-button.tsx` already renders `body.error`; when `body.code === "RESEARCH_TARGET_UNAVAILABLE"`
  additionally render a link to `/dashboard/settings` labelled "Open Platform connections". No new
  state machine; `state.status` stays `failed` with the message (the failed preflight run stores the
  same message in `result.message`, so `GET …/web-research` polling shows it too).

`getContactWebResearchState` needs no change: a failed preflight run maps to `status: "failed"` and
`message` from `result.message`.

### ADR-384-5 — Brief contract: attach to the exact session, never a fresh profile

`buildContactWebResearchBriefSection` gains a required `researchTarget: ContactWebResearchPreparedTarget`
input and emits, **before** "Hop 0a":

```
### Authenticated browser session (required — do not research without it)
Target ID: <targetId> (<platform>, <source>)  Expected handle: <expectedHandle>  Verified handle: <verifiedHandle>
Session name: <sessionName>   Lease ID: <leaseId>   Lease expires: <ISO time> (renew below if needed)
B1. Discover the session port: realtimex-pp-cli list-browser-sessions --data-source live --no-cache --json → entry with sessionName "<sessionName>" → remoteDebugPort.
    If it is not running: realtimex-pp-cli start-browser-session <sessionName> --json (no --url). Never create-browser-session, never delete-browser-session, never use any other session name.
B2. Attach: agent-browser --session <sessionName> connect <remoteDebugPort>; then agent-browser --session <sessionName> tab and select the HTTPS content target (not the Electron shell).
B3. Navigate ONLY through agent-browser (open <url>) inside this session. Never open URLs through realtimex-pp-cli start-browser-session --url — the session allowlist blocks non-platform origins on that path.
B4. Every hop (Google search, refined search, profile visits, company pages) runs in this same session so its cookies and the <platform> login are retained.
B5. If B1–B2 fail, do not research in any other profile. Call complete_workflow_run with status "failed" and errors ["browser_session_unavailable: <detail>"].
B6. If the lease will expire before you finish, renew: prepare_platform_target { targetId: "<targetId>", intent: "browse", leaseId: "<leaseId>", holder: "contact-web-research:<runId>" }. Do not release the lease yourself; complete_workflow_run releases it.

### Auth-state failures (source failures, never evidence)
- LinkedIn /authwall, /login, /checkpoint/*, /uas/login; Google /sorry/* or any reCAPTCHA interstitial; X /i/flow/login or /login; accounts.google.com.
- Do not extract, score, or write anything from such a page. Record the URL in result.blockedUrls.
- On the <platform> platform itself an auth wall means the verified session was lost: call complete_workflow_run with status "failed" and errors ["auth_state_lost: <url>"].
- On any other platform record the block, continue with remaining candidates, and set partial=true.
```

Also change existing lines: "Open this in RealTimeX Browser" → "Open this in the attached
`<sessionName>` session via agent-browser"; execution requirement 9 in `template-brief.ts` stays
generic (research overrides it in its own section).

`CONTACT_WEB_RESEARCH_TOOLS` adds `get_platform_target`, `prepare_platform_target` (renew only) and
`release_platform_target` (abort-without-complete only). Tool hint order: keep research tools
first, session tools last.

Seeded `systemPrompt` (`seed-templates.ts`) is updated to the same rules (attach to the brief's
session; auth walls are failures; never create a profile). Bump `SEED_VERSION` 26 → 27 so existing
installs receive the prompt (the seed loop already rewrites `systemPrompt` when the stored version
is older).

### ADR-384-6 — Login/auth-wall/CAPTCHA pages cannot become evidence (server-enforced)

New `src/lib/contacts/web-research-page-state.ts`:

```ts
export type ResearchPageState = "content" | "authwall" | "login" | "captcha";
export function classifyResearchPageUrl(url: string): ResearchPageState;   // pure, URL-only
export function isBlockedResearchUrl(url: string): boolean;                 // state !== "content"
```

Patterns (host + path, case-insensitive): `linkedin.com/authwall`, `linkedin.com/login`,
`linkedin.com/uas/login`, `linkedin.com/checkpoint/`, `google.com/sorry/`, `recaptcha`,
`x.com|twitter.com` + `/i/flow/login` or `/login`, `accounts.google.com`, `facebook.com/login`,
`facebook.com/checkpoint/`.

Enforcement:

1. `handleUpsertContactIdentity`: if `platformUrl` or `websiteUrl` is a blocked URL → throw
   `AgentToolError("VALIDATION_ERROR", "…is a login/auth-wall URL, not a profile page")`. This is the
   regression guard the issue asks for ("/authwall or login pages cannot produce identity writes").
2. `handleCompleteWorkflowRun`, when the run is a Contact Web Research run
   (`isContactWebResearchTemplateConfig(parseObject(run.config))`): compute
   `blockedUrls = [...(result.blockedUrls ?? []), ...visitedUrls.filter(isBlockedResearchUrl)]`; if
   non-empty, persist `result.blockedUrls`, force `result.partial = true`, and append
   `source_blocked:<url>` entries to `errors`. `getContactWebResearchState` then reports `partial`.
   `visitedUrls` keeps the blocked entries (provenance) — the UI list already renders them.
3. `completeWorkflowRunSchema.result` gains optional `blockedUrls: z.array(z.string().url()).max(20)`;
   `ContactWebResearchState` gains `blockedUrls: string[]`.

The cascade rule is unchanged: `resolveContactWebResearchCascadeTarget` still requires
`identityLinked === true`, which after (1) can only be set by a real profile URL write.

### ADR-384-7 — Lease release is owned by Signals, on every terminal path

- `handleCompleteWorkflowRun`: after the existing `Promise.all`, read
  `getContactWebResearchTargetFromRunConfig(run.config)`; if present, `releaseContactWebResearchTarget(leaseId)`
  (LEASE_LOST swallowed — expiry or manual release is fine) and report
  `leaseRelease: { leaseId, released: boolean }` in the tool response. Runs on both `completed` and
  `failed`.
- `runTemplateViaRtx` failure branches release (ADR-384-3).
- Existing teardown (`stopRunningRtxBrowserSessions({ stopAllRunning: true })` + scheduled terminal
  release) is untouched. Stopping `signals-publish` does not lose logins (persistent profile); the
  next prepare restarts it.
- Manual `release_platform_target` by the agent is only for aborting without
  `complete_workflow_run`; the brief says so.

### ADR-384-8 — LinkedIn adapter reports logged-out instead of "switching unsupported"

`linkedin.ts` `activate()`: `if (!verification.loggedIn) return { ...verification, switched: false };`
before the `TARGET_ACTIVATION_UNSUPPORTED` throw, so `preparePlatformTarget` raises `LOGIN_REQUIRED`
for a signed-out session and reserves `TARGET_ACTIVATION_UNSUPPORTED` for "logged in as someone
else". No change to the X or Facebook adapters. This also fixes the Settings "Verify" copy for
LinkedIn.

### ADR-384-9 — Thread name: `Contact Enrich Profile`, converged in place on every run

- `src/lib/workflows/contact-web-research.ts`: `export const CONTACT_WEB_RESEARCH_THREAD_NAME = "Contact Enrich Profile";`
- `src/lib/workflows/template-brief.ts`: add
  `resolveTemplateThreadName(template: Pick<WorkflowTemplate, "name" | "config">): string` →
  `CONTACT_WEB_RESEARCH_THREAD_NAME` when `isContactWebResearchTemplateConfig(parseTemplateConfig(template.config))`,
  else `buildTemplateThreadName(template.name)`. `runTemplateViaRtx` (and any other
  `buildTemplateThreadName(template.name)` caller — grep `buildTemplateThreadName(`) switches to it.
  The seeded template **name stays `Contact Web Research`** (route lookup, state lookup, seed
  matching, run `templateName`, and the "Run #N — …" routing message all keep the technical name).
- `src/lib/rtx/cli-provisioning.ts`: add `getRtxThread(workspaceSlug, threadSlug)` →
  `{ presence: "exists" | "missing" | "unknown"; name: string | null }` (same endpoint as
  `getRtxThreadPresence`, which becomes a thin wrapper) and `renameRtxThread(workspaceSlug, threadSlug, name)`
  → `POST /cli/rename-thread/:ws/:thread` `{ name }` via `rtxCliRequestOk`.
- `src/lib/rtx/template-thread.ts`: on the `reused` path, if `presence === "exists"` and
  `name !== input.threadName`, call `renameRtxThread`; a rename failure is logged into the result as
  `{ renamed: false, renameError }` and never blocks dispatch. Result type gains
  `threadName: string; renamed: boolean; renameError?: string`. `runTemplateViaRtx` records
  `threadResolution` + `renamed` in the existing `rtx_terminal_agent` step output.
- Migration semantics: **no DB migration**. The binding (`rtx_thread_slug`) is kept; only the RTX
  thread's display name converges. Signals owns template threads, so a manually renamed thread is
  reverted on the next run (documented). The one-off path keeps `"<name> — one-off"`.

**Rejected.** Renaming the seeded template to "Contact Enrich Profile" (PLATFORM_NATIVE_WRITING
precedent): the issue keeps the internal name, and renaming would ripple into `getSystemTemplateByName`
callers, `templateName` in stored run configs, and thread routing messages.

### ADR-384-10 — Google origin is *not* added to the `signals-publish` allowlist

The allowlist is blast-radius control for a session holding live logins; CDP navigation (the
`agent-browser` path, and the path Signals' own verification uses) bypasses it by design
(`docs/rtx-browser-publish.md`). The brief therefore mandates CDP navigation (B3) instead of widening
the allowlist. Revisit only if RTX starts enforcing guardrails on CDP.

## 4. File-level change list

| File | Change |
|---|---|
| `src/lib/workflows/contact-web-research-target.ts` (new) | ADR-384-2/3 selection, prepare, release, run-config reader, `describeResearchTargetError`. |
| `src/lib/contacts/web-research-page-state.ts` (new) | ADR-384-6 URL classifier. |
| `src/lib/workflows/contact-web-research.ts` | `CONTACT_WEB_RESEARCH_THREAD_NAME`; tools list + brief section (ADR-384-5); `ContactWebResearchBriefContext` gains `researchTarget`. |
| `src/lib/workflows/template-brief.ts` | `resolveTemplateThreadName`; pass `researchTarget` through. |
| `src/lib/agents/run-template-via-rtx.ts` | Preflight + lease lifecycle + `researchTarget` in stored config + `research_target_unavailable` result. Use `resolveTemplateThreadName`. |
| `src/lib/rtx/cli-provisioning.ts` | `getRtxThread`, `renameRtxThread`. |
| `src/lib/rtx/template-thread.ts` | Rename-on-reuse (ADR-384-9). |
| `src/lib/platforms/target-adapters/linkedin.ts` | ADR-384-8. |
| `src/lib/agent-tools/handlers.ts` | Identity URL guard; complete_workflow_run lease release + blocked-URL classification. |
| `src/lib/agent-tools/schemas.ts` | `result.blockedUrls`. |
| `src/lib/contacts/web-research-state.ts` | `blockedUrls`. |
| `src/app/api/contacts/[id]/web-research/route.ts` | 409 `RESEARCH_TARGET_UNAVAILABLE` mapping with details. |
| `src/app/dashboard/contacts/[id]/enrich-contact-button.tsx` | Settings link on that code. |
| `src/lib/db/seed-templates.ts` | Prompt update, `SEED_VERSION = 27`. |
| `openapi/agent-tools.json`, `docs/agent-tools.md` | `blockedUrls`, `leaseRelease` in complete_workflow_run response; research-lane note. |
| `docs/rtx-agent-browser-enrichment.md` | Thread name, which Platform connection is used (default LinkedIn browse target → X), repair steps, failure classification. |
| `specs/contact-web-research-enrichment.md` | Link to this spec; note thread name ≠ template name. |
| `docs/qa/contact-enrich-profile-authenticated-target.md` (new) | Embedded Dev QA scenario (§6). |

## 5. Test plan (focused; all Vitest, DB-backed via `resetCoreTables`)

1. `contact-web-research-target.test.ts` — explicit `targetId` wins; LinkedIn default preferred over
   X; X fallback when no LinkedIn target; `NO_RESEARCH_TARGET` when none; forgotten / no-`browse`
   explicit target → matching code; `describeResearchTargetError` mentions "Platform connections".
   `prepareContactWebResearchTarget` with `preparePlatformTarget` mocked (`vi.mock("@/lib/platforms/platform-target-service")`)
   maps a `PlatformTargetError` to `{ ok: false }` and a success to the frozen shape.
2. `run-template-via-rtx.test.ts` (extend) — research template: (a) success → brief file contains
   `Session name: signals-publish`, `Lease ID:`, `Target ID:`; run config has `researchTarget`;
   (b) prepare failure → no brief written, no dispatch fetch, run `failed`, step
   `platform_target_preflight`, `errorCode: "research_target_unavailable"`, `httpStatus: 409`;
   (c) dispatch failure after prepare → `releaseSessionLease` called with the lease.
3. `contact-web-research.test.ts` (extend) — brief section includes B1–B6, the auth-state block,
   and no longer contains the bare "Open this in RealTimeX Browser".
4. `template-brief` tests — `resolveTemplateThreadName` → "Contact Enrich Profile" for research
   config, unchanged for others.
5. `template-thread.test.ts` (new) — reused + stale name → `POST /cli/rename-thread` with
   `{ name: "Contact Enrich Profile" }`; reused + same name → no rename call; rename 500 → dispatch
   proceeds, `renamed: false`; slug unchanged in all cases (binding preserved).
6. `route.test.ts` (extend) — mocked `research_target_unavailable` → 409, `code: RESEARCH_TARGET_UNAVAILABLE`,
   `details.settingsPath`.
7. `handlers` tests — `upsert_contact_identity` rejects `https://www.linkedin.com/authwall?…` and
   `…/login` as `platformUrl` (regression); accepts `/in/…`. `complete_workflow_run` on a research
   run: releases the recorded lease (real lease row → gone), tolerates an already-expired lease,
   classifies `visitedUrls` with `/authwall` → `partial: true` + `blockedUrls` + `source_blocked:` error;
   `getContactWebResearchState` reports `partial`.
8. `web-research-page-state.test.ts` — classifier table.
9. `target-adapters.test.ts` (extend) — LinkedIn logged-out → `loggedIn: false`, no throw; service
   then raises `LOGIN_REQUIRED`.
10. `seed-templates.test.ts` — `_seedVersion: 27`; prompt contains "Session name" / "authwall".

## 6. Embedded Dev QA scenario (manual, RealTimeX Dev app)

Record in `docs/qa/contact-enrich-profile-authenticated-target.md` with the evidence below.

Preconditions: Signals as Local App; Settings → Platform connections shows a LinkedIn profile
target on `signals-publish` with **Verify** succeeding; an install that still has the old
**Contact Web Research** thread (note its slug: `SELECT rtx_thread_slug FROM workflow_templates WHERE name='Contact Web Research'`).

1. Contact detail → **Enrich profile** on a sparse contact → 202.
   - Proof A (thread): sidebar shows **Contact Enrich Profile**; `rtx_thread_slug` is unchanged;
     `realtimex-pp-cli list-threads signals --json` has exactly one research thread (no parallel
     "Contact Web Research"/"(2)").
   - Proof B (binding): the brief file `workflow-runs/<runId>/…` contains `Session name: signals-publish`
     and the `Lease ID`; `GET /api/platform-targets` shows `connections[].lease.held === true` with
     `holder: contact-web-research:<runId>` while the run is pending.
   - Proof C (authenticated): `realtimex-pp-cli list-browser-sessions --data-source live --json`
     lists only `signals-publish` running (no new session); a screenshot of the LinkedIn tab shows
     the logged-in nav (`.global-nav__me`); `GET /api/contacts/:id/web-research` → `visitedUrls`
     contain `linkedin.com/in/…` and `blockedUrls` is empty; status `succeeded` or `partial`, never
     `failed` for auth reasons.
   - Proof D (release): after completion `lease.held === false`; the run config contains
     `researchTarget.leaseId`; complete_workflow_run response has `leaseRelease.released: true`.
2. Negative — Settings → Forget the LinkedIn target (and no X target) → **Enrich profile** → 409
   `RESEARCH_TARGET_UNAVAILABLE`, message names Settings → Platform connections, link renders; no
   thread message posted, no browser session created, no lease row.
3. Negative — sign out of LinkedIn in `signals-publish` → **Enrich profile** → 409 with the
   `LOGIN_REQUIRED` copy (not "account switching").
4. Regression — invoke `upsert_contact_identity` with `platformUrl: https://www.linkedin.com/authwall?…`
   → `VALIDATION_ERROR`.

## 7. Risks and rollout notes

- **Server-side CDP from Next.js.** `preparePlatformTarget` opens the platform tab with Playwright
  over CDP from the Signals process — the same path Settings verify/discover and publish already
  use; it is gated by `isRtxEmbedded`. The user will see the LinkedIn tab focus briefly.
- **Lease contention.** While a research run holds the lease (≤600 s), publish/patrol on the same
  connection get `SESSION_LEASE_HELD` — existing, intended serialization (I1 in
  `platform-targets.md`).
- **`stopAllRunning` teardown** stops `signals-publish` at completion (pre-existing behavior for
  all workflows). Logins persist in the profile; nothing new here, but note it in QA if the
  next run's prepare takes a few seconds longer.
- **Thread rename convergence** reverts manual renames of the Signals-owned research thread.
- **Seed bump** rewrites the research template's `systemPrompt` on existing installs (intended).
- **CLI surface.** The brief uses agent-tools REST (`POST /api/agent-tools/invoke`) via
  `run-signals-pp-cli.sh`/curl for `prepare_platform_target`; do not depend on a
  `signals-pp-cli targets …` subcommand unless the pinned CLI version is verified to expose it.
- **Not in scope:** email discovery (#385); widening the publish allowlist (ADR-384-10); any
  change to the SERP scorer or hop budgets.
