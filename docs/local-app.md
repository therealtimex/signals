# Signals as a RealTimeX Local App

Signals can run standalone (`npx @realtimex/signals`) or as a **RealTimeX Local App** managed by the RTX Electron shell.

## Startup contract

| Item | Value |
|------|-------|
| **Command** | `npx` |
| **Args** | `["-y", "@realtimex/signals", "--port", "3000"]` |
| **Health check** | `GET /api/health` → `{ status: "ok", app: "signals", rtx: { ... } }` |
| **Home URL** | `http://localhost:{port}/dashboard` |
| **Default port** | `3000` (override with `--port`, `PORT`, or `RTX_PORT`) |
| **Data directory** | `~/.signals/` (override with `SIGNALS_DATA_DIR`) |

See [`rtx-local-app.example.json`](../rtx-local-app.example.json) for a copy-paste Local Apps admin config.

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

On server start (`src/instrumentation.ts`), when `RTX_APP_ID` is set Signals:

1. Resolves the RTX API base from `SERVER_URL` / `REALTIMEX_BASE_URL` / `RTX_API_BASE_URL`
2. Calls `POST /sdk/register` with permissions from [`rtx-manifest.json`](../rtx-manifest.json)
3. Calls `GET /sdk/ping` to verify connectivity

### Requested permissions

Signals intentionally does **not** request `llm.chat` — terminal agents own intelligence (#4).

| Permission | Why |
|------------|-----|
| `credentials.list` | Discover platform credential metadata via RTX broker |
| `credentials.use` | Use bounded credential broker for OAuth/sync |
| `webhook.trigger` | Allow RTX flows to trigger agent tasks against Signals |

## Modes

| Mode | Detection | Browser |
|------|-----------|---------|
| **Standalone** | No `RTX_APP_ID` | CLI opens browser after boot |
| **Embedded** | `RTX_APP_ID` set | RTX shell embeds UI; no auto-open |

## Debugging

- `GET /api/health` — lightweight probe (used by smoke tests + RTX health checks)
- `GET /api/rtx/status` — manifest, permissions, and last bootstrap result

## Local development

```bash
# Standalone (default)
npm run dev

# Simulate embedded mode against a local RTX server
RTX_APP_ID=your-local-app-uuid \
SERVER_URL=http://127.0.0.1:3001 \
RTX_PORT=3000 \
npm run dev
```

Register the app in **Settings → Local Apps** first so `/sdk/register` resolves the app id.

## References

- Epic #1 / issue #2
- RTX: `docs/local-apps/architecture.md`
- RTX: `frontend/src/electron/features/local-apps/LocalAppsManager.cjs`
