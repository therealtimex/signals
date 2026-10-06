# Signals Dev: one Local App per worktree on the RealTimeX Dev host (#541)

Status: **approved for implementation** (System Design, 2026-10-06, loop `loop-issue-541-f90967d6`).
Spec: [#541](https://github.com/therealtimex/signals/issues/541). Decisions are numbered
ADR-541-1 … ADR-541-14; Review and QA should challenge those, not re-derive them.

Owner decisions (2026-10-06) that this design implements without reopening:

1. One Signals Dev app per worktree, not one shared app.
2. Host = RealTimeX Dev (`yarn dev:all` from the main `realtimex-ai-app` checkout). Agents stop
   creating apps, workspaces and threads in the installed app.
3. The `realtimex-signals` skill talks to the canonical Signals on the installed app and reaches a
   Dev app only through an explicit `SIGNALS_BASE_URL`.

## 1. Facts about the current system (verified 2026-10-06, read-only)

| Fact | Evidence |
|---|---|
| The Dev host is running (`127.0.0.1:3101`, `ready: true`); the installed app runs at `3001`; the canonical Signals answers at `3010` as app `47e45f71…` in embedded mode, build 0.2.20 from `marketplace-deploy/`. | `/api/ping`, `/api/health` probes |
| Dev profile `local_apps` row `47e45f71-3279-42f5-8e95-731de01b6eae` ("Signals"): `working_dir=/Users/realtimex/github/signals`, `npm run dev`, `PORT=3010`, `SIGNALS_DATA_DIR=~/.signals`, `REALTIMEX_BASE_URL=http://127.0.0.1:3101/cli`, all 8 permissions granted, status stopped. | `sqlite3 -readonly` on the dev `realtimex.db` |
| `<dev storage>/local-apps/47e45f71-…` is a **symlink to the main checkout**. A recursive storage cleanup keyed on that id would follow nothing (Node `rmSync` unlinks a symlink), but it is a landmine and must be unlinked, never recursed. | `ls -la` |
| Five stale QA rows exist: `Signals issue-{159,184,214,335,384} QA`. All five worktrees are gone. 159/184/214/335 run `npm run dev` straight from the dead worktree path; 384 runs the launcher copy under `<dev storage>/local-apps/61059a31…` with `SIGNALS_QA_WORKTREE`. Only 384 carries the full safety tag set; 159 has no tags at all. | dev DB, `git worktree list` |
| Scoped CLI keys in the Dev profile: three, all expired (last `expiresAt` 2026-09-04), scopes `cli:prepare, local-apps:{list,create,start,status,stop,delete}`. | `api_keys` table (no secrets read) |
| **`update-local-app` has no scope entry.** `ROUTE_SCOPES` in `server/utils/apiKeys/cliCredentialScopes.js` lists only list/create/start/status/stop/delete; a scoped key gets `allowed=false` for every other CLI route (`update-local-app`, `get-local-app`, `get-local-app-logs`, `restart`, `set-local-app-enabled`). `update-local-app` can anyway only change `displayName`, `description`, `homeUrl`, `env`, never port, tags or `working_dir`. | realtimex-ai-app `server/endpoints/cli/localApps.js:302-321`, `cliCredentialScopes.js` |
| `list-local-apps` returns a compact view: tags, status, runtime, env **keys** only, no env values, no `working_dir`. The launcher already reads the Dev DB read-only for permissions; it must do the same for env values. | `compactLocalApp` |
| Port: the desktop derives the port from `args` → `config.port` → `env.PORT` → `home_url`, else **8080**, and injects it as `RTX_PORT`. `npm run dev` runs `next dev -p ${RTX_PORT:-${PORT:-3000}}`, and Next bumps to the next free port when the requested one is busy. Today's QA apps therefore all ask for 8080 and land wherever Next finds room. | `LocalAppsManager.cjs:145-162`, `_extractPortFromConfig`, `package.json` |
| `/api/health` reports `app`, `rtx.mode` (`embedded`/`standalone`), `rtx.appId`, `rtx.registered`, `rtx.pingOk`. Nothing says whether an instance is a Dev app. | `src/app/api/health/route.ts` |
| `resolve-base-url.sh` accepts any `/api/health` with `app: signals`, probing `RTX_PORT`/`PORT`, then 3010, then 3000. | `.claude/skills/realtimex-signals/scripts/resolve-base-url.sh` |
| Scheduler: on unless `SIGNALS_SCHEDULER_ENABLED` is `0`/`false`; runs overdue jobs at boot. `SIGNALS_RTX_PUBLISH_TEST` only shortens publish polling. No publish guard exists. | `src/lib/scheduler/runner.ts:116-135`, `src/lib/publish/constants.ts` |
| Platform OAuth credentials are AES-encrypted with a key derived from `hostname + username`, i.e. **a copy of `data.db` on this machine decrypts the owner's real X/LinkedIn/Gmail tokens**. | `src/lib/auth/crypto.ts` |
| `~/.signals`: `data.db` 113 MB (WAL), `media/` 60 MB, `browser-profiles/` 18 MB (signed-in Playwright profiles), `sessions/`, `personality/`, `writing/`, `config.json` (mail alias, persona mode, SMTP probe flag), old `bk_db/`, `worker-*`. `~/.signals-dev` does not exist. | `ls`, `du` |
| Dev-host and installed-app browser sessions live in different profiles (`desktop-user-data/dev` vs `/app`); the Dev DB has no browser session table rows named `signals-publish`. | storage listing, dev DB |

## 2. Target shape

```
Installed RealTimeX (3001)            RealTimeX Dev (3101, yarn dev:all)
  └─ canonical Signals :3010            ├─ Signals Dev · main        ~/.signals-dev/main        port P1
     SIGNALS_DATA_DIR=~/.signals        ├─ Signals Dev · <worktree>  ~/.signals-dev/<slot>      port P2
     (never touched by this design)     └─ …one row per worktree, each SIGNALS_INSTANCE=dev,
                                           SIGNALS_SCHEDULER_ENABLED=0, own workspace slug
realtimex-signals skill ──explicit SIGNALS_BASE_URL only──▶ Dev app
                        ──fallback probe (embedded, not dev)──▶ canonical
```

Actors: the owner (grants permissions, mints the one never-expiring scoped key, approves the
slice-1 row change through Delegate), loop agents (run `up`/`status`/`down`/`remove`/`prune`
from a worktree), RealTimeX Dev (hosts the apps, enforces its permission dialog), Signals (refuses
external effects when it is a Dev instance).

## 3. Decisions

### ADR-541-1 Generalize `scripts/qa/qa-local-app.mjs`; retire the per-issue, packaged-host mode

**Decision.** One mechanism. `scripts/qa/qa-local-app.mjs` keeps its path and its `up` / `status`
/ `down` verbs (AGENTS.md and older branches call it by absolute path from the main checkout) and
gains `remove` and `prune`. The app is keyed by the **worktree realpath**; `--issue` becomes an
optional label. The launcher manages **only the Dev host**: `--host` is removed, the base URL is
`http://127.0.0.1:3101/cli`, and any attempt to point it at `3001` fails with
`HOST_PACKAGED_FORBIDDEN`. The installed app's database is read **read-only** for the
no-pollution check (ADR-541-9) and nothing else.

**Why.** Receipts, locks, canonical snapshot/diff, health wait, permission reporting and the
mock-CLI test harness already exist and are proven on the Dev host (issue-384). Owner decision 2
removes the packaged-host use case; keeping it would keep the hazard alive.

**Trade-off.** Branches cut before this change cannot be driven by the new launcher from their own
checkout; they use the main checkout's copy (already the documented convention).

### ADR-541-2 Slot identity: worktree-derived, stable, unique on the host

**Decision.**

- `slot` = `main` for the primary checkout (`git rev-parse --git-dir` equals `--git-common-dir`),
  otherwise the worktree directory basename lowercased and reduced to `[a-z0-9-]`
  (`loop-issue-541-f90967d6`). If that slot already belongs to a different worktree realpath
  (receipt mismatch), append `-<first 6 hex of sha256(realpath)>`.
- Display name `Signals Dev · <slot>`; RealTimeX derives `name` (`signals-dev-<slot>`), both unique
  on the host. Creation with a taken display name fails with `NAME_TAKEN` (next: `prune`).
- Tags (immutable facts, set at create): `signals`, `dev`, `slot-<slot>`,
  `worktree-<first 8 hex of sha256(realpath)>`, plus `issue-<N>` and `loop-<id>` when given.
- Branch and issue are recorded in the receipt and refreshed on every `up`; they are **not** part
  of the name. Detached HEAD records `branch: null`.

**Why.** The issue proposed `Signals Dev · <branch>`. A branch can be renamed or re-pointed under
a running app, and `update-local-app` is not available to a scoped key, so a branch-named row would
drift from reality. The worktree basename is stable for the life of the slot and, for loop
worktrees, already carries the issue number.

**Trade-off.** The Settings → Local Apps list shows the worktree name, not the branch; `status`
prints both.

### ADR-541-3 Port: deterministic candidate, pinned in `env.PORT` and `home_url`

**Decision.** `up` picks `3300 + (sha256(realpath) mod 200)` and walks forward (wrapping inside
3300–3499) to the first port that (a) is not pinned by any other `local_apps` row on the Dev host
(`env.PORT` or `home_url`, read from the Dev DB), (b) is not listening now, and (c) is not in the
reserved set `{3000, 3001, 3010, 3011, 3081, 3100, 3101, 4002, 8001, 8080, 9888}`. The port is
written into the new row as `env.PORT=<n>` and `home_url=http://localhost:<n>/dashboard`, which
makes RealTimeX inject `RTX_PORT=<n>` and detect the running port immediately. The receipt records
it. `up` on an existing slot reuses the row's port and fails with `PORT_MISMATCH` (naming the port
Next actually bound, from `.next/dev/lock`) if the pinned port was busy at start.

**Why.** Without a pin every Dev app asks for 8080 and Next scatters them; health waits and the
skill's `SIGNALS_BASE_URL` need a known port. Never 3000 (a bare `npm run dev`), never 3010 (the
canonical app).

### ADR-541-4 Data: `~/.signals-dev/<slot>`, two profiles, no secrets in a snapshot

**Decision.** `SIGNALS_DATA_DIR` is the absolute path `$HOME/.signals-dev/<slot>` (never `~`
literal, never under `/private/tmp`).

- `--profile empty` (default): the launcher creates the directory and nothing else; Signals migrates
  on boot (`src/lib/db/client.ts`). An existing directory is reused as is.
- `--profile snapshot`: refused with `SLOT_DATA_EXISTS` when `<slot>/data.db` exists (next:
  `remove`). Otherwise:
  1. `sqlite3 -readonly "$HOME/.signals/data.db" ".backup '<slot>/data.db'"` (SQLite online
     backup, consistent under WAL; no `-wal`/`-shm` copying). The launcher already requires the
     `sqlite3` CLI, so no better-sqlite3 ABI coupling is introduced.
  2. Copy `media/` recursively.
  3. Copy **nothing else**: not `browser-profiles/` (signed-in sessions), not `sessions/`, not
     `config.json`, not `personality/` or `writing/` (bound to the installed app's workspace
     transactions), not `bk_db/`, `worker-*`, or old `data-before-*.db` files.
  4. Scrub the copy: `UPDATE platform_accounts SET credentials_encrypted = NULL, status =
     'needs_reauth'`. Tokens would otherwise decrypt on this machine (§1).
  5. `scheduled_jobs`, `publish_jobs`, `workflow_runs` are left intact; the scheduler pin
     (ADR-541-5) is the control that keeps them inert, and the acceptance test depends on them
     being present.
- `~/.signals` is opened read-only and never written. The launcher refuses any `SIGNALS_DATA_DIR`
  that resolves to `$HOME/.signals` and any `SIGNALS_DEV_ROOT` inside it.
- Layout: `~/.signals-dev/<slot>/` (data), `<slot>/.launcher/receipt.json` and `session.json`
  (0600), `~/.signals-dev/.locks/<slot>.lock`, `~/.signals-dev/.launcher/host.json` (base URL,
  `--cli` wrapper path, Dev DB path recorded by the first successful command; explicit flags win),
  `~/.signals-dev/_backups/` (slice 1). Tests override the roots with `SIGNALS_DEV_ROOT` and
  `SIGNALS_CANONICAL_DATA_DIR`; both are documented as test-only.

**Why.** `/private/tmp` dies on reboot; per-slot data survives rework rounds, which is what makes
grants and fixtures persist. The scrub turns "the guard refuses" into "there is nothing to use".

### ADR-541-5 Side-effect lock: `SIGNALS_INSTANCE=dev` gates effects inside Signals; the launcher verifies it

**Decision.**

Env pinned by the launcher on every Dev app (the agent never chooses them):

| Variable | Value |
|---|---|
| `SIGNALS_INSTANCE` | `dev` |
| `SIGNALS_SCHEDULER_ENABLED` | `0` |
| `SIGNALS_DATA_DIR` | `/Users/<user>/.signals-dev/<slot>` |
| `SIGNALS_RTX_WORKSPACE_SLUG` | `signals-dev-<slot>` |
| `SIGNALS_DEV_WORKTREE` | worktree realpath (read by the launcher shim) |
| `PORT` | allocated port (ADR-541-3) |
| `HOSTNAME` | `127.0.0.1` |
| `REALTIMEX_BASE_URL` | `http://127.0.0.1:3101/cli` |
| `PATH` | agent's Node bin dir prepended, as today |

Signals side, new module `src/lib/instance/`:

- `instance.ts`: `getInstanceKind(env)` → `"dev"` iff `SIGNALS_INSTANCE === "dev"`, else
  `"canonical"`; `externalEffectsDenied(env)` → `getInstanceKind(env) === "dev"`. There is no
  override variable: a dev instance can never allow external effects. Fail-safe is enforced on
  both sides (boot check below, launcher verification below).
- `guard.ts`: `assertExternalEffectAllowed(effect, env?)` throws `ExternalEffectDeniedError`
  (`code: "DEV_INSTANCE_GUARD"`, `effect`); `externalEffectDeniedResponse(error)` returns HTTP 403
  `{ success: false, code: "DEV_INSTANCE_GUARD", effect, error }`. Agent-tool invocations map the
  error to the same code through `agentToolErrorStatus`.
- Boot check: `src/lib/db/client.ts` calls `assertInstanceDataDir()` before opening SQLite; a dev
  instance whose resolved data dir equals `$HOME/.signals` throws, so the server never starts
  against the real database.

Chokepoints (the guard is the first statement of each; one unit test per chokepoint):

| Effect | Where | Covers |
|---|---|---|
| `publish.dispatch` | `sendContentToAgent` (`src/lib/publish/send-to-agent.ts`) before any row is written | `/api/content/send-to-agent`, writing skill "publish it", publish-job relaunch |
| `publish.x-api` | `postTweet`, `postThread`, `uploadMedia` in `src/lib/platforms/x/client.ts` | `/api/platforms/x/compose`, legacy in-process tools |
| `engage.x-api` | `likeTweet`, `unlikeTweet`, `retweet`, `unretweet`, `replyToTweet` | `/api/platforms/x/engage`, `engage-post` tool |
| `publish.browser` | `setupSession`/`loadSession` in `src/lib/browser/session.ts`; `publishToX`, `publishToLinkedIn` | Playwright publishers, legacy `publish-content` tool |
| `browser-session.publish` | `createRtxBrowserSession`, `startRtxBrowserSession`, `stopRtxBrowserSession` **when `sessionName === RTX_PUBLISH_SESSION_NAME`**, and `openRtxPlatformTab` | Settings "Connect X/LinkedIn/Facebook", `prepare_platform_target`, target discover/verify/register-current. `signals-x-anon` and other names stay allowed. |
| `oauth.connect` | route handlers `src/app/api/platforms/{x,linkedin,gmail}/{auth,callback}/route.ts` | connecting a real account |
| `email.smtp-probe` | the connector in `src/lib/contacts/email-verification/smtp-probe.ts` | email-candidate verification (an outbound SMTP "connect") |

Not guarded, on purpose: terminal-agent dispatch for workflows, persona generation, enrichment,
research and snowball, RTX workspace/thread creation, host LLM calls, webhook egress. Those stay on
the Dev host, inside the app's own workspace, and are governed by the permissions the owner grants
to that app row (`desktop.runtime-sessions`, `desktop.browser`). The guard is Signals' own
contribution and complements the host permission model; it does not replace it.

Health contract (`/api/health`, additive):

```json
"instance": {
  "kind": "dev" | "canonical",
  "externalEffects": "denied" | "allowed",
  "scheduler": "disabled" | "enabled",
  "dataDir": "/Users/.../.signals-dev/<slot>"
}
```

Launcher verification: after health returns 200, `up` requires `instance.kind === "dev"`,
`externalEffects === "denied"`, `scheduler === "disabled"` and `dataDir` equal to the slot path.
Otherwise it stops the app and fails with `INSTANCE_UNGUARDED`. A worktree whose build predates
this change has no `instance` field and therefore cannot run as a Dev app until it merges `main`.

**Why.** A single flag, read in one module, enforced where the effect happens, reported by the app
itself and checked by the launcher is the smallest design in which a missing variable, a stale
branch, or an agent-supplied env cannot silently produce a live instance.

**Trade-off.** In-flight branches must merge `main` before using the Dev host. Settings →
Platform connections is non-functional in Dev apps by design.

### ADR-541-6 Slice 1: the Dev `Signals` row is deleted and replaced, not edited in place

**Decision.** The only Dev-host path a scoped key can take is `delete-local-app` +
`create-local-app` (§1: `update-local-app` is unscoped and cannot change port, tags or working
dir). The legacy canonical id `47e45f71…` therefore disappears from the Dev host, which is also
what #541 asks for ("the id is per install"). One-shot script
`scripts/qa/migrate-dev-signals-row.mjs`, run by Dev **after** the Delegate judgment and only
with the owner's scoped key:

Preconditions (any failure aborts before any write): base URL is `127.0.0.1:3101`; the Dev DB is
`<desktop-user-data>/dev/users/<user>/storage/realtimex.db`; the row `47e45f71…` exists, has
`display_name = Signals`, `SIGNALS_DATA_DIR` resolving to `~/.signals`, and runtime status
`stopped` (a running row aborts with `ROW_RUNNING`; the script never stops it). If the row is
already gone and `Signals Dev · main` exists, the script reports `already migrated` and exits 0.

Steps, in order:

1. **Backup A (row, full fidelity):** `sqlite3 -readonly -json <dev db> "select * from local_apps
   where id = '47e45f71…'"` → `~/.signals-dev/_backups/<ts>-dev-signals-row.json` (0600).
2. **Backup B (database):** `sqlite3 -readonly <dev db> ".backup '~/.signals-dev/_backups/<ts>-
   realtimex-dev.db'"`.
3. `delete-local-app 47e45f71… --confirm-destructive true` (scoped). The CLI force-stops a
   stopped app (no-op) and skips storage cleanup because `working_dir` is not under
   `storage/local-apps/`.
4. Unlink `<dev storage>/local-apps/47e45f71-…` **only if** `lstat` reports a symlink and
   `readlink` equals the main checkout path; `fs.unlinkSync`, never `rmSync`. Anything else is
   reported and left alone.
5. Provision `Signals Dev · main` for `/Users/realtimex/github/signals` through the ordinary
   provisioner with `--no-start` (ADR-541-2/3/4/5 apply: slot `main`, port from 3300–3499,
   `~/.signals-dev/main`, `--profile empty`, full env pins, receipt written).
6. Verify from `list-local-apps` and the Dev DB (read-only): old id absent, new row present with
   the tags, env and port recorded in the receipt; Dev-host invariant (ADR-541-7) holds. Print one
   JSON result with both backup paths.

Restore (owner's call, documented in the script header and in the Delegate proposal):

- Row only, Dev host running: `REALTIMEX_RUNTIME=dev node scripts/qa/provision-signals-local-app.mjs
  --restore-canonical --db <dev db>` recreates the pre-#541 row exactly (id, `~/.signals`, 3010,
  all grants). This script is **kept for that purpose only**; its header is updated to say so and
  `down` no longer recommends it.
- Whole database: stop the Dev host, replace `realtimex.db` (and remove `-wal`/`-shm`) with Backup
  B, restart. Owner action.

After-state of the Dev host, exactly: no row with id `47e45f71…`; one row `Signals Dev · main`
(`signals-dev-main`), tags `signals, dev, slot-main, worktree-<hash8>`, command = the launcher copy
under `<dev storage>/local-apps/<new id>`, env per ADR-541-5 with
`SIGNALS_DATA_DIR=/Users/realtimex/.signals-dev/main`, `PORT=<p>` in 3300–3499, `home_url` on the
same port, `metadata.permissions` empty (the owner answers the dialog once on the first `up`).

Delegate proposal bounds Dev must state verbatim: host (`Dev`, base URL, DB path), row id,
before (Backup A hash), the six steps, the restore commands, and the negatives: never the
`/app` profile or `3001`, never `start-local-app` on the old row, never `rm -rf` on the storage
entry, no hand SQL writes.

**Why not update in place.** Not possible with the owner's scoped key, and even an unscoped update
could not change the port or the tags. The grants on the old row (8 permissions) are the only thing
lost; the owner re-grants once, in the morning, when the dialog appears for `Signals Dev · main`.

**Alternative noted for the owner.** Editing the row in the Dev app's Settings → Local Apps UI
keeps the id and the grants. It is a manual owner action and leaves the id collision in place, so
it is not the default.

### ADR-541-7 Hygiene is host-specific: a Dev-host invariant and an installed-app no-touch rule

**Decision.** `verify-signals-local-app-hygiene.mjs` keeps its name and gains two modes used by
`up` (preflight), `down`, `remove` and `prune`:

- **Dev host invariant** (`--dev-db`): no `local_apps` row has `SIGNALS_DATA_DIR` equal to
  `~/.signals` or resolving to `$HOME/.signals`, and no row pins port `3010` (`env.PORT`,
  `home_url`, `args`). Violation → `DEV_HOST_UNSAFE`, naming the row; the launcher never
  auto-fixes it. Until slice 1 runs, this fails on the Dev host **by design**: Dev becomes safe
  first.
- **Installed app untouched** (`--packaged-db`, read-only): `up` snapshots the installed DB's
  `local_apps` rows (id, display name, sha256 of config) into the slot session; `down`/`remove`
  diff them (`PACKAGED_HOST_CHANGED`) and still assert the canonical row's shape with the existing
  `canonicalConfigProblems` (`CANONICAL_CHANGED`). Workspaces on the installed app whose slug starts
  with `signals` and did not exist at `up` are reported as a warning, not a failure (the owner may
  create them during the day).

**Why.** The old gate assumed one canonical row per host. After slice 1 the Dev host has none, and
its invariant is the inverse: nothing there may ever point at the real data.

### ADR-541-8 Commands, flags and exit contract

Every command prints one JSON object and exits 0 only when `ok: true`; failures carry `errorCode`
and `next`. One `up`/`down`/`remove` per slot at a time (`SLOT_LOCKED`); `prune` takes every slot
lock it touches.

```
up     [--worktree <path>] [--profile empty|snapshot] [--needs a,b] [--issue N] [--loop-id id]
       [--cli <wrapper>] [--db <dev realtimex.db>] [--timeout-ms N]
status [--worktree <path>]
down   [--worktree <path>]
remove [--worktree <path>] [--keep-data]
prune  [--apply] [--legacy-qa]
```

- `up`: preflight (Dev host answers `3101` else `HOST_UNREACHABLE` — it never runs `yarn dev:all`;
  management accepted else `LOCAL_APP_MANAGEMENT_REFUSED` with the key instructions; worktree is a
  Signals checkout, primary or linked; Dev-host invariant; no live `.next/dev/lock`) → slot lock →
  installed-app snapshot → find the row by receipt + `slot-<slot>` tag (reuse) or create it →
  prepare data (profile) → start → wait for health on the pinned port → verify `instance` →
  permissions (`--needs` waits for the owner's decision exactly as today) → write receipt/session →
  result `{ slot, appId, displayName, port, dashboardUrl, dataDir, profile, branch, permissions,
  reused, next: "down …" }`. Reuse with a receipt whose `profile` differs → `PROFILE_MISMATCH`.
  Receipt present but row gone → `SLOT_ORPHANED` (next: `remove --keep-data`, then `up`).
- `status`: exists / running / healthy / `instance` / permissions / stale-slot count.
- `down` = **stop, then checks**: app stopped and the port released (`PORT_STILL_BOUND`), Dev-host
  invariant, installed-app diff. Keeps the row, the data and the receipt. **QA may hand off
  `passed` only after `down` exits 0** (AGENTS.md §10 rule).
- `remove` = stop → delete the receipt-backed, tag-checked row (never a row pointing at
  `~/.signals`, never one without `signals`+`dev` tags) → delete `~/.signals-dev/<slot>` unless
  `--keep-data` → installed-app diff. Workspaces/threads on the Dev host are reported, not deleted.
- `prune`: plan = rows tagged `signals`+`dev` whose `SIGNALS_DEV_WORKTREE` no longer exists, slot
  dirs whose receipt names a missing worktree, and with `--legacy-qa` every row named
  `Signals issue-<N> QA` regardless of tags (plus their `/private/tmp/signals-qa-*` data and
  receipts, if any). A row pointing at `~/.signals` is never in the plan. Without `--apply` it
  prints the plan and exits 0; with `--apply` it stops and deletes each item and prints what it
  removed. The five stale rows are pruned with `--legacy-qa --apply`.

Error codes, complete: `USAGE, WORKTREE_INVALID, HOST_UNREACHABLE, HOST_PACKAGED_FORBIDDEN,
LOCAL_APP_MANAGEMENT_REFUSED, HOST_ERROR, DEV_HOST_UNSAFE, SLOT_LOCKED, SLOT_DATA_EXISTS,
SLOT_ORPHANED, PROFILE_MISMATCH, NAME_TAKEN, NEXT_DEV_ALREADY_RUNNING, SNAPSHOT_FAILED,
PROVISION_FAILED, START_FAILED, START_TIMEOUT, HEALTH_TIMEOUT, PORT_MISMATCH,
INSTANCE_UNGUARDED, PERMISSIONS_MISSING, APP_UNSAFE, CLEANUP_FAILED, PORT_STILL_BOUND,
PACKAGED_HOST_CHANGED, CANONICAL_CHANGED, DB_NOT_FOUND, DB_UNREADABLE, SQLITE3_MISSING,
UNEXPECTED`.

Receipt v2 (`<slot>/.launcher/receipt.json`): `schemaVersion: 2, kind: "signals-dev-local-app",
slot, worktree, branch, issueId, loopId, appId, displayName, tags, port, dataDir, profile,
workspaceSlug, baseUrl, cli, dbPath, createdAt, lastUpAt`. Session v2 holds the installed-app
snapshot and the last health result.

### ADR-541-9 Workspace slug per app

Each Dev app runs with `SIGNALS_RTX_WORKSPACE_SLUG=signals-dev-<slot>`; Signals creates it on the
Dev host on first dispatch, as it does today for `signals`. The launcher never creates workspaces.
Nothing in this design creates a workspace, thread or app on the installed host; ADR-541-7 proves
it for apps and warns for workspaces.

### ADR-541-10 Launcher shim and runtime

The copied launcher dir becomes `scripts/qa/signals-dev-local-app-launcher/` and reads
`SIGNALS_DEV_WORKTREE` (the old `SIGNALS_QA_WORKTREE` is recognised by `prune` only). The shim
still refuses a non-Signals directory and runs `npm run dev` in the worktree with the inherited
env, so RealTimeX's `RTX_APP_ID`, `RTX_APP_NAME`, `RTX_PORT` reach Next. The main checkout uses
the same shim (its row is created by slice 1), so there is one code path for every slot.

### ADR-541-11 Identity for the skill (slice 4, in scope)

`resolve-base-url.sh`:

- Explicit `SIGNALS_BASE_URL`: accept when health says `app: signals`, any instance (this is the
  only way to reach a Dev app).
- Fallback probe: candidates are `RTX_PORT`, `PORT`, then `3010` on `localhost` and `127.0.0.1`.
  Port `3000` is dropped. A candidate is accepted only if health has `"mode": "embedded"` **and**
  does not have `"kind": "dev"`. A missing `instance` field is accepted (the deployed canonical is
  0.2.20 and predates the field); a present `dev` is rejected with a specific message naming the
  URL and telling the agent to set `SIGNALS_BASE_URL` if a Dev app was intended.
- `run-signals-pp-cli.sh`, `invoke-tool.sh`, `list-tools.sh` inherit the rule by calling the
  resolver. `signals-pp-cli` itself takes `SIGNALS_BASE_URL` and has no probing; unchanged.

Acceptance "canonical stopped, Dev app on 3000 → the resolver errors" holds twice over: 3000 is no
longer probed, and a Dev app anywhere is rejected by `kind`.

### ADR-541-12 Slice 3 (`--needs` narrowing of registration) is deferred

Out of this loop. Sketch for the follow-up: `SIGNALS_RTX_REQUEST_PERMISSIONS` (comma list,
honoured only when `SIGNALS_INSTANCE=dev`, filtered to the manifest set) read by
`registerWithRtx`; the launcher sets it from `--needs`, so an `up` without `--needs` registers
`[]` and shows no dialog. Persisting grants per worktree (ADR-541-4) already removes the
once-per-rework prompt, which is the pain #541 names; narrowing is an optimisation.

### ADR-541-13 AGENTS.md §10 is rewritten

New content: the three owner decisions; the Dev host is the only host for agents; the
never-expiring scoped key and the `--cli` wrapper; the five commands and the `down`-before-`passed`
rule (stop, not delete); `remove` at loop close or `prune --apply` when `up` reports stale slots;
`--profile snapshot` rules; what the guard refuses and that `DEV_INSTANCE_GUARD` during QA is the
design working, not a bug; the standing prohibitions (never start/stop the installed app, never
touch the canonical row, never `delete-browser-session`, never the `signals-publish` session,
never work around the permission dialog, never `--restore-canonical` outside the documented
slice-1 restore). The "Dev host (only when the change needs it)" subsection is folded into the
main text; `rtxtest` guidance stays.

### ADR-541-14 Scope of this loop

Slices 1, 2 and 4 ship in this loop: everything #541 lists under *Acceptance* has an owner here.
Slice 3 is deferred (ADR-541-12). realtimex-ai-app#2276 stays out of scope; see §7.

## 4. Scenarios against the acceptance criteria

| #541 acceptance | How this design meets it | Proof |
|---|---|---|
| Isolation: two worktrees run at once, own port/data/workspace | ADR-541-2/3/4/9: distinct slot, port, `~/.signals-dev/<slot>`, `signals-dev-<slot>` | live: `up` in `loop-issue-541-f90967d6` and in the main checkout; both `status` healthy on different ports |
| No pollution of the installed app | ADR-541-1 (Dev host only), ADR-541-7 (read-only snapshot/diff) | `down` prints `packagedHostUnchanged: true`; unit test with a fixture installed DB |
| Permissions persist: second `up` shows no dialog | the row and its `metadata.permissions` survive `down` (ADR-541-8) | live: `up`, grant, `down`, `up` → `permissions.pending: []`, no dialog |
| Scheduler off: overdue job in a snapshot does not run at boot | `SIGNALS_SCHEDULER_ENABLED=0` pinned (ADR-541-5), health reports `scheduler: disabled`, `up` verifies | existing unit test; integration boot with `SIGNALS_INSTANCE=dev` + a due job inserted before start → still `pending` |
| Skill stays on canonical with the canonical stopped and a Dev app on 3000 | ADR-541-11 | shell test with fake health servers: dev on 3000 and on 3010 → exit 1; embedded canonical on 3010 → chosen; explicit `SIGNALS_BASE_URL` to a dev app → chosen |
| Tests cover the new lifecycle | `test-qa-local-app.mjs` and `test-signals-qa-local-app.mjs` rewritten around slots; mock CLI gains `delete`/`prune` paths | `npm run test:qa-local-app` in `npm run check` |

Failure and recovery scenarios Dev must trace in code and tests: Dev host down (`HOST_UNREACHABLE`,
never started); key missing (`LOCAL_APP_MANAGEMENT_REFUSED`); Dev row not yet migrated
(`DEV_HOST_UNSAFE`); stale branch without the guard (`INSTANCE_UNGUARDED`, app stopped); pinned
port busy (`PORT_MISMATCH`); snapshot over existing data (`SLOT_DATA_EXISTS`); row deleted in the
UI while the receipt exists (`SLOT_ORPHANED`); two `up`s racing (`SLOT_LOCKED`); publish attempted
in a Dev app (HTTP 403 `DEV_INSTANCE_GUARD`, no job row).

## 5. Test and QA plan

Without the Dev-host key (available now):

- `node scripts/qa/test-signals-qa-local-app.mjs` and `node scripts/qa/test-qa-local-app.mjs`
  against the mock CLI, a fixture Dev DB, a fixture installed DB and a fixture
  `SIGNALS_CANONICAL_DATA_DIR` for the snapshot profile (the real `~/.signals` is never read by
  tests). Cover `up` create/reuse, `down`, `remove`, `prune` plan/apply/`--legacy-qa` on the five
  stale-row shapes, port allocation, both profiles and the scrub, `INSTANCE_UNGUARDED`,
  `DEV_HOST_UNSAFE`, `PACKAGED_HOST_CHANGED`, `migrate-dev-signals-row.mjs` end to end including
  the symlink rule and the `already migrated` path.
- Vitest unit: `instance.ts`, `guard.ts`, one test per chokepoint, health shape, boot check.
- Vitest integration project: boot the production build with `SIGNALS_INSTANCE=dev`, assert the
  health `instance` block, 403 `DEV_INSTANCE_GUARD` on `send-to-agent`, `x/compose`, `x/engage`,
  `x/auth`, `linkedin/auth`, `gmail/auth`, `platform-targets/connections` is unaffected (DB only)
  but `platforms/x/browser-session` `setup` is 403; a due `scheduled_jobs` row stays `pending`.
- Resolver: a node test that serves fake `/api/health` bodies on free ports and drives
  `resolve-base-url.sh` through the four cases in §4.
- Standalone run: `SIGNALS_INSTANCE=dev SIGNALS_DATA_DIR=/private/tmp/signals-541-$$ npm run dev`
  then `curl /api/health`; recorded in the handoff.

With the key (owner creates one never-expiring `local-apps:*` key in RealTimeX Dev → Settings →
API Keys; Coordinator raises it in the morning): Dev requests Delegate judgment for slice 1, runs
`migrate-dev-signals-row.mjs`, then `prune --legacy-qa --apply`, then the live scenarios in §4.
Until then QA reports those scenarios as **blocked on the key**, not failed. The Dev host is running
today, so the live run follows the key immediately.

## 6. Delivery order (one PR, reviewable commits)

1. `src/lib/instance/*`, guard at the chokepoints, health `instance` block, boot check, tests.
2. Launcher generalisation: slots, port, profiles, `remove`, `prune`, hygiene modes, shim rename,
   tests.
3. `migrate-dev-signals-row.mjs` + `provision-signals-local-app.mjs` header, tests.
4. `resolve-base-url.sh` identity rule + test.
5. AGENTS.md §10, `docs/qa/README.md`, `docs/local-app.md` env table (`SIGNALS_INSTANCE`,
   `SIGNALS_DEV_WORKTREE`).

## 7. Risks and follow-ups

- **In-flight branches** cannot use the Dev host until they merge `main` (ADR-541-5). Intentional.
- **realtimex-ai-app#2276**: worktree desktops copy Dev `local_apps` rows. Copies taken before
  slice 1 still carry the `~/.signals` row; copies taken after carry `~/.signals-dev/main`.
  Out of scope here; tracked there.
- **`provision-signals-local-app.mjs --restore-canonical`** recreates the hazard by design (it is
  the restore path). Follow-up after the owner confirms the migration: delete the script and the
  AGENTS.md mention.
- **Workflow terminal reconciler** runs at boot in Dev apps and may try to terminate RTX session
  ids it finds in a snapshot; those ids do not exist on the Dev host, so the calls 404. Noted, not
  guarded.
- **Mail**: `himalaya` accounts come from `~/.config/himalaya`, outside `SIGNALS_DATA_DIR`; a Dev
  app can still list the owner's real mail. Read-only, not a publish/send/invite/connect path, so
  outside this guard; a follow-up may add `mail.read` to the effect list.
- **Slice 3** follow-up per ADR-541-12.

## 8. Resolved questions from the Dev handoff

1. Shape → ADR-541-1. 2. Key/name/port → ADR-541-2/3. 3. Data → ADR-541-4. 4. Guard →
ADR-541-5. 5. Dev row → ADR-541-6 (delete + create; update is unscoped and cannot retarget).
6. Slicing → ADR-541-14. 7. QA without the key → §5.
