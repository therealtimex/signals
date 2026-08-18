# RTX Browser publish (agent lane)

Signals **does not** publish X content in-process. Compose sends drafts to a **RealTimeX terminal agent** via `POST /api/content/send-to-agent`; the agent runs deterministic publish scripts in the `signals-publish` browser session and reports back through agent-tools.

LinkedIn is best-effort (beta): the agent may use interactive browser automation until a deterministic script ships.

## Prerequisites

1. Signals running as a **RealTimeX Local App** (`RTX_APP_ID` + `SERVER_URL`).
2. Manifest permission **`desktop.runtime-sessions`** granted (Local Apps consent).
3. RealTimeX desktop running (relay for terminal agent launch).
4. Skills installed in the Signals workspace: `realtimex-signals` + `signals-publish`.
5. One-time login: open the **`signals-publish`** RTX Browser session from **Settings → Platform Connections → X** and sign in to X (and LinkedIn in the same session when needed).

## User flow

| Step | What happens |
|------|----------------|
| Compose | User drafts in Signals, selects platforms, clicks **Send to agent** |
| CRM | `publish_jobs` row created (`queued`); item → `queued`; RTX thread + terminal agent launched |
| Agent | `get_publish_job` → `x-publish.mjs` over CDP → `complete_publish` per platform |
| List | Row shows `queued` → `publishing` → `published` / `failed`; **Open thread** raises RTX |

## Session doctrine

| Rule | Value |
|------|-------|
| Session name | `signals-publish` |
| Lifecycle | Stop between runs — **never delete** the profile |
| Login recovery | Agent asks in-thread; user signs in via RealTimeX Browser |

## APIs

| Endpoint | Role |
|----------|------|
| `POST /api/content/send-to-agent` | Queue publish job + launch agent |
| `GET /api/content/publish-jobs` | Poll job status from Content list |
| `POST /api/content/publish-jobs/:id/open-thread` | Focus RTX on job thread |
| `POST /api/content/publish` | **410 Gone** — use send-to-agent |

## Agent-tools (publish lane)

- `get_publish_job` — payload snapshot + media paths
- `update_publish_job` — mark platform in-flight
- `complete_publish` — record success/failure; creates `content_posts`

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
