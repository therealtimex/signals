# signals-pp-cli — Agent-Native CRM CLI (Printing Press)

**Status:** Proposed (System Design deliverable for [#174](https://github.com/therealtimex/signals/issues/174))
**Issue:** [#174](https://github.com/therealtimex/signals/issues/174) · **Related:** [#21](https://github.com/therealtimex/signals/issues/21) `realtimex-signals` skill · [#172](https://github.com/therealtimex/signals/issues/172) thread-attached pipelines · [#118](https://github.com/therealtimex/signals/issues/118) publish lane
**Generator:** [CLI Printing Press](https://github.com/mvanhorn/cli-printing-press)
**Parents:** [`docs/agent-tools.md`](../docs/agent-tools.md), [`src/lib/workflows/template-brief.ts`](../src/lib/workflows/template-brief.ts), `.claude/skills/realtimex-signals/`

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

**Source of truth:** `docs/agent-tools.md` tool catalog. Generator input is the live manifest JSON Schema.

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

- Bundle `signals-pp-cli` binary in Signals marketplace / workspace-provision plugin.
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

## 6. Out of scope (v1)

- Merging Signals into `realtimex-pp-cli`
- Replacing `signals-publish` browser workflow
- `signals-pp-mcp` (follow-up; Printing Press emits alongside CLI)
- Server-side `import_contacts_batch` agent-tool (acceptable fallback if client-side batch is too slow — decision at implementation)
- pp-cli inside Signals server processes (P6a v1.1 lesson: terminal auth unavailable in Local App executor)

---

## 7. Acceptance criteria

- [ ] `signals-pp-cli` generated via CLI Printing Press from `/api/agent-tools` manifest
- [ ] `doctor` resolves URL and reports health/auth with typed exit codes
- [ ] `import contacts --file <csv|json> --dedupe` is idempotent; stdout suitable for thread summary
- [ ] `buildAgentWorkflowBrief` references import command for bulk write-back
- [ ] Workspace plugin documents CLI install path
- [ ] `realtimex-signals` skill prefers CLI over bash curl wrappers
- [ ] QA reproduces Aug 2026 failure scenario → import succeeds when Signals is running
- [ ] Printing Press verification passes (dogfood + scorecard)

---

## 8. Implementation slices

| Slice | Deliverable |
|-------|-------------|
| 1 | This spec approved; NOI + command contracts frozen |
| 2 | `/printing-press` run against agent-tools manifest; publish `signals-pp-cli` to library or Signals repo `tools/` |
| 3 | `import contacts` + `doctor` + `reconcile` transcendence commands |
| 4 | Brief + provisioner + optional dispatch preflight |
| 5 | Skill slim-down; docs update in `docs/agent-tools.md` |
| 6 | Golden tests: import fixture, doctor error codes, brief snippet test |

---

## 9. Open questions (System Design)

1. **Binary distribution:** Signals repo `tools/signals-pp-cli`, separate npm package, or Printing Press library install only?
2. **Batch size / rate limits:** client-side chunking for large CSVs (e.g. 500+ rows)?
3. **CSV schema:** canonical column names for staged `contacts.csv` from agent workflows?
4. **Server tool fallback:** add `import_contacts_batch` to agent-tools if CLI-only batch is insufficient?

---

## 10. References

- Issue: [#174](https://github.com/therealtimex/signals/issues/174)
- Agent-tools API: `docs/agent-tools.md`
- Workflow brief builder: `src/lib/workflows/template-brief.ts`
- Existing skill: `.claude/skills/realtimex-signals/`
- Publish lane (separate): `specs/publish-via-terminal-agent.md`
- Pipeline workflows: `specs/contact-profile-pipeline-workflow.md`
- [CLI Printing Press](https://github.com/mvanhorn/cli-printing-press)
- [Agent-native CLI principles](https://trevinsays.com/p/10-principles-for-agent-native-clis)
