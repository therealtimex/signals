# signals-publish reference

## x-publish.mjs CLI

```bash
node scripts/x-publish.mjs --port <cdpPort> --payload <job.json>
```

### Payload (`job.json`)

```jsonc
{
  "text": "Main post body",
  "threadTexts": ["optional tweet 2", "tweet 3"],
  "mediaPaths": ["/abs/path/img.png"],
  "expectedHandle": "@handle"   // optional; detected when omitted
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
{"success":false,"error":"…","errorCode":"session_expired|captcha|upload_failed|timeout|unknown"}
```

## X selectors (fragility surface)

| Key | Selector |
|-----|----------|
| primaryColumn | `[data-testid="primaryColumn"]` |
| composeButton | `[data-testid="SideNav_NewTweet_Button"]` |
| tweetTextarea | `[data-testid="tweetTextarea_{n}"]` |
| tweetButton | `[data-testid="tweetButton"]` |
| addButton | `[data-testid="addButton"]` |
| fileInput | `input[data-testid="fileInput"]` |
| attachments | `[data-testid="attachments"]` |
| profileLink | `[data-testid="AppTabBar_Profile_Link"]` |

## Verification invariant (P6a port)

1. Capture profile baseline (owned status ids + max snowflake) **before** compose.
2. Post via compose UI.
3. Poll profile timeline for a **new** owned status where text matches and snowflake id > baseline max.

This prevents false positives from retweets and stale timeline cards.

## Packaging

```bash
scripts/package-signals-publish-skill.sh
```

Upload the zip to the Signals workspace agent-skills endpoint alongside `realtimex-signals`.
