# Multi-Channel Content

> Makes the Content page platform-agnostic. Renames X-specific labels, adds platform
> filtering, and upgrades the compose dialog for multi-platform drafting.
>
> Prerequisite: phases 0-5 complete. See [`08-content-and-demand-gen.md`](./08-content-and-demand-gen.md)
> for the Phase 6 media/publishing features that build on this work.

---

## 1. Tab Renames

Current origin filter tabs in `src/app/dashboard/content/content-list-client.tsx`:

| Current | New | Rationale |
|---------|-----|-----------|
| Tweets | Posts | Platform-neutral; covers X posts, LinkedIn posts, newsletters |
| Mentions | Inbound | Covers X mentions, LinkedIn engagement, Gmail replies |
| All | All | Unchanged |
| Drafts | Drafts | Unchanged |

Update the `originFilters` array:

```ts
const originFilters = [
  { value: "all", label: "All" },
  { value: "authored", label: "Posts" },
  { value: "received", label: "Inbound" },
  { value: "drafts", label: "Drafts" },
];
```

No schema changes. The `origin` field values (`authored`, `received`) stay the same.

---

## 2. Platform Filter Row

Add a secondary filter row below the origin tabs. This filters content by `platform` field on the `contentItems` table (already exists in schema).

### 2.1 Filter Options

| Value | Label | Icon |
|-------|-------|------|
| `all` | All Platforms | Globe |
| `x` | X | Twitter/X icon |
| `linkedin` | LinkedIn | Linkedin icon |
| `gmail` | Gmail | Mail icon |

### 2.2 Implementation

- New URL param: `?platform=x` (alongside existing `origin`, `status`, `type` params).
- Server page (`content/page.tsx`) passes `platform` to `listContentItems()`.
- Query module adds `eq(contentItems.platform, platform)` when param is present.
- Render as a row of small `Button` variants (outline/default toggle), placed between the tabs row and the content table.

---

## 3. PostInput Component

Rename `TweetInput` to `PostInput` with configurable limits.

### 3.1 Current State

`TweetInput` is imported only in `src/components/compose-dialog.tsx`. It is a textarea with a 280-char counter, hardcoded for X.

### 3.2 New Props

```ts
interface PostInputProps {
  value: string;
  onChange: (value: string) => void;
  index: number;
  total: number;
  showNumber?: boolean;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  autoFocus?: boolean;
  maxChars?: number;       // default 280
  placeholder?: string;    // default "What's happening?"
}
```

- Rename the file from `tweet-input.tsx` to `post-input.tsx`.
- Update the single import in `compose-dialog.tsx`.
- Character counter uses `maxChars` prop instead of hardcoded 280.
- Placeholder uses `placeholder` prop instead of hardcoded string.

---

## 4. Multi-Platform Compose Dialog

Upgrade `src/components/compose-dialog.tsx` to support X and LinkedIn.

### 4.1 Platform Toggle

Add a segmented control at the top of the dialog: **X** | **LinkedIn**.

| Setting | X | LinkedIn |
|---------|---|----------|
| `maxChars` | 280 | 3,000 |
| `placeholder` | "What's happening?" | "What do you want to talk about?" |
| Thread mode | Available | Hidden |
| Publish endpoint | `/api/platforms/x/compose` | `/api/platforms/linkedin/compose` |

### 4.2 State Changes

```ts
const [platform, setPlatform] = useState<"x" | "linkedin">("x");
```

- When switching from X to LinkedIn: if thread mode is on, collapse to single post (keep first item text).
- Thread toggle button hidden when `platform === "linkedin"`.
- `MAX_CHARS` becomes dynamic: `platform === "x" ? 280 : 3000`.
- Publish and Save Draft call the platform-specific endpoint.

### 4.3 LinkedIn Compose API

New route: `POST /api/platforms/linkedin/compose`

```ts
// Request body
{ body: string; saveAsDraft?: boolean; draftId?: string }

// For now: saves as draft only (no LinkedIn API posting)
// Phase 6B adds browser-based publishing
```

LinkedIn drafts are stored in the same `contentItems` table with `platform: "linkedin"`, `status: "draft"`, `origin: "authored"`.

### 4.4 Dialog Title

Dynamic based on platform:
- X: "Compose Post" (was "Compose")
- LinkedIn: "Compose LinkedIn Post"

---

## 5. Platform-Aware Engagement Display

The content list table shows an Engagement column. Currently it renders X metrics only.

### 5.1 Metric Display by Platform

| Platform | Metrics Shown |
|----------|---------------|
| X | Likes, Replies, Retweets, Quotes (icons: Heart, MessageCircle, Repeat2, Quote) |
| LinkedIn | Likes, Comments, Shares (icons: Heart, MessageCircle, Share2) |
| Gmail | Dash ("--") |
| Other | Dash ("--") |

### 5.2 Implementation

Extract engagement rendering into a helper function:

```ts
function renderEngagement(platform: string, snapshot: Record<string, number> | null) {
  if (!snapshot) return <span className="text-muted-foreground">--</span>;

  switch (platform) {
    case "x":
      return (/* likes, replies, retweets, quotes */);
    case "linkedin":
      return (/* likes, comments, shares */);
    default:
      return <span className="text-muted-foreground">--</span>;
  }
}
```

The `engagementSnapshot` JSON structure varies by platform. LinkedIn stores `{ likes, comments, shares }`. X stores `{ likeCount, replyCount, retweetCount, quoteCount }`.

---

## 6. Remove Import Buttons from Content Toolbar

The "Import Tweets" and "Import Mentions" buttons currently live in the content list toolbar (`content-list-client.tsx`, lines ~183-208). These are sync operations that belong in the Automation page (see Spec 10).

### 6.1 Changes

- Remove the two `<Button>` elements for "Import Tweets" and "Import Mentions".
- Remove the `handleSync` function and related `syncing`/`syncResult`/`error` state.
- Keep only the **Compose** button in the toolbar.
- Remove the sync result display card below the toolbar.

The sync functionality itself (API routes, query functions) is untouched -- it moves to the Workflows tab on the Automation page.

---

## 7. File Change Summary

| File | Change |
|------|--------|
| `src/components/tweet-input.tsx` | Rename to `post-input.tsx`, add `maxChars` + `placeholder` props |
| `src/components/compose-dialog.tsx` | Platform toggle, dynamic char limits, LinkedIn draft support |
| `src/app/dashboard/content/content-list-client.tsx` | Rename tabs, add platform filter row, remove import buttons, platform-aware engagement |
| `src/app/dashboard/content/page.tsx` | Pass `platform` search param to query |
| `src/lib/db/queries/content.ts` | Add optional `platform` filter to `listContentItems()` |
| `src/app/api/platforms/linkedin/compose/route.ts` | New route for LinkedIn draft creation |

No schema changes. No new tables. No migration needed.
