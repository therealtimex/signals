# Signals smoke tests

End-to-end smoke tier (`smoke:core`) verifies that Signals boots, serves the dashboard, and exposes working API routes. Implementation uses **Playwright** (`@playwright/test`) — distinct from production Playwright browser automation slated for removal in #5/#6.

## Quick start

```bash
# One-time: install Chromium for Playwright
npx playwright install chromium

# Run smoke (builds server via webServer hook on first run)
npm run smoke:core
```

`smoke:core` starts a production Next.js server on port **3456** with an isolated SQLite database under `.ci/signals-e2e/`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run smoke:core` | Playwright smoke suite (`e2e/smoke/`) |
| `npm run test:e2e` | Alias for full Playwright run |
| `npm run test:e2e:ui` | Playwright UI mode (debugging) |

## What `smoke:core` covers

### UI

1. `/` redirects to `/dashboard`
2. Dashboard renders stat cards and pipeline section
3. Contacts page loads (empty state OK)
4. Settings page loads
5. Sidebar navigation: Contacts → Settings

### API

1. `GET /api/health` → `{ status: "ok", app: "signals" }`
2. Contacts list + create + validation error
3. Settings auth metadata (no secrets)
4. Goals list + create

### RTX Local App (optional)

When `RTX_APP_ID` is set, health reports the app id. Full SDK registration smoke lands with Local App bootstrap (#2).

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `E2E_PORT` | `3456` | Server port for smoke |
| `SIGNALS_DATA_DIR` | `.ci/signals-e2e` | Hermetic SQLite data |
| `E2E_FRESH_DB` | `1` | Wipe data dir before each run |
| `PLAYWRIGHT_BASE_URL` | — | Skip webServer; point at running instance |

## CI

The **Smoke** job in `.github/workflows/ci.yml` runs after the quality gate:

1. `npm run build`
2. `npx playwright install chromium --with-deps`
3. `npm run smoke:core`

CI sets `SIGNALS_DATA_DIR` to `${{ github.workspace }}/.ci/signals-e2e`.

## Adding scenarios

Place new specs under `e2e/smoke/`. Prefix files with order when tests share state (`01-core.spec.ts` before `02-api.spec.ts`). Prefer stable selectors:

- `getByRole("heading", { name: "..." })`
- `getByRole("link", { name: "..." })`

Avoid coupling to CSS class names or animation timing.

## Non-goals (see #20)

- Full Gherkin/BDD suite
- Visual regression
- Browser enrichment or OAuth flows (require external credentials)
