# AGENTS.md

For coding agents (Claude/Codex/Cursor/etc.). `CLAUDE.md` is a symlink to this file, so it loads
every session — keep it repo-specific. Generic "write clean code" advice does not belong here.

**Project:** Signals — local-first social GTM & relationship knowledge graph, shipped as a
RealTimeX Local App. Next.js 16 (App Router, Turbopack) + React 19 + TypeScript 5.8,
SQLite via better-sqlite3 + Drizzle, Tailwind 4 / shadcn-ui, Vitest.

## 1) Runtime — do this before anything else

```bash
nvm use && npm ci
```

The repo pins Node **22.16.0** (`.nvmrc`, `engines: >=22.16.0 <23`) because `better-sqlite3` must
match the RealtimeX host's module ABI **127**. On any other Node:

- `npm ci` / `npm install` aborts in `preinstall` (`scripts/node-runtime-contract.mjs`).
- Anything importing `src/lib/db/client.ts` throws `NODE_MODULE_VERSION 127 … requires <n>`.

An ABI error means the wrong runtime, not a stale dependency. Do **not** "fix" it by upgrading
Node, `better-sqlite3`, or Next.js, and do not `npm rebuild` — run `nvm use` instead.

## 2) Data-directory safety

Signals reads and writes `~/.signals` unless `SIGNALS_DATA_DIR` overrides it. `npm run check:all`
includes `db:migrate`, so running the gate with the default env **migrates the real user
database**. Point it somewhere disposable first:

```bash
export SIGNALS_DATA_DIR=/private/tmp/signals-agent-$$
npm run check:all
```

Vitest isolates SQLite per worker on its own (`src/test/setup-env.ts`); `db:migrate`, `dev`, and
`build` do not. Never delete or hand-edit `data.db*` or committed migrations in
`src/lib/db/migrations/` (31 files) — add a new one with `npm run db:generate`.

**Seed changes need no restart.** `seedTemplates()` runs at boot, and the dev server hot-reloads
code without re-running instrumentation, so a seed edit looks like it did not land. `npm run reseed`
applies it in about a second (`SIGNALS_DATA_DIR=/tmp/copy npm run reseed` to rehearse first).

## 3) Commands

| Task | Command |
|---|---|
| Install | `nvm use && npm ci` |
| Dev server | `npm run dev` (port `${RTX_PORT:-${PORT:-3000}}`) |
| **Iterate** | `npm run check:fast` (~85s: typecheck, lint, unit tests) |
| **Full gate (run before finishing)** | `npm run check:all` |
| Typecheck only | `npm run typecheck` |
| Lint only | `npm run lint` (`--max-warnings 0`) |
| Tests, once | `npm run test:run` |
| Tests, watch | `npm test` — interactive; avoid in agent sessions |
| One test file | `npx vitest run src/lib/workflows/format-error.test.ts` |
| One project | `npx vitest run --project unit` (also `latency`, `integration`, `import-safety`, `embedded`) |
| Integration suite | `npm run test:integration` |
| Coverage (gated) | `npm run test:coverage` |
| Migrations | `npm run db:generate` → `npm run db:migrate` |
| React Doctor (blocking in CI) | `npm run doctor` |
| Production build | `npm run build` |

`npm run check:all` = `check` → `check:build`, and is the same gate CI runs.

- `check:fast` — typecheck, lint, and the whole unit project. Roughly 85 seconds against about
  15 minutes for the full gate, and it catches everything a change under `src/` can break in those
  three. Use it while iterating. Narrow it further by passing paths to `vitest run` directly:
  `npx vitest run src/lib/orgs` is a few seconds.
- `check` — the non-build gate: typecheck → lint → `check:agent-tools-openapi` → automation →
  writing corpus/skill → coverage → skill-package → provision-verifier → qa-local-app →
  `db:migrate`.
**Run the gate in this checkout, not a fresh worktree.** `check:all` takes about 2.5 minutes here
with warm `.next` and Vitest caches; the same gate in a newly created worktree took 12–15 minutes,
because those caches start cold. Worktrees are for attributing a failure to a baseline (see the
`SQLITE_BUSY` note below), not for routine verification.

- `check:build` — `db:migrate` → `next build`. About 35 seconds. Split out not because it is slow
  but because it is where the `SQLITE_BUSY` analytics flake lands, and it used to run *last*: a
  flake meant re-running the whole 15-minute gate to retry a 35-second step. Retry this alone.

## 4) Verification and CI gates

- `.github/workflows/pr-ci.yml` runs on every PR: **react-doctor** (`blocking: error`),
  `verify:node-runtime`, `verify:marketplace-versions`, `npm run check:all`, `verify:fresh-import`,
  and `test:integration` — each with `SIGNALS_DATA_DIR` pinned into the workspace.
- `.github/workflows/release.yml` runs only on `main` pushes and `v*` tags. Never on PRs.
- Coverage thresholds gate the build (`vitest.config.ts`: lines 80 / functions 75 / branches 48 /
  statements 80) over an explicit `COVERAGE_INCLUDE` file list. Adding a file to that list without
  tests will fail CI.
- Touching agent tools? Re-run `npm run generate:agent-tools-openapi`, or
  `check:agent-tools-openapi` fails the gate.
- **Touching `heartbeat-task-block.ts`? Run `npm run contract:heartbeat` before you trust it.**
  It walks every `tasks:` representation — block list, `tasks: []`, populated inline (loose and
  front matter), front-matter block, no key, `heartbeat:` document, indented and fenced examples —
  in **both LF and CRLF**, through RealTimeX's *real* `parseTaskBlock`, and asserts each task is
  visible to the runtime. Four P1s shipped from this file because its output *looked* right and the
  runtime disagreed; a test that reads our own output cannot catch that. It needs a
  `realtimex-ai-app` checkout (auto-discovered, or set `RTX_APP_REPO`) and skips without one. It
  lives in its own `contract` vitest project whose include is gated on
  `SIGNALS_CONTRACT_PROBES=1`, so no default invocation — including a bare `vitest run`, which
  executes every project — depends on a sibling repo's state. Nothing runs it for you.
- **Touching `runtime-sessions.ts` parsing? Run `npm run contract:terminal-sessions`.** Same class
  of bug, same reason: we read `GET /cli/list-terminal-sessions` as `results.workspaces`, an
  envelope the host has never sent, and every mock in the unit test described that same invented
  shape — so our output agreed with our input while both disagreed with the runtime. The parser
  returned zero sessions for every real response, which silently disabled the whole deferred
  teardown path for 100+ commits (#295, shipped dead in #297). The probe asserts our parser
  against a *live* RealTimeX; it skips when none is reachable and fails when `RTX_API_BASE_URL` is
  set but unusable. Run every contract project with `npm run contract`.
- **A passing test does not mean the screen is right.** Unit tests assert on the data a component
  receives, and jsdom resolves neither layout nor hit-testing. `npm run probe:ui` renders a page in
  the running app and reports what is actually there:

  ```bash
  npm run probe:ui -- --path /dashboard/organizations --eval "document.querySelectorAll('tbody tr').length"
  npm run probe:ui -- --path /dashboard/workflows --click "Deduplicate & Merge Companies" --dialog
  ```

  It exits non-zero when the app is unreachable, the element is missing, or the expression throws,
  so it can gate a script. Three defects shipped in one workflow template while every test passed —
  the template seeded, its config was right, its dispatch was right, and the dialog still rendered
  another template's fields, because nothing had opened it.
- A mock you wrote cannot falsify an assumption you made. When the shape comes from outside this
  repo, pin it with captured bytes (see `src/lib/rtx/host-fixtures/`) or a contract probe.
- Decide what proves the change *before* patching: name the observable that moves if the fix
  works — an API response, a DB row, a test assertion, a screenshot.
- When sources disagree, trust the most authoritative one. The SQLite row and the API payload
  outrank what the dashboard renders.
- If you cannot run a check, say so explicitly: why, the exact command to run, expected outcome.
  If you fell back to a lighter proof than the one the change deserved, name the fallback instead
  of reporting the work as verified.
- More detail: [`docs/qa/README.md`](./docs/qa/README.md).

## 5) Layout

**Entry points — jump here first:**

| Concern | File |
|---|---|
| Agent-tools HTTP surface | `src/app/api/agent-tools/route.ts`, `.../invoke/route.ts` |
| Tool dispatch | `src/lib/agent-tools/invoke.ts:5` (`invokeAgentTool`) |
| Tool handlers | `src/lib/agent-tools/handlers.ts:89` onward |
| Agent-tools request auth | `src/lib/agent-tools/auth.ts:4` |
| DB handle / native open | `src/lib/db/client.ts:48` (`db`); line 21 opens better-sqlite3 and is what throws on the wrong Node |
| Schema | `src/lib/db/schema.ts` |
| Boot hook / scheduler | `src/instrumentation.ts:204` (`initScheduler`; off in the standalone runtime via `SIGNALS_SCHEDULER_ENABLED=0`) |
| RTX host handshake | `src/lib/rtx/bootstrap.ts:56` (`bootstrapRtxIfEmbedded`) |
| Enrichment routing | `src/lib/agents/router.ts:31` (`routeUrl`) |
| Health probe | `src/app/api/health/route.ts:7` |

Partial map — `src/lib/` has ~25 domain folders; browse it before adding a new one.

```
src/app/api/        REST routes (agent-tools/, health/, contacts/, ...)
src/app/dashboard/  UI routes
src/lib/db/         schema.ts, client.ts, queries/, migrations/ (generated)
src/lib/platforms/  x/, linkedin/, gmail/ (client + mappers + adapter)
src/lib/agent-tools/  tool registry, invoke, JSON schemas, auth
src/lib/agents/     router, workflow runners, tools/
src/lib/browser/    Playwright publish/engage sessions
src/lib/{scheduler,auth,analytics,rtx,graph,embeddings,workflows,publish}/
src/components/     shadcn-ui based shared components
scripts/            build/verify/release tooling (.mjs, ESM)
tools/signals-pp-cli/   packaged CLI
flows/              RealTimeX agent-flow JSON
specs/              numbered feature specs (NN-name.md)
docs/               integration docs (agent-tools, local-app, qa/)
guide/              end-user guide
.claude/skills/     project skills (realtimex-signals, signals-writing, signals-publish, react-doctor)
test/fixtures/      shared fixtures
```

Config lives in `package.json`, `.nvmrc`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`,
`eslint.config.mjs`, `drizzle.config.ts`, `tsup.config.ts`, `postcss.config.mjs`,
`components.json`, `rtx-manifest.json`. The Next.js instrumentation hook is `src/instrumentation.ts`:
with the app under `src/app`, `next build` only detects it there (#484).

**Where new things go:** library code → `src/lib/<domain>/`; tooling → `scripts/*.mjs`; a feature
spec → `specs/NN-name.md`; user-facing docs → `guide/`; integration docs → `docs/`; tests →
co-located `*.test.ts` next to the source.

## 6) Repo skills

Task guides live in `.claude/skills/`. They are not auto-registered by every agent runtime — open
and follow the matching `SKILL.md` when the task fits.

- **`react-doctor/SKILL.md`** — after any React component, hook, page, route, or state-flow
  change. Not optional: react-doctor is a **blocking** PR check (`blocking: error` in
  `pr-ci.yml`), so skipping it locally just moves the failure into CI. Run `npm run doctor`.
- **`realtimex-signals/SKILL.md`** — driving Signals through the agent-tools REST API (contacts,
  goals, tasks, workflows, analytics). Read it before changing tool schemas or handlers so the
  documented contract and the implementation stay in sync.
- **`signals-publish/SKILL.md`** — X publishing via RealTimeX Browser over CDP and the
  `complete_publish` callback. Read it before touching `src/lib/publish/` or `src/lib/browser/`.
- **`signals-writing/SKILL.md`** — evidence spine, voice, platform-overlay, audit, approval, and
  materialization contract for X/LinkedIn/Facebook writing. Read it before changing writing
  orchestration or skill records; run `npm run test:writing-skill` after editing the skill.

## 7) Conventions that actually bite

- ESM only (`"type": "module"`); standalone scripts are `.mjs`.
- Path alias `@/` → `src/`. TypeScript is strict; `npm run lint` allows zero warnings.
- Test file suffix selects the Vitest project: `*.test.ts` (unit), `*.latency.test.ts`,
  `*.integration.test.ts`, `*.import-safety.test.ts`, `*.embedded.test.ts`.
- Worker data dirs (`$SIGNALS_DATA_DIR/worker-<id>`) are shared by every file on that worker and
  reused across runs, so a test that clears `platform_accounts` must call `resetCoreTables()`
  (`src/test/db.ts`) first or it hits `FOREIGN KEY constraint failed` on rows another file left.
  State kept outside SQLite survives every DB reset — the default mail alias lives in
  `config.json` and needs `setDefaultMailAccountAlias(null)`.
- Secrets go in `.env.local`; document new names in `.env.example`. Never log or commit them.
- Worktrees share dependencies by symlink — see §11.
- `.ci/`, `coverage/`, `test-results/`, `data/`, and `*.db` are gitignored. Keep it that way.

## 8) Guardrails

Small, reviewable diffs. Prefer patching existing code over adding new systems. Preserve local
naming and formatting; no unrelated churn.

**Confirm with the user before:** schema changes or new migrations; anything touching
auth/crypto/stored credentials (`src/lib/auth/`); marketplace packaging, release manifests, or
signing; CI workflow changes; new or major-version dependencies; deletions and broad refactors.

## 9) Git, GitHub, and PR conventions

- Default branch is `main` (`origin` = `github.com/therealtimex/signals`). Never commit to `main`
  directly. Observed branch shapes: `issue-<n>`, `issue-<n>-<slug>`, `fix/<slug>`, `feat/<slug>`,
  `agent/<slug>`.
- Conventional Commits, with a scope when one is obvious: `feat: ...`, `fix(workflows): ...`,
  `fix(release): ...`. Squash-merged titles carry the PR number, e.g. `feat: ... (#201)`.
- Never commit `.env.local`, `*.db`, or anything under `.ci/`, `coverage/`, `test-results/`.
- Outside of loop handoffs (below), commit and push only when the user asks.

**GitHub access — use `gh`, never a browser.** Read and write GitHub through the CLI:
`gh pr view <n>`, `gh pr diff <n>`, `gh pr checks <n>`, `gh issue view <n>`, `gh run list`,
`gh run view <id> --log-failed`, and `gh api` for anything without a porcelain command. Do not
drive github.com through agent-browser, a browser session, or a plain web fetch — those return
rendered HTML that is slow to parse, silently truncates long diffs and CI logs, and cannot see
anything gated behind the authenticated session. `gh` is already authenticated here (account
`therealtimex`, scopes `repo` and `workflow`). If a `gh` call fails, fix the command or the auth;
do not fall back to a browser.

### Handing off to another agent in a loop

A loop role usually resumes in a different worktree, session, or machine. Uncommitted changes are
invisible to it and a local worktree path means nothing there, so **land the work before routing
it**:

1. `git add -A && git commit -m "<conventional commit>"`
2. `git push -u origin <branch>`
3. `gh pr create --fill` (add `--draft` if it is not ready for review)
4. Hand off the PR URL that command prints — not a branch name alone, and never a worktree path.

Prefer this even for work in progress: a draft PR is a shared, durable reference the next role can
read, comment on, and check CI against. If something genuinely cannot be committed yet, say so
explicitly in the handoff and name what is missing, rather than routing a tree only you can see.

## 10) RealtimeX integration QA

Validate Signals changes against the **packaged RealTimeX app** already running on this machine,
with the worktree under test registered as a dedicated QA Local App. This is the default host. The
dev host refuses Local App management from an agent terminal (HTTP 401 `TERMINAL_SESSION_NOT_ACTIVE`
or 403 `LOCAL_APP_PEER_MANAGEMENT_FORBIDDEN`) unless the user mints a scoped API key, which expires
after about 24 hours. Use it only when a change needs the dev build; see
[Dev host](#dev-host-only-when-the-change-needs-it).

The packaged app is the user's live environment. Its canonical **Signals** app
(`47e45f71-3279-42f5-8e95-731de01b6eae`, port `3010`, `SIGNALS_DATA_DIR=/Users/realtimex/.signals`,
working directory = this main checkout) is in daily use, and its browser sessions are signed in to
real LinkedIn and X accounts. **Do not start, stop, or restart the packaged app.**

Drive the QA app with one script, run from the issue worktree. Call the main checkout's copy by
absolute path, so branches cut before the script existed still get it:

```bash
QA=/Users/realtimex/github/signals/scripts/qa/qa-local-app.mjs
node "$QA" up --issue <N> --loop-id <loop-id>   # provision, then wait until /api/health answers
node "$QA" status --issue <N>                   # exists? running? answering?
node "$QA" down --issue <N>                     # delete, hygiene gate, canonical diff, port released
```

Each command prints one JSON object and exits 0 only when `ok` is true. Exercise the scenario at the
`port` and `dashboardUrl` that `up` prints. On failure, act on `errorCode` and run the `next` it
prints; do not provision or clean up by hand around it.

- **`up`** refuses:
  - the primary checkout;
  - a host that will not manage Local Apps;
  - an issue QA app with no receipt, or whose receipt names another worktree or host;
  - a `next dev` already holding the worktree's `.next/dev/lock` (Next 16 runs one dev server per
    directory; stop yours first);
  - another `up` or `down` still running for the same issue.

  It snapshots the canonical record read-only, provisions through
  `provision-signals-qa-local-app.mjs`, and waits for `/api/health`. The provisioner names the app
  `Signals issue-<N> QA`, pins `SIGNALS_DATA_DIR` under `/private/tmp/signals-qa-*`, tags it
  `signals,qa,ephemeral,issue-<N>`, and writes a receipt.

  Rerunning `up` for the same worktree and host reuses the app, provided it still carries its safety
  tags and `up`'s session snapshot still exists. Otherwise it stops with `next` set to `down`.
  Start and health failures include the app's last log lines.
- **`down`** runs `cleanup-signals-qa-local-app.mjs` (deletes only the receipt-backed, safety-tagged
  issue app, never the canonical one), the hygiene verifier, a diff of the canonical record against
  `up`'s snapshot, and a check that the QA port was released. Run it before the terminal QA
  handoff. Do not hand off `passed` or close the loop until it exits 0.
- **`CANONICAL_CHANGED`** from `down` is an incident: stop and tell the user. Never run
  `provision-signals-local-app.mjs --restore-canonical` against the packaged host. It writes the
  literal `~/.signals` straight into the live database.
- **Anything that publishes, sends, invites, or connects reaches a real account.** Get the user's
  explicit OK before such a step, and prefer `--dry-run` or a local mock of the platform. Never call
  `delete-browser-session` on `signals-publish` or any other signed-in session: it deletes the
  login.
- Report, don't delete, what QA leaves behind: a dispatched run creates a thread in the packaged
  Signals workspace. If QA left `signals-publish` open (harness attestations reopen it after a run
  closes it), stop it with `realtimex-pp-cli stop-browser-session signals-publish`, which keeps the
  profile. The session list can show `stale` while its CDP port still answers, so check the port.
- If RealTimeX prompts for permissions, grant only those the test needs.

### Dev host (only when the change needs it)

Use the RealTimeX dev build only when the change depends on it: host behavior that has not shipped
in the packaged app yet, or a scenario that needs `rtxtest` app-automation flows. Those drive only
the dev app over CDP `9888` and never target the packaged app.

- Start it from the main RealTimeX checkout, not the Signals worktree:
  `cd /Users/realtimex/rtgit/realtimex-ai-app && yarn dev:all`. Its surfaces are the renderer
  (`realtimex-app-dev://app`), frontend `3100`, server `3101`, and Electron CDP `9888`. If it is
  already running and you did not start it, leave it running.
- Pass `--host dev` to `up`; `status` and `down` follow the host `up` recorded. Local App
  management there needs the user's scoped CLI key (`local-apps:*` scopes, created in the dev app's
  Settings → API Keys, valid about 24 hours), so also pass `--cli` an executable wrapper that runs
  `realtimex-pp-cli --credential-ref <ref> "$@"` to every command.
- `down` reads the dev database and runs the hygiene verifier with `REALTIMEX_RUNTIME=dev`. If it
  reports `CANONICAL_CHANGED` here, restore the dev record, then rerun `down`:

  ```bash
  REALTIMEX_RUNTIME=dev \
    node scripts/qa/provision-signals-local-app.mjs \
      --restore-canonical \
      --db ~/.realtimex.ai/desktop-user-data/dev/users/trungle_rta_vn/storage/realtimex.db
  ```

- The bundled `rtxtest` launcher may lack its executable bit in the QA workspace. If direct
  invocation fails with `Permission denied`, run the same script through Node:

  ```bash
  node /Users/realtimex/.realtimex.ai/desktop-user-data/app/users/trungle_rta_vn/storage/working-data/realtimex-qa/.agents/skills/rtx-test-runner/scripts/bin/rtxtest <verb>
  ```

  Do not point `rtxtest dev up` at the Signals repository; it is a Local App, not the RealTimeX
  app repo.
- Stop `yarn dev:all` afterwards only if you started it, then confirm the Signals port plus `3100`,
  `3101`, and `9888` are clear.

### Visual evidence for UI changes

Screenshots are committed to `.evidence/` (tracked on purpose — it is not gitignored) and named
`{before,after}_{view}_{desktop,mobile}_{light,dark}.png`, e.g. `before_drafts_mobile_dark.png`.
Capture all four combinations for each view you touch, take the `before_` set from the unmodified
build, and follow the existing filenames rather than inventing a parallel scheme.

## 11) Worktrees

Spawn a linked worktree and share the main checkout's dependencies with a symlink — do not run a
second `npm ci`, and do not copy the tree:

```bash
git worktree add ../signals-<slug>
cd ../signals-<slug>
ln -s ../signals/node_modules node_modules
nvm use
```

Two things had to be fixed for this to work, so do not "helpfully" revert either:

- **Turbopack** rejects a `node_modules` symlink whose target sits outside the project root
  (`Symlink node_modules is invalid, it points out of the filesystem root`). `next.config.mjs`
  detects the symlink and widens `turbopack.root` to the deepest ancestor shared by the worktree
  and the symlink target. It stays inert when `node_modules` is a real directory, so CI and
  release builds keep the default root and their standalone output tracing.
- **`.gitignore`** lists `node_modules` without a trailing slash. With the slash it matched only
  directories, so a symlink showed up as `?? node_modules` in every worktree.

Vitest needs no special handling: all five projects and the coverage thresholds run unchanged
through the symlink, because Vite resolves the real path.

Building in a fresh worktree, run migrations first — `npm run db:migrate && npm run build`. A bare
`next build` against an unmigrated `SIGNALS_DATA_DIR` races page-data collection against schema
creation and dies with `table \`contact_identities\` already exists`. `npm run check` already
orders these correctly.

## 12) Output protocol

When you finish work, report:

- what changed (1-3 bullets),
- files changed (paths),
- verification (exact commands you ran, and their result),
- risks and assumptions, including any check you could not run,
- the PR URL, whenever the work was pushed or handed off to another role.
