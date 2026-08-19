# Signals smoke tests

Integration smoke tier (`test:integration`) verifies that Signals boots, serves key pages, and exposes working API routes. Implementation uses **Vitest** against a production `next start` server — no browser or Playwright install required.

Runtime Playwright in `src/lib/browser/*` (publish/engage sessions) is separate and slated for agent-browser migration.

## Quick start

```bash
# Build production app first (integration uses next start)
npm run build

# Run integration smoke (starts server via vitest globalSetup)
npm run test:integration
```

Uses port **3456** by default with an isolated SQLite database under `.ci/signals-e2e/`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run test:integration` | Vitest integration project (`src/test/integration/`) |
| `npm run verify:fresh-import` | Import-safety vitest project (no server) |

## What `test:integration` covers

### HTTP (no browser)

1. `/` redirects to `/dashboard`
2. Dashboard HTML includes pipeline / stat copy
3. Contacts and Settings pages return expected HTML

### API

1. `GET /api/health` → `{ status: "ok", app: "signals" }`
2. Contacts list + create + validation error
3. Settings auth metadata (no secrets)
4. Goals list + create
5. `GET /api/rtx/status` manifest + permissions

### Agent tools

1. `GET /api/agent-tools` manifest
2. `invoke` create + enrich contact
3. Unknown tool → 404 `TOOL_NOT_FOUND`

### RTX Local App (optional)

When `RTX_APP_ID` is set, health reports embedded mode.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `E2E_PORT` | `3456` | Server port |
| `SIGNALS_DATA_DIR` | `.ci/signals-e2e` | Hermetic SQLite data |
| `E2E_FRESH_DB` | `1` in CI | Wipe data dir before each run |
| `INTEGRATION_SERVER_LOG` | — | Set `1` to print server stdout/stderr |

## CI

The **Quality gate** job in `.github/workflows/pr-ci.yml` runs:

1. `npm run check` (including the production build)
2. `npm run verify:fresh-import`
3. `npm run test:integration`

Keeping these steps in one job avoids a second dependency install and production
build. `.github/workflows/release.yml` repeats the same gate before building
release artifacts.

No Chromium or Playwright Test install step.

## Adding scenarios

Add specs under `src/test/integration/` with suffix `.integration.test.ts`. Use `smokeFetch` / `smokeJson` from `src/test/integration/http-client.ts`.

Prefer stable API contracts over brittle HTML substring matches when possible.

## Non-goals

- Full Gherkin/BDD suite
- Visual regression or real browser navigation
- OAuth or live platform flows in CI
