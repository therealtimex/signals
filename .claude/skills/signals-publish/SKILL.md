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
| Default session | `signals-publish` (canonical shared connection) |
| Lifecycle | **Stop** between runs — never delete the profile |
| Login | User signs in via RealTimeX Browser when `session_expired` |
| Concurrency | Hold the target lease for the full prepare → act → callback operation |

Resolve/create/start the session with `realtimex-pp-cli` or the `agent-browser` skill before running publish scripts.

**Dependency:** `x-publish.cjs` delegates browser automation to the host **`agent-browser` CLI** (locked external skill). It does not bundle npm packages.

## Workflow (per publish job)

1. Load `realtimex-signals` and call `get_publish_job` with the job id from the initial message.
2. For each pending X target:
   - Run `signals-pp-cli targets prepare <targetId> --intent publish`. Use the returned `sessionName`, `expectedHandle`, and `lease.leaseId`. If the job is legacy and has no `targetId`, use its platform/default target fallback.
   - Call `update_publish_job` with `status: "publishing"`, `targetId`, and `leaseId`.
   - Resolve the returned browser session and note its CDP port.
   - Build `job.json` from the payload (`text`, optional `threadTexts`, resolved `mediaPaths`) and include the returned `expectedHandle`.
   - Run:

```bash
node .claude/skills/signals-publish/scripts/x-publish.cjs \
  --port <cdpPort> \
  --payload /tmp/x-publish-job.json
```

For QA without sending a public post, add `--dry-run` (fills compose and thread fields, skips Tweet).

3. Parse the **last stdout line** as JSON. On success call `complete_publish` with `targetId`, `leaseId`, `handle`, `platformPostId`, and `platformUrl`. On failure pass `targetId`, `leaseId`, `error` + `errorCode` (`session_expired`, `captcha`, `upload_failed`, `timeout`, `wrong_account`, `unknown`).
4. Always run `signals-pp-cli targets release --lease <leaseId>` after the completion callback, including failures.
5. **LinkedIn (beta):** shared connections are verify-only. Use a dedicated connection for multiple members; use `agent-browser` interactively or report a clear failure if unsupported.

## Error handling

| errorCode | Agent action |
|-----------|--------------|
| `session_expired` | Ask user to sign in in RealTimeX Browser `signals-publish`, then retry |
| `captcha` | Report in thread; `complete_publish` failure — do not solve |
| `upload_failed` | Report media issue; fail target |
| `timeout` | Retry once or fail with note |
| `wrong_account` | Do not publish; re-run target preparation or ask the user to activate the expected account |

## Related

- CRM tools: `.claude/skills/realtimex-signals/SKILL.md`
- Selector table + verification invariants: `reference.md`
- Spec: `specs/publish-via-terminal-agent.md`
