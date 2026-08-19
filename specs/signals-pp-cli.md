# signals-pp-cli — Agent-Native CRM CLI (Printing Press)

**Status:** Proposed (System Design deliverable for [#174](https://github.com/therealtimex/signals/issues/174))
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

**Dedupe keys (v1):** primary email, then `(platform, platformUserId)` when present.

**Stdout (last line, JSON):**

```json
{
  "success": true,
  "created": 18,
  "skipped": 4,
  "enriched": 2,
  "failed": 0,
  "errors": []
}
```

**Exit codes:** `0` all succeeded or skipped cleanly · `5` partial failure (some rows failed) · `4` auth · `3` file not found · `5` + `SIGNALS_NOT_RUNNING` when health check fails.

**Idempotency:** re-running import with same file should skip existing contacts (dedupe), not duplicate.

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
│    + optional Node shim: tools/signals-pp-cli/bin/signals-pp-cli.js │
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

**Prerequisite:** Signals does not have `yarn swagger` today. Step 1 must export OpenAPI from the agent-tools routes or convert the live manifest JSON Schema into OpenAPI 3.1. The generated spec is checked in or emitted as a CI artifact; Printing Press consumes it.

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
      signals-pp-cli.js          # platform-selecting shim (optional)
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

On workspace provision, the plugin installer places the platform-matching binary on the workspace `PATH` (or the skill scripts invoke `tools/signals-pp-cli/bin/signals-pp-cli.js` relative to the workspace root).

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
- Server-side `import_contacts_batch` agent-tool (acceptable fallback if client-side batch is too slow — decision at implementation)
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
| 1 | This spec approved; NOI + command contracts frozen |
| 2 | `generate-agent-tools-openapi` script + checked-in or CI-emitted `openapi/agent-tools.json` |
| 3 | `build:signals-pp-cli` — Printing Press generate, `patchSignalsCliSource`, cross-compile, verify |
| 4 | `import contacts` + `doctor` + `reconcile` transcendence commands |
| 5 | `package-realtimex-plugin.sh` + `build:standalone-artifact` stage `tools/signals-pp-cli/` |
| 6 | Brief + provisioner PATH wiring + optional dispatch preflight |
| 7 | Skill slim-down; docs update in `docs/agent-tools.md` |
| 8 | Golden tests: import fixture, doctor error codes, brief snippet test; CI plugin-release workflow |

---

## 10. Open questions (System Design)

1. ~~**Binary distribution:** npm vs artifact?~~ **Resolved:** artifact-only (§6). No public npm package.
2. **OpenAPI source:** generate from Next.js route handlers vs maintain hand-authored spec that tracks `docs/agent-tools.md`?
3. **Batch size / rate limits:** client-side chunking for large CSVs (e.g. 500+ rows)?
4. **CSV schema:** canonical column names for staged `contacts.csv` from agent workflows?
5. **Server tool fallback:** add `import_contacts_batch` to agent-tools if CLI-only batch is insufficient?
6. **Transcendence maintenance:** regen-merge Printing Press output without clobbering hand-written `import` / `reconcile` commands?

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
