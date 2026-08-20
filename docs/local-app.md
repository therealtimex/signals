# Signals as a RealTimeX Local App

Signals is distributed as a **RealTimeX Local App**. Developers can also run it from a private source checkout with `npm run dev`.

## Startup contract

| Item | Value |
|------|-------|
| **Runtime** | RealtimeX-managed Node 22.16.0 (module ABI 127) |
| **Command** | `{runtime.executable}` |
| **Args** | `["server.js"]` |
| **Health check** | `GET /api/health` → `{ status: "ok", app: "signals", rtx: { ... } }` |
| **Home URL** | `http://localhost:{port}/dashboard` |
| **Default port** | `3000` (override with `--port`, `PORT`, or `RTX_PORT`) |
| **Data directory** | `~/.signals/` (override with `SIGNALS_DATA_DIR`) |

See [`rtx-local-app.example.json`](../rtx-local-app.example.json) for the marketplace v2 runtime contract. For current source-checkout QA, use `scripts/qa/provision-signals-local-app.mjs`.

## Environment injection (RTX Electron)

`LocalAppsManager` injects these variables when starting Signals:

| Variable | Purpose |
|----------|---------|
| `RTX_APP_ID` | Local App UUID — enables embedded mode |
| `RTX_APP_NAME` | Display name for SDK registration |
| `RTX_PORT` | Preferred port (Signals also honors `--port`) |
| `SERVER_URL` | RealTimeX Main App API base for SDK calls |
| `REALTIMEX_BASE_URL` | Alternate API base (fallback) |

Inherited from the desktop runtime when available: `SERVER_PORT`, `REALTIMEX_USER_DATA_PATH`, etc.

## SDK bootstrap

On server start (`instrumentation.ts`), when `RTX_APP_ID` is set Signals:

1. Resolves the RTX API base from `SERVER_URL` / `REALTIMEX_BASE_URL` / `RTX_API_BASE_URL`
2. Calls `POST /sdk/register` with permissions from [`rtx-manifest.json`](../rtx-manifest.json)
3. Calls `GET /sdk/ping` to verify connectivity

### Requested permissions

Terminal agents own open-ended intelligence: they read evidence (`get_persona_evidence`) and write conclusions (`upsert_persona`) with their own reasoning, and no `workflow_runs` row is fabricated for that compute. Signals requests `llm.chat` solely for **structured, schema-validated workflow synthesis** it orchestrates itself (persona generation; future workflow migrations per ADR-022-9) — always provenance-tracked via `workflow_runs`, never conversational.

| Permission | Why |
|------------|-----|
| `credentials.list` | Discover platform credential metadata via RTX broker |
| `credentials.use` | Use bounded credential broker for OAuth/sync |
| `webhook.trigger` | Allow RTX flows to trigger agent tasks against Signals |
| `llm.embed` | On-demand embedding for semantic search (vectors stay local in Signals) |
| `llm.chat` | Structured persona synthesis workflow (`generate_persona`) |

### RealTimeX host dependency (`llm.chat`)

Persona generation records `${provider}:${model}` provenance on every `workflow_runs` row. Signals **rejects** `POST /sdk/llm/chat` responses that omit `response.provider` or `response.model` (no client-side fabrication).

Deploy Signals persona generation only with a RealTimeX Main App build that includes the SDK chat response contract (`response.provider` + `response.model` in the sync chat payload). See RTX `docs/local-apps/sdk-llm-proxy.md` §3.2 and `server/endpoints/sdk/llm.js` (tracked regression: `server/__tests__/endpoints/sdk/llm.test.js`).

## Removed embedded features (#4)

The following no longer run inside Signals:

- Cmd+K chat panel and `/api/chat` — use RealTimeX workspace threads
- In-process agent tool loops — use RTX agents + `/api/agent-tools/invoke`
- Content AI routes (`/api/content/ai-generate`) — use RTX creative flows

See `docs/rtx-agent-orchestration.md` for migration guidance.

See also `docs/realtimex-local-app.md` for the full RTX integration map.

## Removed Playwright enrichment (#5)

Profile scraping for contact enrichment no longer runs inside Signals:

- `sync-x-profiles` / `/api/platforms/x/enrich` — delegate to RTX agent-browser
- In-process scrapers (`x-scraper`, `browser-scrape` tool) — removed

Publish and engage browser flows still use Signals-managed sessions. See `docs/rtx-agent-browser-enrichment.md`.

## Modes

| Mode | Detection | Browser |
|------|-----------|---------|
| **Standalone** | No `RTX_APP_ID` | CLI opens browser after boot |
| **Embedded** | `RTX_APP_ID` set | RTX shell embeds UI; no auto-open |

## Debugging

- `GET /api/health` — lightweight probe (used by smoke tests + RTX health checks)
- `GET /api/rtx/status` — manifest, permissions, and last bootstrap result

## Local development

Use `nvm use` from the repository root before installing dependencies. The checked-in `.nvmrc`, release builders, and runtime startup guard all require Node `22.16.0` / ABI `127`, matching the RealtimeX host and preventing native `better-sqlite3` ABI mismatches.

```bash
# Standalone (default)
nvm use
npm run dev

# Simulate embedded mode against a local RTX server
RTX_APP_ID=your-local-app-uuid \
SERVER_URL=http://127.0.0.1:3001 \
RTX_PORT=3000 \
npm run dev
```

Register the app in **Settings → Local Apps** first so `/sdk/register` resolves the app id.

For headless QA against the canonical dev app id (`47e45f71-3279-42f5-8e95-731de01b6eae`), upsert it into the RTX SQLite database when missing:

```bash
node scripts/qa/provision-signals-local-app.mjs
# or: node scripts/qa/provision-signals-local-app.mjs --db /path/to/realtimex.db
```

This pre-grants manifest permissions so `/sdk/register` and `/sdk/ping` succeed without an Electron permission prompt.

**Agent Workflow Run QA** (issue #153) uses the same `desktop.runtime-sessions` bridge as publish. If `POST /api/workflows/templates/{id}/run` returns `503` with a plain `Not Found` body, the RealTimeX host at `SERVER_URL` / `RTX_API_BASE_URL` does not expose `/sdk/desktop/runtime-sessions/*` — update or restart the RealTimeX desktop app, confirm `desktop.runtime-sessions` is granted, and re-run `provision-signals-local-app.mjs` if needed.

**Agent workflow preflight** (issue #157):

1. Signals Local App **running** (`curl -s http://localhost:3000/api/health` — use your actual port).
2. Plugin workspace provision deployed with `realtimex-signals` skill: `node scripts/qa/verify-signals-plugin-provision.mjs`.
3. Run a built-in template → **Run Agent**; confirm the RTX thread brief `Signals base URL` matches step 1 and the agent can `GET {base}/api/agent-tools`.

### Embedded-host QA (`generate_persona`)

Unit tests mock RTX chat. To verify persisted `provider:model` provenance against a real owned RTX dev host:

1. **RTX co-requisite worktree** (not the main checkout — `rtxtest` refuses main):
   ```bash
   RTX_REPO="$PWD/../../worktrees/realtimex-ai-app-issue-64-sdk-llm-chat-provenance"
   RTXTEST="$PWD/../../.claude/skills/rtx-test-runner/scripts/bin/rtxtest"
   RTXTEST_TARGET=local node "$RTXTEST" dev up --repo "$RTX_REPO" --electron-no-sandbox
   ```
   Branch: `issue-64-sdk-llm-chat-provenance` @ MR !1684 (`response.provider` + `response.model` on `POST /sdk/llm/chat`).

2. **Signals Local App permissions** — grant `llm.chat` (and keep `llm.embed`) for the Signals app in **Settings → Local Apps**. Default dev app id: `47e45f71-3279-42f5-8e95-731de01b6eae`.

3. **Chat provider** — the RTX host must return a successful chat with `response.provider` and `response.model` (probe: `POST /sdk/llm/chat` with `x-app-id`).

4. **Run embedded QA** from the Signals worktree:
   ```bash
   ./scripts/qa/run-embedded-generate-persona.sh --prime-llm
   ```
   `--prime-llm` fetches a LiteLLM virtual key from the canonical signed-in dev profile, persists it to the worktree DB, restarts the owned RTX dev session, then runs the gated vitest project. Manual alternative: `node "$RTX_REPO/scripts/qa/persist-embedded-llm-credentials.mjs"` then restart RTX dev.

   Or explicitly: `SIGNALS_EMBEDDED_QA=1 RTX_APP_ID=... SERVER_URL=http://127.0.0.1:<port> npx vitest run --project embedded src/lib/workflows/generate-persona.embedded.test.ts`

`SERVER_URL` defaults to `RTX_REPO/tmp/dev-runtime/endpoints.json` → `serverUrl` when the owned dev session is running.

## References

- Integration map: [`docs/realtimex-local-app.md`](./realtimex-local-app.md)
- Epic #1 / issue #2
- RTX: [Local Apps architecture](https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/blob/realtimex-dev/docs/local-apps/architecture.md)
- RTX: `frontend/src/electron/features/local-apps/LocalAppsManager.cjs`
