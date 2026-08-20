# signals-pp-cli — Agent-Native CRM CLI (Printing Press)

**Status:** Approved (System Design, 2026-08-19) — Dev implements exactly this surface; contract changes go back through design.
**Issue:** [#174](https://github.com/therealtimex/signals/issues/174) · **Related:** [#21](https://github.com/therealtimex/signals/issues/21) `realtimex-signals` skill · [#172](https://github.com/therealtimex/signals/issues/172) thread-attached pipelines · [#118](https://github.com/therealtimex/signals/issues/118) publish lane
**Generator:** [CLI Printing Press](https://github.com/mvanhorn/cli-printing-press)
**Parents:** [`docs/agent-tools.md`](../docs/agent-tools.md), [`src/lib/workflows/template-brief.ts`](../src/lib/workflows/template-brief.ts), `.claude/skills/realtimex-signals/`
**Build precedent:** [therealtimex/realtimex-sdk](https://github.com/therealtimex/realtimex-sdk) (`generate-skill.mjs` + Printing Press); RTX app [`scripts/dev-sdk-build.mjs`](https://github.com/therealtimex/realtimex/blob/main/scripts/dev-sdk-build.mjs)

---

## 1. Problem

Agent workflow templates (prospecting, enrichment, etc.) reliably complete **research** but fail **write-back** to Signals:

1. Agent stages `workflow-runs/<runId>/contacts.csv` (and `.json`) in the RTX workspace.
2. Agent must rediscover the Signals base URL, load the agent-tools manifest, and loop `POST /api/agent-tools/invoke` per row.
3. When Signals is unreachable, the `realtimex-signals` skill is missing, or the agent improvises platform commands (`realtimex-pp-cli list-local-apps` → `403 LOCAL_APP_PEER_MANAGEMENT_FORBIDDEN`), research completes but **CRM stays empty**.

Observed failure (Aug 2026): 24 fintech contacts researched and staged; zero records created.

#172 introduces thread-attached **pipeline** workflows with `code` / `llm` / `agent` executors. The **agent lane** (gallery templates → brief → terminal agent) needs a deterministic **commit step** separate from open-ended CRM playbooks.

---

## 2. Doctrine

| Layer | Owner | Responsibility |
|-------|-------|----------------|
| **Signals server** | Local App | Source of truth; `/api/agent-tools` manifest + invoke |
| **`signals-pp-cli`** | Printed domain CLI | Agent-native CRM operations + compound pipeline commands |
| **`realtimex-pp-cli`** | RTX platform CLI | Workspaces, browser sessions, local app lifecycle — **not** CRM |
| **Skills** | Workspace provision | Workflow doctrine (`realtimex-signals`, `signals-publish`); thin wrappers over CLI |

**Do not** fold Signals CRM commands into `realtimex-pp-cli`. **Do not** replace skills entirely — Printing Press model is **binary + skill pair**.

### Non-Obvious Insight (NOI)

> Signals isn't just a contact database. It's a GTM relationship graph. Every contact, edge, simulation, and publish outcome is a signal about pipeline health.

Compound commands (`import`, `reconcile`, `health`, future `stale`) embody this insight. Thin API wrappers alone are insufficient.

---

## 3. Architecture

```
Terminal agent / Agent Flow runCommand
        │
        ├─ realtimex-pp-cli     → RTX platform (browser sessions, prepare --agent)
        │
        └─ signals-pp-cli       → Signals CRM
                │
                ├─ compound: import | reconcile | doctor | health
                └─ manifest-backed: query-contacts | create-contact | …
                        │
                        POST {base}/api/agent-tools/invoke
```

### Base URL resolution order

| Priority | Source |
|----------|--------|
| 1 | `SIGNALS_BASE_URL` env override |
| 2 | Brief-embedded URL (`buildAgentWorkflowBrief` writes `signalsBaseUrl`) |
| 3 | RTX embedded Local App (`RTX_PORT` / `PORT`) |
| 4 | Health probe (`3010`, `3000` on localhost) with actionable errors |

Typed exit codes (Printing Press convention): `0` success · `2` usage · `3` not found · `4` auth · `5` API · `7` rate limited.

Actionable error codes for agents: `SIGNALS_NOT_RUNNING`, `SIGNALS_URL_UNREACHABLE`, `VALIDATION_ERROR`.

---

## 4. Command surface

### 4.1 Layer 1 — manifest-backed (generated from `GET /api/agent-tools`)

Wrap existing agent-tools with agent-native UX:

- Auto-JSON when stdout is piped (no `--json` required)
- `--compact`, `--select`, `--dry-run`, `--no-input`
- Human tables in TTY; structured JSON otherwise

Examples: `query-contacts`, `create-contact`, `enrich-contact`, `get-publish-job`, `complete-publish`, etc.

**Source of truth:** `docs/agent-tools.md` tool catalog. Generator input is OpenAPI derived from the agent-tools surface (§6.1).

### 4.2 Layer 2 — compound commands (Phase 3 transcendence — **v1 priority**)

| Command | Purpose |
|---------|---------|
| `signals-pp-cli doctor` | Resolve base URL; `GET /api/health`; report auth token status |
| `signals-pp-cli import contacts --file <path> [--dedupe] [--dry-run]` | Read staged CSV/JSON; dedupe; batch create/enrich; emit summary JSON |
| `signals-pp-cli reconcile --file <path>` | Preview dedupe / conflicts without mutating |
| `signals-pp-cli health` | Compact pipeline snapshot for thread summary |

#### `import contacts` contract (v1)

**Input file paths** (workspace-relative or absolute):

- `workflow-runs/<runId>/contacts.csv`
- `workflow-runs/<runId>/contacts.json`

**Dedupe keys (v1):** primary email, then `(platform, platformUserId)` when present. The
platform lookup passes `includeArchived: true` so it sees archived claim holders — the
`upsert_contact_identity` guard ignores archived status, so hiding them would create a
duplicate that is then rejected.

**Stdout (last line, JSON):**

```json
{
  "success": true,
  "created": 18,
  "skipped": 4,
  "enriched": 2,
  "failed": 0,
  "errors": [],
  "notes": []
}
```

`notes` carries non-failure explanations (currently: a row skipped because an **archived**
contact already holds that `(platform, platformUserId)` claim). It never affects `success`
or the exit code — restore the archived contact to import such a row.

**Exit codes:** `0` all succeeded or skipped cleanly · `3` file not found · `4` auth / `SIGNALS_NOT_RUNNING` · `5` partial row failure · `7` rate limited.

**Idempotency:** re-running import with same file should skip existing contacts (dedupe), not duplicate.

**Batching (v1):** process rows in chunks of **50** (`--batch-size`, default 50, max 50). Hard cap **500 rows** per invocation (`--limit`, default unlimited up to 500); refuse above 500 with exit `2` and actionable message.

#### Staged file schema (v1)

Agents stage `contacts.csv` or `contacts.json` under `workflow-runs/<runId>/`. Both encode an array of contact records.

**CSV columns** (header row required; unknown columns ignored):

| Column | Required | Maps to |
|--------|----------|---------|
| `name` | yes | `create_contact.name` |
| `company` | no | `create_contact.company` |
| `title` | no | `enrich_contact.title` (fill-gaps) |
| `email` | no | primary `channels[]` entry (`channelType: email`) |
| `platform` | no | `upsert_contact_identity.platform` |
| `platform_user_id` | no | `upsert_contact_identity.platformUserId` |
| `platform_handle` | no | `upsert_contact_identity.platformHandle` |
| `profile_url` | no | `upsert_contact_identity.avatarUrl` when `https://` |
| `notes` | no | `enrich_contact.notes` (fill-gaps) |

**JSON:** array of objects with the same keys (camelCase aliases accepted: `platformUserId`, `platformHandle`, `profileUrl`).

Dedupe before create: match on normalized primary `email`, else `(platform, platformUserId)`.

### 4.3 Layer 3 — local mirror (v1.1, optional)

Printing Press archetype **CRM / project management** may add:

- `sync` — pull contacts into local SQLite
- `search` — FTS over local mirror
- `stale --days N` — neglected contacts

Deferred until Layer 2 is shipped and dogfooded.

---

## 5. Integration

### 5.1 Agent workflow briefs

Extend `buildAgentWorkflowBrief` execution requirements:

```bash
# After staging contacts.csv:
signals-pp-cli import contacts \
  --file workflow-runs/<runId>/contacts.csv \
  --dedupe
```

Add explicit prohibitions:

- Do **not** loop `create_contact` manually for bulk imports.
- Do **not** manage Local Apps via `realtimex-pp-cli`.
- Run `signals-pp-cli doctor` when health is uncertain before import.

### 5.2 Workspace provisioning

- Bundle `signals-pp-cli` binary in Signals marketplace / workspace-provision plugin (§6).
- Ship Printing Press–generated skill **or** slim `realtimex-signals` to delegate invoke to CLI.
- **Preflight (recommended):** refuse agent thread dispatch when `GET {signalsBaseUrl}/api/health` ≠ `{ "app": "signals", "status": "ok" }`.

### 5.3 Skills after CLI ships

| Skill | Role |
|-------|------|
| `realtimex-signals` | Playbooks, avatar rules, troubleshooting; prefer `signals-pp-cli` over `invoke-tool.sh` |
| `signals-publish` | Unchanged — multi-step browser publish lane |

### 5.4 Agent Flows

`runCommand` nodes may call `signals-pp-cli import contacts` for deterministic automation without a terminal agent tool loop.

---

## 6. Build & distribution

Follow the **realtimex-sdk** Printing Press pipeline for **generation**, but ship **`signals-pp-cli` in Signals release artifacts** — not as a public npm package like `@realtimex/pp-cli`.

### 6.1 Why artifact-first (not npm)

| | `@realtimex/pp-cli` | `signals-pp-cli` |
|--|---------------------|------------------|
| Scope | RTX platform — every workspace | Signals CRM — Signals workspaces only |
| Version coupling | RTX app + moderator-sdk plugin | Signals app + agent-tools manifest |
| Auth | Terminal session token, `x-app-id` | Localhost + optional `SIGNALS_AGENT_TOOL_TOKEN` |
| Distribution | `npm install -g` (global infrastructure) | Bundled in standalone artifact + marketplace plugin zip |

Artifact shipping avoids version skew between the running Local App and a globally installed CLI, and removes an install step agents often skip.

### 6.2 Build pipeline (mirror realtimex-sdk)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Generate OpenAPI                                              │
│    scripts/generate-agent-tools-openapi.mjs (new)                │
│    → openapi/agent-tools.json                                    │
├─────────────────────────────────────────────────────────────────┤
│ 2. Print CLI (CLI Printing Press)                                │
│    cli-printing-press generate --spec openapi/agent-tools.json   │
│    → tools/signals-pp-cli/source/                                │
├─────────────────────────────────────────────────────────────────┤
│ 3. Patch generated source (Signals-specific)                     │
│    patchSignalsCliSource() — auth, base URL, version pin         │
│    + hand-maintained transcendence: import, reconcile, doctor    │
├─────────────────────────────────────────────────────────────────┤
│ 4. Cross-compile binaries                                        │
│    go build per target → tools/signals-pp-cli/bin/<os>-<arch>/   │
│    + optional Node shim: tools/signals-pp-cli/bin/signals-pp-cli.cjs │
├─────────────────────────────────────────────────────────────────┤
│ 5. Verify                                                        │
│    cli-printing-press scorecard + dogfood on generated source    │
├─────────────────────────────────────────────────────────────────┤
│ 6. Stage into release artifacts                                  │
│    ├─ npm run build:standalone-artifact                          │
│    └─ scripts/package-realtimex-plugin.sh                        │
│         STAGING/tools/signals-pp-cli/…                           │
│         STAGING/skills/realtimex-signals/ → uses bundled CLI     │
└─────────────────────────────────────────────────────────────────┘
```

**Pin** `cli-printing-press` to a specific version in CI (same discipline as RTX `dev-sdk-build.mjs` — unpinned upgrades can break `patchSignalsCliSource()` regexes).

**Prerequisite:** Signals has no `yarn swagger`. Step 1 emits OpenAPI 3.1 from the **agent-tools registry** (Zod schemas in `src/lib/agent-tools/registry.ts` — same source as `GET /api/agent-tools`). See ADR-174-1.

**Source layout after print (ADR-174-5):**

```
tools/signals-pp-cli/
  source/              # Printing Press output (regenerated; do not hand-edit)
  transcendence/       # hand-maintained: import, reconcile, doctor, health
  patch/               # patchSignalsCliSource.mjs
  bin/<os>-<arch>/     # cross-compiled binaries
  bin/signals-pp-cli.cjs
```

Regenerating Printing Press output must not clobber `transcendence/`.

### 6.3 What to copy from realtimex-sdk

| From RTX `dev-sdk-build.mjs` / realtimex-sdk | Signals adaptation |
|----------------------------------------------|-------------------|
| `yarn swagger` → `openapi.json` | `generate-agent-tools-openapi` → `openapi/agent-tools.json` |
| `generate-skill.mjs --printing-press-out` | Same pattern; output to `tools/signals-pp-cli/source/` |
| `patchCliSource()` | `patchSignalsCliSource()` — localhost bearer auth, `SIGNALS_BASE_URL`, not terminal token |
| `buildLocalCliPackage()` + `go build` matrix | Cross-compile into `tools/signals-pp-cli/bin/` |
| `npm pack` + publish to npm | **Do not publish.** Stage binaries in artifact zip only |
| Version from plugin manifest | Version from `package.json` / `realtimex.plugin.json` (same release train as Signals app) |

### 6.4 Artifact layout

**Standalone artifact** (`build:standalone-artifact`):

```
dist/standalone/…/
  tools/signals-pp-cli/
    bin/
      darwin-arm64/signals-pp-cli
      darwin-x64/signals-pp-cli
      linux-arm64/signals-pp-cli
      linux-x64/signals-pp-cli
      signals-pp-cli.cjs          # platform-selecting shim (optional)
```

**Marketplace plugin zip** (`package-realtimex-plugin.sh`):

```
com.realtimex.signals-plugin.zip
  tools/signals-pp-cli/bin/…
  skills/realtimex-signals/      # SKILL.md references bundled CLI
  skills/signals-publish/
  flows/…
  marketplace/release-manifest.json
```

On workspace provision, the plugin installer places the platform-matching binary on the workspace `PATH` (or the skill scripts invoke `tools/signals-pp-cli/bin/signals-pp-cli.cjs` relative to the workspace root).

### 6.5 CI integration

Add to `.github/workflows/plugin-release.yml` (after `build:standalone-artifact`):

1. Install Go + pinned `cli-printing-press`
2. `npm run generate:agent-tools-openapi` (or equivalent)
3. `npm run build:signals-pp-cli` — print, patch, cross-compile, verify
4. `npm run package:realtimex-plugin` — includes CLI in zip
5. Attach plugin zip + standalone artifact to release (existing flow)

**Dev loop:** `npm run build:signals-pp-cli` installs the local binary into the active Signals workspace or puts it on `PATH` for terminal-agent dogfooding (analogous to `dev-sdk-build.mjs` calling `npm install -g` for local RTX dev only — not for end-user distribution).

### 6.6 What we explicitly do not do

- Publish `@signals/pp-cli` or `@realtimex/signals-pp-cli` to npm
- Require `npm install -g` for end users or provisioned workspaces
- Apply RTX terminal-session auth patches to the generated client
- Run `signals-pp-cli` from inside Signals server processes (P6a v1.1)

---

## 7. Out of scope (v1)

- Merging Signals into `realtimex-pp-cli`
- Replacing `signals-publish` browser workflow
- `signals-pp-mcp` (follow-up; Printing Press emits alongside CLI)
- Public npm distribution of `signals-pp-cli`
- Server-side `import_contacts_batch` agent-tool (deferred v1.1 per ADR-174-2)
- pp-cli inside Signals server processes (P6a v1.1 lesson: terminal auth unavailable in Local App executor)

---

## 8. Acceptance criteria

- [ ] OpenAPI spec generated from agent-tools surface in CI
- [ ] `signals-pp-cli` generated via CLI Printing Press from that spec
- [ ] Cross-compiled binaries staged in standalone artifact and marketplace plugin zip
- [ ] `doctor` resolves URL and reports health/auth with typed exit codes
- [ ] `import contacts --file <csv|json> --dedupe` is idempotent; stdout suitable for thread summary
- [ ] `buildAgentWorkflowBrief` references import command for bulk write-back
- [ ] `package-realtimex-plugin.sh` includes `tools/signals-pp-cli/`
- [ ] `realtimex-signals` skill prefers bundled CLI over bash curl wrappers
- [ ] QA reproduces Aug 2026 failure scenario → import succeeds when Signals is running (CLI provisioned with plugin, no global npm install)
- [ ] Printing Press verification passes (dogfood + scorecard)

---

## 9. Implementation slices

| Slice | Deliverable |
|-------|-------------|
| 1 | ~~This spec approved~~ ✓ |
| 2 | `generate-agent-tools-openapi` + `check:agent-tools-openapi` drift gate |
| 3 | `build:signals-pp-cli` — print → `source/`, compose `transcendence/`, patch, cross-compile, verify |
| 4 | `import contacts` + `doctor` + `reconcile` in `transcendence/` |
| 5 | `package-realtimex-plugin.sh` + `build:standalone-artifact` stage `tools/signals-pp-cli/` |
| 6 | Brief + provisioner PATH wiring + **required** dispatch preflight (ADR-174-6) |
| 7 | Skill slim-down; docs update in `docs/agent-tools.md` |
| 8 | Golden tests: import fixture, doctor error codes, brief snippet test; CI plugin-release workflow |

---

## 10. Design decisions (System Design, 2026-08-19)

**ADR-174-1: OpenAPI is codegen from the agent-tools registry, not hand-authored.** — Accepted. `scripts/generate-agent-tools-openapi.mjs` imports `listAgentToolsManifest()` (or equivalent build-time export) and emits `openapi/agent-tools.json` wrapping `GET /api/agent-tools` + `POST /api/agent-tools/invoke` with per-tool `input` schemas. Checked in; CI fails on drift (`npm run check:agent-tools-openapi`). Rationale: registry + Zod is already the manifest source of truth; duplicating OpenAPI by hand will rot.

**ADR-174-2: Client-side batch only in v1; no `import_contacts_batch` agent-tool.** — Accepted. `import contacts` loops `query_contacts` + `create_contact` / `enrich_contact` / `upsert_contact_identity` in chunks of 50, hard cap 500 rows/run. Rationale: ships faster, no server API change; revisit v1.1 only if dogfood shows >30s p95 for 100 rows or repeated `5` errors from overload.

**ADR-174-3: Canonical staged CSV schema is frozen in §4.2.** — Accepted. Agents writing `workflow-runs/<runId>/contacts.csv` must use the column table above; JSON uses the same field names. Briefs should reference this section, not invent per-template columns.

**ADR-174-4: Artifact-only distribution; version locked to Signals release.** — Accepted (§6). No npm publish. CLI version = `package.json` version = plugin `realtimex.plugin.json` version for a given release artifact.

**ADR-174-5: Split generated vs hand-maintained CLI source.** — Accepted. Printing Press writes `tools/signals-pp-cli/source/`; transcendence commands live in `tools/signals-pp-cli/transcendence/` and link against the generated client package. `build:signals-pp-cli` composes both before `go build`. No regen-merge into a single tree.

**ADR-174-6: Dispatch preflight is required for new agent workflow runs.** — Accepted. `runTemplateViaRtx` (and equivalents) must verify `GET {signalsBaseUrl}/api/health` returns `{ app: "signals", status: "ok" }` before creating the thread; fail the run with a user-visible error instead of dispatching an agent into a dead commit path.

---

## 11. References

- Issue: [#174](https://github.com/therealtimex/signals/issues/174)
- PR: [#175](https://github.com/therealtimex/signals/pull/175) (this spec)
- Agent-tools API: `docs/agent-tools.md`
- Workflow brief builder: `src/lib/workflows/template-brief.ts`
- Existing skill: `.claude/skills/realtimex-signals/`
- Plugin packaging: `scripts/package-realtimex-plugin.sh`, `docs/realtimex-marketplace-plugin.md`
- RTX build precedent: [realtimex-sdk](https://github.com/therealtimex/realtimex-sdk), RTX `scripts/dev-sdk-build.mjs`
- Publish lane (separate): `specs/publish-via-terminal-agent.md`
- Pipeline workflows: `specs/contact-profile-pipeline-workflow.md`
- [CLI Printing Press](https://github.com/mvanhorn/cli-printing-press)
- [Agent-native CLI principles](https://trevinsays.com/p/10-principles-for-agent-native-clis)
