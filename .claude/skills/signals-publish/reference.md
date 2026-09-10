# signals-publish reference

## x-publish.cjs CLI

Requires **`agent-browser`** on PATH (locked external skill). The script delegates CDP automation to the CLI; it does not bundle npm packages.

```bash
node scripts/x-publish.cjs --port <cdpPort> --payload <job.json> [--dry-run]
node scripts/x-reply.cjs --port <cdpPort> --payload <reply.json> [--dry-run]
```

### Payload (`job.json`)

```jsonc
{
  "text": "Main post body",
  "threadTexts": ["optional tweet 2", "tweet 3"],
  "mediaPaths": ["/abs/path/img.png"],
  "expectedHandle": "@handle"   // required for target-aware jobs
}
```

`mediaPaths` may be `string[]` for a single post, or nested arrays per thread tweet.

### stdout (last line)

Success:

```json
{"success":true,"handle":"@user","platformPostId":"123","platformUrl":"https://x.com/user/status/123"}
```

Failure:

```json
{"success":false,"error":"…","errorCode":"session_expired|captcha|upload_failed|timeout|wrong_account|unknown"}
```

## X selectors (fragility surface)

| Key | Selector |
|-----|----------|
| primaryColumn | `[data-testid="primaryColumn"]` |
| composeButton | `[data-testid="SideNav_NewTweet_Button"]` |
| composeDialog | `[role="dialog"]` (scope compose modal; avoids home inline composer) |
| composeTweetTextarea | `[role="dialog"] [data-testid="tweetTextarea_{n}"]` |
| composeAddButton | `[data-testid="addButton"]` or `button[aria-label="Add post"]` (focus+Enter preferred) |
| tweetButton | `[role="dialog"] [data-testid="tweetButton"]` |
| fileInput | `[role="dialog"] input[data-testid="fileInput"]` |
| attachments | `[data-testid="attachments"]` |
| profileLink | `[data-testid="AppTabBar_Profile_Link"]` |

## Compose flow

Thread add: prefer `[role="dialog"]`-scoped textareas on compose/post, but add controls may be **global** (`[data-testid="addButton"]` outside dialog). Candidate list includes dialog-scoped then global fallbacks. X lazy-renders add after first tweet has content (~2.5s). **Do not click** add — focus last matching control + Enter (a11y). Duplicate `tweetTextarea_0` slots may appear instead of `tweetTextarea_1`.

### Single-pass text insertion

X Draft.js / Lexical serializes only the focused active block when paragraphs are created with separate `insertParagraph` or per-line `insertText` mutations. `innerText` can still show every line.

1. Inject the full string as one `insertText` payload (`scripts/x-compose-text.cjs`, used by `x-publish.cjs` and `x-reply.cjs`).
2. Before Tweet / `[data-testid="tweetButtonInline"]`, compare `selectAll` selection **and** editor block texts to the drafted paragraph structure. Missing selection/block evidence or flattened paragraphs fail closed. `x-publish.cjs` rechecks every `threadTexts` slot immediately before submit.
3. On mismatch, re-inject once and recheck. If the snapshot still diverges, abort the command. Do not submit.
4. After clicking Reply, `x-reply.cjs` waits for a new owned status whose text matches the draft and returns that reply's `platformPostId` / `platformUrl`.

### x-reply.cjs payload

```jsonc
{
  "text": "Entire multi-paragraph reply in one string",
  "sourcePostUrl": "https://x.com/user/status/123"
}
```

Inline replies are for Social Intent Patrol / agent-browser outbound comments. They are **not** a `PublishJobKind`. Success stdout is the new owned reply, not the parent:

```json
{"success":true,"kind":"reply","handle":"@user","platformPostId":"456","platformUrl":"https://x.com/user/status/456","sourcePostUrl":"https://x.com/user/status/123"}
```

## Verification invariant (P6a port) (owned status ids + max snowflake) **before** compose.
2. Post via compose UI.
3. Poll profile timeline for a **new** owned status where text matches and snowflake id > baseline max.

This prevents false positives from retweets and stale timeline cards.

## Packaging

```bash
scripts/package-signals-publish-skill.sh
```

Upload the zip to the Signals workspace agent-skills endpoint alongside `realtimex-signals`.
