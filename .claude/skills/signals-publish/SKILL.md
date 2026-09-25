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

1. Load `realtimex-signals` and call `get_publish_job` with the job id from the initial message. Before opening a browser composer, confirm the job names an existing Signals Content item and the requested target is pending. If no job exists, create or materialize the Content item through the applicable Signals writing or Compose path, then use `send-to-agent` to create a job. Never publish directly in a browser and reconcile Contents afterward as the normal path.
2. Read `payload.kind` (`original` when omitted), `payload.platforms`, and any `sourcePostUrl` / `resolvedSourcePostUrl` for repost/quote jobs.
3. For each pending target:
   - Run `signals-pp-cli targets prepare <targetId> --intent publish`. Use the returned `sessionName`, `expectedHandle`, and `lease.leaseId`. If the job is legacy and has no `targetId`, prepare the platform's default target but remember that the job snapshot remains platform-only.
   - Call `update_publish_job` with `status: "publishing"` and `leaseId`. Include `targetId` only when the job target snapshot contains that ID; omit it for a legacy platform-only target.
   - Resolve the returned browser session and note its CDP port.
   - Build `job.json` from the payload (`kind`, `text`, optional `threadTexts`, `sourcePostUrl` / `sourcePostId` / `resolvedSourcePostUrl`, resolved `mediaPaths`) and include `jobId`, `contentItemId`, and the snapshotted `targetId` when present. Include the returned `expectedHandle` only when it is a non-null string. Set `SIGNALS_BASE_URL` to the exact local app origin from the brief. Live X and Facebook scripts check the job, Content item, target, text, and media against Signals before any browser action; `--dry-run` skips that check because it never submits a public post.
   - Dispatch on **platform + kind**:

| Platform | kind | Script |
|----------|------|--------|
| `x` | `original` (default) | `scripts/x-publish.cjs` |
| `x` | `repost` or `quote` | `scripts/x-publish.cjs` (same script; `kind` in payload) |
| `x` | outbound reply (Social Intent Patrol, not a publish job) | `scripts/x-reply.cjs` |
| `facebook` | `original` | `scripts/facebook-publish.cjs` |

```bash
node .claude/skills/signals-publish/scripts/x-publish.cjs \
  --port <cdpPort> \
  --payload /tmp/x-publish-job.json
```

```bash
node .claude/skills/signals-publish/scripts/x-reply.cjs \
  --port <cdpPort> \
  --payload /tmp/x-reply.json
```

```bash
node .claude/skills/signals-publish/scripts/facebook-publish.cjs \
  --port <cdpPort> \
  --payload /tmp/facebook-publish-job.json
```

For QA without sending a public post, add `--dry-run` (fills compose fields, skips Post/Tweet/Repost/Reply confirm).

### X compose insertion (Draft.js / Lexical)

X's inline and modal composers serialize **only the focused active block** if paragraphs were inserted with separate `insertParagraph` / per-line `insertText` calls. `innerText` can still show every line.

- Inject the entire string with **one** CDP `Input.insertText` (`agent-browser keyboard inserttext` in `x-publish.cjs` / `x-reply.cjs`). Do not use `document.execCommand("insertText"|"selectAll"|"delete")`.
- Never type line-by-line, press Enter between paragraphs, or split the payload.
- Before clicking Tweet / `[data-testid="tweetButtonInline"]` (or modal `[data-testid="tweetButton"]`), assert Draft-owned leaf text (`span[data-text="true"]`) and, when readable, EditorState `getPlainText()` match the draft paragraph structure. DOM `innerText` alone is not enough. Keep a readable EditorState even when it disagrees with the DOM — that desync is the issue's failure mode and must fail closed. Re-inject once on mismatch; if it still diverges, abort the command. Do not submit.
- After `[data-testid="reply"]`, prefer a visible `[role="dialog"] [data-testid="tweetTextarea_0"]` with its scoped `[data-testid="tweetButton"]`. Only use the unscoped inline composer + `tweetButtonInline` when no reply dialog is present. Clicking the unscoped textarea while the dialog is open hits the covered inline box.
- `x-reply.cjs` must not treat the Reply click as success. It confirms the **full** drafted text on the acting profile's `/with_replies` timeline (tweet body, not article chrome) and prints that reply's `platformPostId` / `platformUrl`. If confirmation fails after the click, it returns `verify_uncertain` — do **not** click Reply again.

4. Parse the **last stdout line** as JSON. On success call `complete_publish` with `leaseId`, `handle`, `platformPostId`, and the verified post permalink as `platformUrl`. Include `targetId` only when the job target snapshot contains it; omit `targetId` from both success and failure callbacks for legacy platform-only jobs. On failure pass `leaseId`, optional snapshotted `targetId`, and `error` + a supported callback `errorCode` (`session_expired`, `captcha`, `upload_failed`, `timeout`, `wrong_account`, `unknown`). Do not report a platform home page or a fabricated post ID as a verified result. If Facebook returns `postSubmitted: true` and `verify_uncertain`, inspect the acting profile's timeline and open the matching new post. Call `complete_publish` with its real permalink and post ID only after verifying it; otherwise report the uncertainty and use `unknown` for the failure callback. Never click Post again to resolve an uncertain result.
   - After a successful callback, call `get_content` for the job's Content item. Confirm `status: published`, the platform permalink, and the expected media attachment. If any check fails, report the discrepancy and reconcile the existing post; never submit the browser post again.
5. Always run `signals-pp-cli targets release --lease <leaseId>` after the completion callback, including failures.
6. **LinkedIn (beta):** shared connections are verify-only. Use a dedicated connection for multiple members; use `agent-browser` interactively or report a clear failure if unsupported.

## Error handling

| errorCode | Agent action |
|-----------|--------------|
| `session_expired` | Ask user to sign in in RealTimeX Browser `signals-publish`, then retry |
| `captcha` | Report in thread; `complete_publish` failure — do not solve |
| `upload_failed` | Report media issue; fail target |
| `timeout` | Retry once or fail with note — **except after an X Reply click** |
| `verify_uncertain` | A post or reply was already clicked. Do **not** retry; inspect the acting profile's timeline for the full text and permalink before the callback |
| `wrong_account` | Do not publish; re-run target preparation or ask the user to activate the expected account |

## Related

- CRM tools: `.claude/skills/realtimex-signals/SKILL.md`
- Writing approval/materialization: `.claude/skills/signals-writing/SKILL.md` — approved items arrive with publish `text` and `threadTexts` derived from persisted ordered units
- Selector table + verification invariants: `reference.md`
- Spec: `specs/publish-via-terminal-agent.md`
