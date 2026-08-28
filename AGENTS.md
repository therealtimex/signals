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

Signals reads and writes `~/.signals` unless `SIGNALS_DATA_DIR` overrides it. `npm run check`
includes `db:migrate`, so running the gate with the default env **migrates the real user
database**. Point it somewhere disposable first:

```bash
export SIGNALS_DATA_DIR=/private/tmp/signals-agent-$$
npm run check
```

Vitest isolates SQLite per worker on its own (`src/test/setup-env.ts`); `db:migrate`, `dev`, and
`build` do not. Never delete or hand-edit `data.db*` or committed migrations in
`src/lib/db/migrations/` (31 files) — add a new one with `npm run db:generate`.

## 3) Commands

| Task | Command |
|---|---|
| Install | `nvm use && npm ci` |
| Dev server | `npm run dev` (port `${RTX_PORT:-${PORT:-3000}}`) |
| **Full gate (run before finishing)** | `npm run check` |
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

`npm run check` = typecheck → lint → `check:agent-tools-openapi` → coverage → skill-package →
provision-verifier → `db:migrate` → build. It is the same gate CI runs.

## 4) Verification and CI gates

- `.github/workflows/pr-ci.yml` runs on every PR: **react-doctor** (`blocking: error`),
  `verify:node-runtime`, `verify:marketplace-versions`, `npm run check`, `verify:fresh-import`,
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
| Scheduler boot | `instrumentation.ts:193` (`initScheduler`) |
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
.claude/skills/     project skills (realtimex-signals, signals-publish, react-doctor)
test/fixtures/      shared fixtures
```

Config lives in `package.json`, `.nvmrc`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`,
`eslint.config.mjs`, `drizzle.config.ts`, `tsup.config.ts`, `postcss.config.mjs`,
`components.json`, `instrumentation.ts`, `rtx-manifest.json`.

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

Use this workflow when validating Signals changes against the RealTimeX desktop app:

1. Start the RealTimeX dev host from the main checkout, not from the Signals worktree:

   ```bash
   cd /Users/realtimex/rtgit/realtimex-ai-app
   yarn dev:all
   ```

   The expected dev surfaces are the RealTimeX Electron renderer (`realtimex-app-dev://app`),
   frontend `3100`, server `3101`, and Electron CDP `9888`. Never use the production RealTimeX app
   for this testing.

2. In the running RealTimeX dev app, register the Signals worktree under test as a **dedicated QA
   Local App** — never repoint the canonical dev app (`47e45f71-3279-42f5-8e95-731de01b6eae`,
   display name **Signals**). Prior loops used separate entries such as `Signals issue-335 QA`;
   follow that pattern (`Signals issue-<N> QA`) so daily dev keeps `SIGNALS_DATA_DIR=~/.signals`.

   Provision it through the guarded command; do not call `update-local-app` for **Signals**:

   ```bash
   node scripts/qa/provision-signals-qa-local-app.mjs \
     --issue <N> \
     --worktree "$PWD" \
     --loop-id <loop-id>
   ```

   The provisioner creates and starts `Signals issue-<N> QA`, uses a launcher that runs `npm run
   dev` in the issue worktree, pins `SIGNALS_DATA_DIR` under `/private/tmp/signals-qa-*`, tags the
   record `signals,qa,ephemeral,issue-<N>`, and writes a receipt containing the exact app id. It
   refuses `main`, the canonical app id, an unsafe data path, or a pre-existing issue app.

3. If RealTimeX prompts for permissions, grant only those required by the test. Signals listens on
   the port RealTimeX assigns it — commonly `3010`, while a
   standalone `npm run dev` defaults to `3000`. Read the assigned port from the Local App UI, then
   use that same port for the home URL (`/dashboard`) and the health probe (`/api/health`) before
   exercising the scenario.

4. The bundled `rtxtest` launcher may lack its executable bit in the QA workspace. If direct
   invocation fails with `Permission denied`, invoke the same script through Node instead:

   ```bash
   node /Users/realtimex/.realtimex.ai/desktop-user-data/app/users/trungle_rta_vn/storage/working-data/realtimex-qa/.agents/skills/rtx-test-runner/scripts/bin/rtxtest <verb>
   ```

   Do not point `rtxtest dev up` at the Signals repository; it is a Local App, not the RealTimeX
   app repo.

5. After QA evidence is captured and **before the terminal QA handoff**, run teardown and the
   authoritative DB hygiene gate:

   ```bash
   node scripts/qa/cleanup-signals-qa-local-app.mjs --issue <N>
   REALTIMEX_RUNTIME=dev \
     node scripts/qa/verify-signals-local-app-hygiene.mjs --issue <N>
   ```

   Then stop the `yarn dev:all` host and confirm the Signals port plus `3100`, `3101`, and `9888`
   are clear. A QA pass is incomplete if either command fails.

   **Teardown / config hygiene**

   - Teardown stops and permanently deletes only the receipt-backed, safety-tagged issue QA app.
     It refuses the canonical app and removes the disposable QA data directory by default.
   - Do **not** leave disposable `SIGNALS_DATA_DIR` paths or worktree `args` on the canonical
     **Signals** app. Modifying that record is an incident, not the normal QA workflow. Restore it
     before handoff with the explicit recovery guard:

     ```bash
     REALTIMEX_RUNTIME=dev \
       node scripts/qa/provision-signals-local-app.mjs \
         --restore-canonical \
         --db ~/.realtimex.ai/desktop-user-data/dev/users/trungle_rta_vn/storage/realtimex.db
     ```

     (`REALTIMEX_RUNTIME=dev` selects the dev storage root when the script resolves the DB path.)
   - Do not hand off `passed` or close the loop until the hygiene verifier confirms the canonical
     app points at the canonical checkout with `SIGNALS_DATA_DIR=~/.signals` and no issue QA record
     remains.

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
