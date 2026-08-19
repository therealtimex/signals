# RTX Browser publish (agent lane)

Signals **does not** publish X content in-process. Compose sends drafts to a **RealTimeX terminal agent** via `POST /api/content/send-to-agent`; the agent runs deterministic publish scripts in the `signals-publish` browser session and reports back through agent-tools.

LinkedIn is best-effort (beta): the agent may use interactive browser automation until a deterministic script ships.

Facebook browser connect is available in Settings for session validation and future agent-browser enrichment; publish is not yet supported on the agent lane.

## Prerequisites

1. Signals running as a **RealTimeX Local App** (`RTX_APP_ID` + `SERVER_URL`).
2. Manifest permission **`desktop.runtime-sessions`** granted (Local Apps consent).
3. RealTimeX desktop running (relay for terminal agent launch).
4. Skills installed in the Signals workspace: `realtimex-signals` + `signals-publish`.
5. One-time login: open a browser connection from **Settings → Platform Connections**, sign in, then add the current acting target. The shared default connection is **`signals-publish`**.

## User flow

| Step | What happens |
|------|----------------|
| Compose | User drafts in Signals, selects platforms, clicks **Send to agent** |
| CRM | `publish_jobs` row created (`queued`); item → `queued`; RTX thread + terminal agent launched |
| Agent | `get_publish_job` → prepare target → publish over CDP → `complete_publish` → release lease |
| List | Row shows `queued` → `publishing` → `published` / `failed`; **Open thread** raises RTX |

## Session doctrine

| Rule | Value |
|------|-------|
| Default session | `signals-publish` (shared by all platforms) |
| Shared concurrency | One whole-operation lease per connection; tabs do not make different-target work safe |
| Dedicated concurrency | Different dedicated connections can execute concurrently |
| Lifecycle | Stop between runs — **never delete** the profile |
| Login recovery | Agent asks in-thread; user signs in via RealTimeX Browser |

### Guardrails

RealTimeX anchors every **named** browser session to the first URL opened in it, so a
shared session would lock itself to whichever platform connected first and reject tab
opens for the others (`The RealTimeX Browser session is locked to https://x.com.`).

Signals therefore declares guardrails itself, on **every** connect — `POST
/cli/create-browser-session` merges them into an existing record, so a session anchored
by an earlier build migrates in place with its profile and logins intact:

| Field | Value |
|-------|-------|
| `mode` | `unrestricted` — no single-origin anchor |
| `allowedOrigins` | Derived from `PLATFORM_URLS` (`x.com`, `www.linkedin.com`, `www.facebook.com`); adding a platform extends it automatically |
| `blockedOrigins` | Empty |

Two properties worth knowing:

- The guardrail check only covers **RTX-routed** tab opens and navigations. In-page
  navigation and redirects are never checked, and CDP clients bypass guardrails entirely
  — which is how session validation and the publish scripts drive the browser. The
  allowlist is blast-radius control on a session holding live logins, not a boundary.
- The registration call carries **no** `url`. A `url` makes RealTimeX start the session
  and open a tab; opening tabs is the caller's job (see below).

### Open vs validate

| Action | Call | Effect |
|--------|------|--------|
| **Open session** (Settings) | `start-browser-session` **with** the platform login URL | Starts the session if stopped, then opens and focuses a tab — including when the session is already running |
| **Validate** | `start-browser-session` **without** a URL | Ensures the session runs, then detects login over CDP in the platform's existing tab |

RealTimeX hosts its own tabs, so a CDP client cannot create one — `newPage()` fails
against the RealTimeX Browser. When validation finds no tab for the platform it therefore
asks RealTimeX to open one at the platform **home** URL (not the login URL, which reads as
logged out until it redirects) and waits for that tab to appear. Validation on a platform
that already has a tab still opens nothing.

Login detection polls: `locator.isVisible()` returns immediately rather than waiting, and
markers are probed one selector at a time — a comma-joined union resolves through
`.first()` to the first match in DOM order, so one hidden early match hides the rest.

## APIs

| Endpoint | Role |
|----------|------|
| `POST /api/content/send-to-agent` | Queue publish job + launch agent |
| `GET /api/content/publish-jobs` | Poll job status from Content list |
| `POST /api/content/publish-jobs/:id/open-thread` | Focus RTX on job thread |
| `POST /api/content/publish` | **410 Gone** — use send-to-agent |

## Agent-tools (publish lane)

- `get_publish_job` — payload snapshot + media paths
- `prepare_platform_target` — acquire the session lease, switch when supported, and verify the live identity
- `update_publish_job` — mark target in-flight and renew its lease
- `complete_publish` — record success/failure and acting `targetId`; creates `content_posts`
- `release_platform_target` — release the lease in a finally/cleanup step

X shared sessions support best-effort account switching. LinkedIn shared sessions are verify-only; use a dedicated connection for multiple members. Facebook profile/Page targets are browse-only in v1. Every mutating X action receives `expectedHandle` and fails closed with `wrong_account` if the browser identity differs.

See `docs/agent-tools.md` and `.claude/skills/signals-publish/SKILL.md`.

## Packaging skills

```bash
scripts/package-realtimex-signals-skill.sh
scripts/package-signals-publish-skill.sh
```

Upload zips to the workspace agent-skills endpoint (see script output).

## Automated tests (no live X login)

```bash
npx vitest run src/lib/publish
```

Verification/selector unit tests run against `src/lib/publish/x-browser/`.

## Related

- Spec: `specs/publish-via-terminal-agent.md`
- Issue: [#118](https://github.com/therealtimex/signals/issues/118)
