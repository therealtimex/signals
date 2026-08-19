# X Data Archive Import

Import the official X (Twitter) data archive zip — followers, following, and
tweets — without OAuth or paid API tiers. Child of the platform data import
epic (#119); reuses the import modal shell, preview flow, and Runs handoff
from the LinkedIn Connections import (#128/#133). Issue: #136.

## Why

- **Sync Contacts** on X needs `follows.read` (API Basic tier, ~$200/mo).
- Tweet sync via API is paginated and capped; the archive is complete.
- Users can request a full archive for free: X → **Settings and privacy** →
  **Your account** → **Download an archive of your data**.

UI label is **Import X archive** ("takeout" is Gmail/Google terminology).

## Archive format

```
twitter-YYYY-MM-DD-….zip
├── Your archive.html
└── data/
    ├── follower.js   (or follower.part0.js, follower-part1.js, …)
    ├── following.js  (multi-part likewise)
    ├── tweets.js     (old exports: tweet.js)
    ├── account.js, profile.js, …
```

Data files are not plain JSON — each assigns a JSON array to a YTD wrapper:

```js
window.YTD.tweets.part0 = [ { "tweet": { … } }, … ]
```

- `follower.js` / `following.js`: snapshot at export time. Rows are **thin** —
  `accountId` + `userLink` (an `intent/user?user_id=` link) only; no handle,
  name, or avatar.
- `tweets.js`: `id_str`, `full_text`, legacy-format `created_at`
  (`"Wed Oct 10 20:19:24 +0000 2018"`), `favorite_count` / `retweet_count`
  as strings, `in_reply_to_status_id_str` when a reply.
- `account.js`: the archive owner — `accountId`, `username`,
  `accountDisplayName`.

## Pipeline

```
POST /api/platforms/x/import/preview   parse only, no DB writes
POST /api/platforms/x/import           import + recordImportRun
```

1. `import-file.ts` — validates `.zip` extension and the upload cap.
2. `archive-zip.ts` — locates slice entries (case-insensitive, multi-part,
   `data/` or root, one optional wrapping folder) and decompresses **only**
   matched entries, mirroring the LinkedIn zip-bomb guard.
3. `ytd-parse.ts` — strips the `window.YTD.<slice>.part<N> =` prefix, parses
   the array, and converts legacy tweet dates to ISO.
4. `archive-import.ts` — typed parsing plus the two import phases below.

### Phase A — contacts (followers / following)

- Follower and following rows are merged per unique `accountId` so mutuals
  are processed once with both relationship flags.
- Dedup against `contact_identities` on `platform = "x"` +
  `platformUserId` (archive `accountId` equals the API user id used by sync
  and enrichment).
  - Identity exists → merge `archiveFollower` / `archiveFollowing` flags into
    `platformData` (`updated`); already flagged → `skipped`. Re-import is
    idempotent.
  - No identity → thin contact via `mapXArchiveUserToContact`
    (name `X user <accountId>`, profile URL `https://x.com/i/user/<id>`)
    plus an identity via `mapXArchiveUserToIdentity`. When X is connected,
    the Contact profile pipeline resolves these stable numeric IDs in batched
    X API v2 HTTP requests before avatar/persona enrichment; it does not need
    a browser session.
- Run recorded with `workflowType: "import"`,
  `importSubType: "x_archive_contacts"`.

### Phase B — tweets as content

- Archive tweet rows are adapted to the API `XTweet` shape
  (`archiveTweetToXTweet`) so `mapXTweetToContentItem` /
  `mapXTweetToContentPost` are reused; `origin` is overridden to
  `"imported"` and `contentType` uses `in_reply_to_status_id_str` (a
  stronger reply signal than the text-prefix heuristic).
- Dedup on `content_posts` (`platformPostId` = tweet `id_str` +
  `platformAccountId`).
- **platformAccountId resolution** (`content_posts.platform_account_id` is
  NOT NULL, so "no account" is not representable): the connected X account
  when one exists — archive and API sync then dedupe against each other —
  else a credential-less placeholder row (`authType: "session"`,
  `status: "paused"`, display name `@<username> (archive)`). The status
  route reports `connected` from `credentialsEncrypted`, the sync route
  rejects credential-less rows, and the OAuth callback upgrades the
  placeholder in place so imported content stays attached after connecting.
- Run recorded with `importSubType: "x_archive_posts"`.

One upload records one run per executed phase; failures before either phase
record a single failed run with `importSubType: "x_archive"`.

## Size limits

Official archives can be large (media is bundled): the upload is capped at
**500MB** (`MAX_ARCHIVE_ZIP_SIZE`) and each decompressed data file at
**100MB** (`MAX_ARCHIVE_ENTRY_BYTES`). Oversized files are rejected with a
user-facing message. Media inside the zip is never extracted.

## Out of scope

- DMs, likes, lists, Moments, bookmarks, media extraction.
- Replacing `POST /api/platforms/x/sync`.
- General browser/web research enrichment beyond deterministic X profile lookup.
