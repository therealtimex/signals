# RTX Browser publish (agent lane)

Signals **does not** publish X content in-process. Compose sends drafts to a **RealTimeX terminal agent** via `POST /api/content/send-to-agent`; the agent runs deterministic publish scripts in the `signals-publish` browser session and reports back through agent-tools.

LinkedIn is best-effort (beta): the agent may use interactive browser automation until a deterministic script ships.

Facebook publish runs on the same agent lane as X via `facebook-publish.cjs` inside the `signals-publish` skill. Browser connect in Settings still handles session validation and target registration.

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

Signals therefore declares guardrails itself, on **every** connect, for the session of the
connection it is driving. `POST /cli/create-browser-session` on an existing session replaces
each guardrail key the request carries and keeps the others, so a session anchored by an
earlier build migrates in place with its profile and logins intact. Signals sends only these
three keys; RealTimeX keeps `primaryOrigin`, `allowNewTab` and `allowCloseTab`:

| Field | Value |
|-------|-------|
| `mode` | `unrestricted` — no single-origin anchor |
| `allowedOrigins` | The Signals defaults plus the websites the user allowed for **this** connection (#547). Defaults come from `PLATFORM_URLS` and each platform's `extraOrigins`: `https://x.com`, `https://www.linkedin.com`, `https://lnkd.in` (LinkedIn short links), `https://www.facebook.com`. Adding a platform extends them automatically. |
| `blockedOrigins` | Empty |

Because RealTimeX replaces `allowedOrigins` rather than merging it, Signals always sends the
complete list. User additions live in the `browser_connection_origins` table, so a reconnect
or another client's re-declare can't lose them: the next connect puts them back.

**Allowed websites** (Settings → Platforms) adds or removes a website for one connection: it
saves the normalized origin (`URL.origin`, the same string RealTimeX compares), re-declares the
full list and reads it back with `list-browser-sessions`. The UI says a website is active only
when RealTimeX holds it. A run that RealTimeX refused (`The RealTimeX Browser session does not
allow <origin>.`) shows the denied website with an **Allow website…** action on the run page.
The API is `/api/browser-connections/[id]/allowed-origins`; see
[`specs/browser-allowed-websites.md`](../specs/browser-allowed-websites.md).

Allowing a website only lets the browser open it. It authorizes no publishing, messaging or
other outbound action.

Two properties worth knowing:

- The guardrail check only covers **RTX-routed** tab opens and navigations, against the
  origin of the URL requested. In-page navigation and redirects are never checked, and CDP
  clients bypass guardrails entirely — which is how session validation and the publish
  scripts drive the browser. Allowing `https://lnkd.in` adds exactly that origin; it does not
  authorize where a short link redirects, and nothing in Signals widens the list to make a
  redirect pass. RealTimeX enforcing the list on redirects is
  [realtimex-ai-app#2502](https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/issues/2502).
  The allowlist is blast-radius control on a session holding live logins, not a boundary.
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

X shared sessions support best-effort account switching. LinkedIn shared sessions are verify-only; use a dedicated connection for multiple members. Facebook profile/Page targets support original-post publish on the agent lane; repost/quote jobs remain X-only in v1. When target preparation returns a non-null `expectedHandle`, mutating actions include it and fail closed with `wrong_account` if the browser identity differs.

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
