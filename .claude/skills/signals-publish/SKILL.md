---
name: signals-publish
description: >-
  Deterministic social publish for Signals CRM via RealTimeX Browser. Use when a
  terminal agent must publish content to X (or report LinkedIn beta failures)
  from a publish job: resolve the signals-publish browser session, run the
  x-publish script over CDP, and report results via complete_publish agent-tools.
author: RealtimeX
license: Apache-2.0
allowed-tools: Read Bash
---

# Signals Publish

Publish content from **Signals** publish jobs through a named RealTimeX Browser session and deterministic CDP scripts. The terminal agent owns browser session lifecycle; Signals owns CRM state via agent-tools.

## Session doctrine

| Rule | Value |
|------|-------|
| Session name | `signals-publish` (canonical) |
| Lifecycle | **Stop** between runs — never delete the profile |
| Login | User signs in via RealTimeX Browser when `session_expired` |

Resolve/create/start the session with `realtimex-pp-cli` or the `agent-browser` skill before running publish scripts.

## Workflow (per publish job)

1. Load `realtimex-signals` and call `get_publish_job` with the job id from the initial message.
2. For each pending X target:
   - Call `update_publish_job` with `status: "publishing"` and `platform: "x"`.
   - Ensure `signals-publish` browser session is running; note the CDP port.
   - Build `job.json` from the payload (`text`, optional `threadTexts`, resolved `mediaPaths`).
   - Run:

```bash
node .claude/skills/signals-publish/scripts/x-publish.mjs \
  --port <cdpPort> \
  --payload /tmp/x-publish-job.json
```

3. Parse the **last stdout line** as JSON. On success call `complete_publish` with `handle`, `platformPostId`, `platformUrl`. On failure pass `error` + `errorCode` (`session_expired`, `captcha`, `upload_failed`, `timeout`, `unknown`).
4. **LinkedIn (beta):** no deterministic script in v1. Use `agent-browser` interactively or call `complete_publish` with `success: false` and a clear error if unsupported.

## Error handling

| errorCode | Agent action |
|-----------|--------------|
| `session_expired` | Ask user to sign in in RealTimeX Browser `signals-publish`, then retry |
| `captcha` | Report in thread; `complete_publish` failure — do not solve |
| `upload_failed` | Report media issue; fail target |
| `timeout` | Retry once or fail with note |

## Related

- CRM tools: `.claude/skills/realtimex-signals/SKILL.md`
- Selector table + verification invariants: `reference.md`
- Spec: `specs/publish-via-terminal-agent.md`
