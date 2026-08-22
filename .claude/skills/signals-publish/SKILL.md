---
name: signals-publish
description: >-
  Deterministic social publish for Signals CRM via RealTimeX Browser. Use when a
  terminal agent must publish content to X, Facebook, or report LinkedIn beta failures
  from a publish job: resolve the signals-publish browser session, run the platform
  publish script over CDP, and report results via complete_publish agent-tools.
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

**Dependency:** publish scripts delegate browser automation to the host **`agent-browser` CLI** (locked external skill). They do not bundle npm packages.

## Workflow (per publish job)

1. Load `realtimex-signals` and call `get_publish_job` with the job id from the initial message.
2. Read `payload.kind` (`original` when omitted), `payload.platforms`, and any `sourcePostUrl` / `resolvedSourcePostUrl` for repost/quote jobs.
3. For each pending target:
   - Run `signals-pp-cli targets prepare <targetId> --intent publish`. Use the returned `sessionName`, `expectedHandle`, and `lease.leaseId`. If the job is legacy and has no `targetId`, prepare the platform's default target but remember that the job snapshot remains platform-only.
   - Call `update_publish_job` with `status: "publishing"` and `leaseId`. Include `targetId` only when the job target snapshot contains that ID; omit it for a legacy platform-only target.
   - Resolve the returned browser session and note its CDP port.
   - Build `job.json` from the payload (`kind`, `text`, optional `threadTexts`, `sourcePostUrl` / `sourcePostId` / `resolvedSourcePostUrl`, resolved `mediaPaths`) and include the returned `expectedHandle` only when it is a non-null string.
   - Dispatch on **platform + kind**:

| Platform | kind | Script |
|----------|------|--------|
| `x` | `original` (default) | `scripts/x-publish.cjs` |
| `x` | `repost` or `quote` | `scripts/x-publish.cjs` (same script; `kind` in payload) |
| `facebook` | `original` | `scripts/facebook-publish.cjs` |

```bash
node .claude/skills/signals-publish/scripts/x-publish.cjs \
  --port <cdpPort> \
  --payload /tmp/x-publish-job.json
```

```bash
node .claude/skills/signals-publish/scripts/facebook-publish.cjs \
  --port <cdpPort> \
  --payload /tmp/facebook-publish-job.json
```

For QA without sending a public post, add `--dry-run` (fills compose fields, skips Post/Tweet/Repost confirm).

4. Parse the **last stdout line** as JSON. On success call `complete_publish` with `leaseId`, `handle`, `platformPostId`, and `platformUrl`. Include `targetId` only when the job target snapshot contains it; omit `targetId` from both success and failure callbacks for legacy platform-only jobs. On failure pass `leaseId`, optional snapshotted `targetId`, and `error` + `errorCode` (`session_expired`, `captcha`, `upload_failed`, `timeout`, `wrong_account`, `unknown`).
5. Always run `signals-pp-cli targets release --lease <leaseId>` after the completion callback, including failures.
6. **LinkedIn (beta):** shared connections are verify-only. Use a dedicated connection for multiple members; use `agent-browser` interactively or report a clear failure if unsupported.

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
