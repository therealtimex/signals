# RTX Browser publish (X)

Signals publishes X content through **RealTimeX Browser** and Playwright-over-CDP — not in-process Playwright launches and not the X write API.

LinkedIn publish still uses the legacy Signals browser session until P6b.

## Prerequisites

1. Signals running as a **RealTimeX Local App** (`RTX_APP_ID` + `SERVER_URL`). Browser sessions use the RTX `/cli/*-browser-session` HTTP API with `x-app-id` (Approved v1.1 — `specs/p6a-rtx-x-publish.md` §4.3).
2. The RealTimeX host must mount **`/sdk/desktop/browser/*`** (desktop browser relay) so Signals can probe login via `evaluate-tab` on BrowserView tabs. Dev hosts that only mount `/sdk/register` + `/sdk/llm` will return 404 and block publish.
3. Dev override: `SIGNALS_RTX_CDP_PORT` pointing at a live CDP port.
3. One-time login: open the **`signals-publish`** RTX Browser session and sign in to X.

## Session lifecycle

| Step | Behavior |
|------|----------|
| First publish | Creates/starts `signals-publish` via RTX `/cli/*-browser-session` API, opens `https://x.com/home` |
| Auto publish | Fills compose, posts, disconnects CDP, **stops** session (profile kept) |
| Review publish | Fills compose, leaves RTX Browser open for manual Post |
| Login missing | `session_expired` — sign in via RealTimeX Browser |

Login preflight accepts desktop or mobile chrome (`primaryColumn`, compose button, account switcher, or profile nav link).

## API

`POST /api/content/publish` with `platform: "x"` — same contract as before. Platform account rows are **ensured** automatically (`auth_type: "session"` when no OAuth row exists).

**Compose UI:** the **Publish** button (Auto/Review) saves a draft then calls `/api/content/publish`. **API Publish** remains the legacy OAuth X API path (`/api/platforms/x/compose` without `saveAsDraft`) and requires a connected OAuth account.

## Dev override

```bash
export SIGNALS_RTX_CDP_PORT=9222   # attach directly; skips RTX session API
```

## QA manual validation (P6a)

Use an **isolated safe test X account** — never production credentials. QA on 2026-08-16 confirmed the unsigned `signals-publish` profile correctly surfaces `session_expired` (login page: “Happening now” + sign-in controls; no `primaryColumn` or logged-in handle).

### Prerequisites to unblock live QA

1. **Branch:** `issue-6` in `therealtimex/signals`.
2. **Session:** RealTimeX Browser profile `signals-publish` (X-only; do not delete between runs — stop only).
3. **Login:** Sign in to X inside `signals-publish` with the safe test account. Confirm `https://x.com/home` shows `primaryColumn` and a profile handle.
4. **Attach (optional CDP probe):** Start session, note `remoteDebugPort` (QA used `9228`), connect Playwright over CDP to the `https://x.com/` content tab (ignore Electron shell / sign-in popups).

### Scenarios after login

| Scenario | Expected |
|----------|----------|
| Publish while logged out | `session_expired` before compose (preflight) |
| Auto publish | New owned post on profile; `content_posts` updated |
| Review publish | Compose filled; manual Post; verification succeeds |
| Retweet-only / zero-owned timeline | Baseline capture succeeds; new owned post verifies |

### Automated gate (no X write)

```bash
npx vitest run src/lib/browser/rtx-publish
```

40 unit tests cover session client, baseline completeness, and verification boundaries.

## Related

- Spec: `specs/p6a-rtx-x-publish.md`
- Enrichment (separate flow): `docs/rtx-agent-browser-enrichment.md`
- Parent issue: [#6](https://github.com/therealtimex/signals/issues/6)
