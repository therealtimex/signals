# Phase 6: Content Studio + Demand Generation

> **Partially superseded (2026-08)** — AI drafting sections reference removed Vercel AI SDK routes (`/api/content/ai-generate`, in-app `generateText`).
> **Current intelligence path:** RTX agents + [`docs/rtx-agent-orchestration.md`](../docs/rtx-agent-orchestration.md).
> **Data paths:** use `~/.signals/` (not `~/.openvolo/`). Review against [`docs/realtimex-local-app.md`](../docs/realtimex-local-app.md) before implementing.

**Prerequisite**: Spec 09 (Multi-Channel Content) introduces the platform-agnostic PostInput component, platform filter, and multi-platform compose dialog that Phase 6 content features build upon.

> Extends the CRM with a full content creation pipeline, browser-based publishing
> (bypassing API tier limitations), AI-powered drafting, goal-driven demand generation,
> and user-defined workflow templates. Builds on top of every prior phase.
>
> See [`06-unified-workflows.md`](./06-unified-workflows.md) for the workflow system,
> [`07-agentic-workflows.md`](./07-agentic-workflows.md) for agent runner patterns,
> and [`05-browser-enrichment.md`](./05-browser-enrichment.md) for browser session infrastructure.

---

## 1. Overview & Single-User Scope

### 1.1 Goals

Phase 6 addresses three gaps in the current system:

1. **Content creation is limited.** The existing compose dialog (`src/components/compose-dialog.tsx`) is X-only, text-only, and publishes via the X API — which requires the $100/month elevated tier for posting. LinkedIn has no public posting API at all. Neither supports media upload through free-tier APIs.

2. **No goal-driven demand generation.** Users can run workflows, but there's no way to track whether those workflows contribute to higher-level business outcomes (grow audience, generate leads, increase engagement).

3. **Templates are system-only.** The 7 seed templates (`src/lib/db/seed-templates.ts`) cannot be edited, cloned, or supplemented with user-created templates.

### 1.2 Single-User Model

OpenVolo is a single-user application. No `userId` columns exist in any schema table. No multi-tenancy, no auth middleware, no session tokens. Phase 6 maintains this model — all new tables are implicitly single-user.

### 1.3 Browser-First Publishing Strategy

| Operation | Current | Phase 6 |
|-----------|---------|---------|
| Read X posts | X API (free tier) | X API (unchanged) |
| Read LinkedIn connections | Browser scrape | Browser scrape (unchanged) |
| **Publish to X** | X API ($100/mo tier required) | **Browser automation (free)** |
| **Publish to LinkedIn** | Not possible | **Browser automation (free)** |
| **Upload media** | Not possible | **Browser automation (free)** |

**Rationale:** The existing browser session infrastructure (`src/lib/browser/session.ts`) already handles authenticated sessions with cookie management, stealth args, and anti-detection. Publishing extends this with compose-form interaction instead of profile scraping. The same `createSessionContext()` for headless mode and `launchPersistentContext()` for headed/review mode are reused.

---

## 2. Media System

### 2.1 New Table: `mediaAssets`

```ts
// src/lib/db/schema.ts — addition

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),                    // nanoid()
  filename: text("filename").notNull(),           // original upload filename
  storagePath: text("storage_path").notNull(),    // relative path under ~/.openvolo/media/
  mimeType: text("mime_type").notNull(),          // image/jpeg, image/png, video/mp4, etc.
  fileSize: integer("file_size").notNull(),       // bytes
  width: integer("width"),                        // pixels (nullable for non-image/video)
  height: integer("height"),                      // pixels (nullable)
  contentItemId: text("content_item_id")
    .references(() => contentItems.id, { onDelete: "set null" }),  // nullable — can be unattached
  platformTarget: text("platform_target", {
    enum: ["x", "linkedin"],
  }),                                             // which platform constraints apply
  ...timestamps,
});
```

### 2.2 Storage Layout

```
~/.openvolo/media/
  {nanoid}.jpg      ← flat directory, nanoid prevents filename collisions
  {nanoid}.png
  {nanoid}.mp4
  ...
```

The `~/.openvolo/media/` directory already exists (created by `bin/cli.ts` boot flow). Files are stored with the nanoid as filename + original extension.

### 2.3 Platform Media Constraints

Enforced in the compose UI before upload and at publish time:

| Platform | Images | Video | Other |
|----------|--------|-------|-------|
| **X** | Up to 4 per tweet. Max 5 MB each (JPEG, PNG, GIF, WEBP) | 1 per tweet (exclusive with images). Max 512 MB | GIF counts as image |
| **LinkedIn** | Up to 9 per post. Max 10 MB each | 1 per post (exclusive with images). Max 200 MB | PDF documents (carousel) supported |

When media is attached to a content item, the `contentItems.mediaPaths` JSON array is populated with `mediaAsset.id` references (not file paths, for indirection).

### 2.4 API Routes

**`POST /api/media`** — Multipart form upload

```ts
// Request: multipart/form-data with "file" field + optional "platformTarget" field
// Response: { asset: MediaAsset }

// Validates: file size, mime type against platform constraints
// Stores: file to ~/.openvolo/media/{nanoid}.{ext}
// Creates: mediaAssets record
// Extracts: width/height for images (via sharp or image-size package)
```

**`GET /api/media`** — List media assets

```ts
// Query params: contentItemId?, platformTarget?, page?, pageSize?
// Response: { data: MediaAsset[], total: number }
```

**`GET /api/media/[id]`** — Serve file for preview

```ts
// Streams file from disk with correct Content-Type header
// Used by compose UI for thumbnails and previews
```

**`DELETE /api/media/[id]`** — Remove file + record

```ts
// Deletes file from disk + removes DB record
// If linked to a contentItem, also removes from contentItems.mediaPaths array
```

### 2.5 Query Module

**`src/lib/db/queries/media.ts`**

```ts
createMediaAsset(data: Omit<NewMediaAsset, "id">): MediaAsset
getMediaAsset(id: string): MediaAsset | undefined
listMediaAssets(opts?: { contentItemId?, platformTarget?, page?, pageSize? }): PaginatedResult<MediaAsset>
deleteMediaAsset(id: string): boolean     // also deletes file from disk
linkMediaToContent(assetId: string, contentItemId: string): void
unlinkMediaFromContent(assetId: string): void
```

### 2.6 Types

```ts
// src/lib/db/types.ts — additions
export type MediaAsset = InferSelectModel<typeof mediaAssets>;
export type NewMediaAsset = InferInsertModel<typeof mediaAssets>;
```

---

## 3. Enhanced Content Compose

### 3.1 Extending `compose-dialog.tsx`

The existing compose dialog supports X tweets/threads via API posting. Phase 6 transforms it into a full Content Studio:

**Before (current):**
- X-only, text-only
- Thread mode (multi-tweet chain)
- Publish via X API (`/api/platforms/x/compose`)
- Save as draft

**After (Phase 6):**
- **Platform tabs**: X | LinkedIn (each with platform-specific formatting rules)
- **Rich compose**: Text area with character counter (280 for X, 3,000 for LinkedIn)
- **Media attachment**: Drop zone + file picker. Shows thumbnails with remove button. Validates per-platform constraints (Section 2.3).
- **Thread mode** (X only): Existing multi-tweet chain, now with media per tweet
- **Publish method toggle**: "Auto-publish" (Playwright posts silently in headless mode) vs "Review & publish" (Playwright fills the form in a visible browser window, user reviews and clicks Post themselves)
- **Schedule**: Date/time picker → queues content for scheduled publishing via existing `scheduledJobs` table
- **AI Assist**: Collapsible sidebar panel for AI-powered content generation (see Section 5)

### 3.2 Content Status Flow

```
Draft → Scheduled → Publishing → Published
                  ↘ Failed (retry returns to Draft)
```

Statuses reuse the existing `contentItems.status` enum: `"draft"`, `"scheduled"`, `"published"`. The `"review"` and `"approved"` statuses map to the review-before-post flow. No schema change needed — `contentItems.status` already has `["draft", "review", "approved", "scheduled", "published", "imported"]`.

### 3.3 Content Calendar View

New component: `src/app/dashboard/content/content-calendar.tsx`

- Week/month grid showing scheduled + published content
- Click an item to edit/reschedule
- Visual indicators for platform: X (blue accent), LinkedIn (blue-gray accent)
- Renders as a new tab alongside the existing content list view
- Uses existing `listContentItems({ status: "scheduled" })` + date range filtering

### 3.4 New Component: `ContentListClient` Tab Enhancement

The existing `content-list-client.tsx` gets a tab bar: **List | Calendar**. The calendar tab lazy-loads `content-calendar.tsx`.

---

## 4. Browser-Based Publishing

### 4.1 Module Structure

```
src/lib/browser/publishers/
  types.ts              — PublishRequest, PublishResult, PublishMode
  base-publisher.ts     — Abstract base: session check, error handling, post verification, screenshot
  x-publisher.ts        — X compose flow: selectors, media upload, thread chaining
  linkedin-publisher.ts — LinkedIn compose flow: selectors, media/document upload
```

### 4.2 Types

```ts
// src/lib/browser/publishers/types.ts

export type PublishMode = "auto" | "review";

export interface PublishRequest {
  platform: "x" | "linkedin";
  mode: PublishMode;
  text: string;
  mediaAssetIds?: string[];       // references to mediaAssets table
  threadTexts?: string[];         // X threads: array of tweet texts
  threadMediaIds?: string[][];    // media IDs per thread tweet (parallel array)
  contentItemId: string;          // link back to content item for tracking
  replyToUrl?: string;            // for reply-to-tweet publishing
}

export interface PublishResult {
  success: boolean;
  platformUrl?: string;           // scraped URL of the published post
  platformPostId?: string;        // extracted post ID from URL
  error?: string;
  errorCode?: "session_expired" | "captcha" | "upload_failed" | "timeout" | "unknown";
  screenshotPath?: string;        // verification screenshot (stored in ~/.openvolo/media/)
}
```

### 4.3 Base Publisher

```ts
// src/lib/browser/publishers/base-publisher.ts

export abstract class BasePublisher {
  protected platform: BrowserPlatform;

  constructor(platform: BrowserPlatform) {
    this.platform = platform;
  }

  /** Validate session exists and is recent. */
  protected async ensureSession(): Promise<BrowserSession> {
    const session = loadSession(this.platform);
    if (!session) {
      throw new PublishError("session_expired", `No ${this.platform} session. Set up browser session in Settings.`);
    }
    return session;
  }

  /** Create browser context based on mode. */
  protected async createContext(
    session: BrowserSession,
    mode: PublishMode
  ): Promise<{ browser: Browser; context: BrowserContext }> {
    if (mode === "auto") {
      // Headless — fire and forget
      return createSessionContext(session);
    }
    // Review mode — headed, user sees the browser
    const profileDir = join(PROFILES_DIR, this.platform);
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chrome",
      viewport: session.viewport,
      args: STEALTH_ARGS,
    });
    return { browser: null as unknown as Browser, context };
  }

  /** Take a verification screenshot. */
  protected async captureScreenshot(page: Page): Promise<string> {
    const id = nanoid();
    const filename = `screenshot-${id}.png`;
    const path = join(homedir(), ".openvolo", "media", filename);
    await page.screenshot({ path, fullPage: false });
    return path;
  }

  /** Resolve media asset IDs to absolute file paths. */
  protected resolveMediaPaths(assetIds: string[]): string[] {
    return assetIds.map((id) => {
      const asset = getMediaAsset(id);
      if (!asset) throw new PublishError("unknown", `Media asset not found: ${id}`);
      return join(homedir(), ".openvolo", "media", asset.storagePath);
    });
  }

  abstract publish(request: PublishRequest): Promise<PublishResult>;
}
```

### 4.4 X Publisher Flow

```ts
// src/lib/browser/publishers/x-publisher.ts

export class XPublisher extends BasePublisher {
  constructor() { super("x"); }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const session = await this.ensureSession();
    const { browser, context } = await this.createContext(session, request.mode);
    const page = context.pages()[0] || await context.newPage();

    try {
      // 1. Navigate to X home or compose
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="primaryColumn"]', { timeout: 15_000 });

      // 2. Open compose
      await page.click('[data-testid="SideNav_NewTweet_Button"]');
      await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10_000 });

      // 3. Fill first tweet text
      await page.click('[data-testid="tweetTextarea_0"]');
      await page.keyboard.type(request.text, { delay: 20 });  // human-like typing speed

      // 4. Media upload (if any)
      if (request.mediaAssetIds?.length) {
        const filePaths = this.resolveMediaPaths(request.mediaAssetIds);
        const fileInput = await page.$('input[data-testid="fileInput"]');
        if (fileInput) {
          await fileInput.setInputFiles(filePaths);
          // Wait for upload completion (media thumbnail appears)
          await page.waitForSelector('[data-testid="attachments"]', { timeout: 30_000 });
        }
      }

      // 5. Thread tweets (if any)
      if (request.threadTexts?.length) {
        for (let i = 0; i < request.threadTexts.length; i++) {
          // Click "Add another tweet" button
          await page.click('[data-testid="addButton"]');
          await sleep(500);
          await page.click(`[data-testid="tweetTextarea_${i + 1}"]`);
          await page.keyboard.type(request.threadTexts[i], { delay: 20 });

          // Media per thread tweet
          if (request.threadMediaIds?.[i]?.length) {
            const filePaths = this.resolveMediaPaths(request.threadMediaIds[i]);
            const inputs = await page.$$('input[data-testid="fileInput"]');
            const input = inputs[i + 1] ?? inputs[inputs.length - 1];
            if (input) {
              await input.setInputFiles(filePaths);
              await page.waitForTimeout(3000); // wait for upload
            }
          }
        }
      }

      // 6. Publish or review
      if (request.mode === "auto") {
        await page.click('[data-testid="tweetButton"]');
        await sleep(3000); // wait for post to publish

        // 7. Verify — scrape the latest tweet URL
        const result = await this.verifyPost(page);
        return result;
      } else {
        // Review mode — stop here, user clicks Post
        const screenshot = await this.captureScreenshot(page);
        console.log("[x-publisher] Ready for review — check browser window.");

        // Wait for user to post (detect URL change or toast)
        try {
          await page.waitForSelector('[data-testid="toast"]', { timeout: 300_000 }); // 5 min
          const result = await this.verifyPost(page);
          return { ...result, screenshotPath: screenshot };
        } catch {
          return {
            success: false,
            error: "Review mode timed out (5 minutes). Content preserved as draft.",
            errorCode: "timeout",
            screenshotPath: screenshot,
          };
        }
      }
    } catch (err) {
      const screenshot = await this.captureScreenshot(page).catch(() => undefined);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "unknown",
        screenshotPath: screenshot,
      };
    } finally {
      if (request.mode === "auto") {
        await browser?.close();
      }
      // Review mode: leave browser open for the user
    }
  }

  /** Navigate to profile and scrape latest post URL. */
  private async verifyPost(page: Page): Promise<PublishResult> {
    // Navigate to own profile to find the post
    await page.goto("https://x.com", { waitUntil: "domcontentloaded" });
    await sleep(2000);

    // Look for the latest tweet link by querying article links
    const tweetLinks = await page.locator(
      'article a[href*="/status/"]'
    ).allTextContents().catch(() => []);

    const tweetUrls = await page.locator(
      'article a[href*="/status/"]'
    ).evaluateAll((links: Element[]) =>
      links.map((a) => (a as HTMLAnchorElement).href)
    ).catch(() => []);

    if (tweetUrls.length > 0) {
      const latestUrl = tweetUrls[0];
      const match = latestUrl.match(/\/status\/(\d+)/);
      return {
        success: true,
        platformUrl: latestUrl,
        platformPostId: match?.[1],
      };
    }

    return { success: true }; // Published but couldn't scrape URL
  }
}
```

### 4.5 LinkedIn Publisher Flow

```ts
// src/lib/browser/publishers/linkedin-publisher.ts

export class LinkedInPublisher extends BasePublisher {
  constructor() { super("linkedin"); }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const session = await this.ensureSession();
    const { browser, context } = await this.createContext(session, request.mode);
    const page = context.pages()[0] || await context.newPage();

    try {
      // 1. Navigate to LinkedIn feed
      await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".share-box-feed-entry__trigger", { timeout: 15_000 });

      // 2. Click "Start a post"
      await page.click(".share-box-feed-entry__trigger");
      await page.waitForSelector(".ql-editor", { timeout: 10_000 });

      // 3. Fill post text
      await page.click(".ql-editor");
      await page.keyboard.type(request.text, { delay: 15 });

      // 4. Media upload
      if (request.mediaAssetIds?.length) {
        const filePaths = this.resolveMediaPaths(request.mediaAssetIds);
        // Click the image/video button in the toolbar
        await page.click('button[aria-label="Add a photo"]').catch(() =>
          page.click('button[aria-label="Add media"]')
        );
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(filePaths);
          await page.waitForTimeout(5000); // wait for upload processing
        }
      }

      // 5. Publish or review
      if (request.mode === "auto") {
        await page.click('button.share-actions__primary-action');
        await sleep(3000);

        const result = await this.verifyPost(page);
        return result;
      } else {
        const screenshot = await this.captureScreenshot(page);
        console.log("[linkedin-publisher] Ready for review — check browser window.");

        try {
          // Wait for user to post (modal closes)
          await page.waitForSelector(".ql-editor", { state: "hidden", timeout: 300_000 });
          const result = await this.verifyPost(page);
          return { ...result, screenshotPath: screenshot };
        } catch {
          return {
            success: false,
            error: "Review mode timed out.",
            errorCode: "timeout",
            screenshotPath: screenshot,
          };
        }
      }
    } catch (err) {
      const screenshot = await this.captureScreenshot(page).catch(() => undefined);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "unknown",
        screenshotPath: screenshot,
      };
    } finally {
      if (request.mode === "auto") await browser?.close();
    }
  }

  private async verifyPost(page: Page): Promise<PublishResult> {
    // Navigate to activity feed
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
    await sleep(2000);

    // Scrape latest post URL from activity using locator API
    const postUrls = await page.locator(
      '.feed-shared-update-v2 a[href*="/feed/update/"]'
    ).evaluateAll((links: Element[]) =>
      links.map((a) => (a as HTMLAnchorElement).href)
    ).catch(() => []);

    if (postUrls.length > 0) {
      const latestUrl = postUrls[0];
      const match = latestUrl.match(/urn:li:activity:(\d+)/);
      return {
        success: true,
        platformUrl: latestUrl,
        platformPostId: match?.[1],
      };
    }

    return { success: true };
  }
}
```

### 4.6 Error Handling Strategy

| Error | Detection | Response |
|-------|-----------|----------|
| **Session expired** | Login redirect detected during navigation | Return `errorCode: "session_expired"`. UI prompts user to re-setup browser session in Settings. |
| **CAPTCHA/Challenge** | Challenge page selector detected | Stop immediately. Return error with screenshot for diagnostics. |
| **Media upload failed** | Upload indicator doesn't appear within 30s | Retry once. If still fails, return `errorCode: "upload_failed"`. |
| **Post verification failed** | Can't find published post URL | Return `success: true` (post likely succeeded) with no `platformUrl`. |
| **Review mode timeout** | User doesn't click Post within 5 minutes | Return `errorCode: "timeout"`. Content preserved as draft for retry. |

On ANY failure, the `contentItem.status` remains `"draft"` (or reverts to `"draft"` from `"publishing"`). Content is never lost.

### 4.7 Publish API Route

**`POST /api/content/publish`**

```ts
// src/app/api/content/publish/route.ts

const publishSchema = z.object({
  contentItemId: z.string(),
  platform: z.enum(["x", "linkedin"]),
  mode: z.enum(["auto", "review"]).default("auto"),
  text: z.string().min(1),
  mediaAssetIds: z.array(z.string()).optional(),
  threadTexts: z.array(z.string()).optional(),
  threadMediaIds: z.array(z.array(z.string())).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const input = publishSchema.parse(body);

  // Update content item status to "publishing"
  updateContentItem(input.contentItemId, { status: "review" });

  // Route to correct publisher
  const publisher = input.platform === "x"
    ? new XPublisher()
    : new LinkedInPublisher();

  const result = await publisher.publish({
    ...input,
    contentItemId: input.contentItemId,
  });

  if (result.success) {
    // Update content item to published
    updateContentItem(input.contentItemId, { status: "published" });

    // Find or get platform account for this platform
    const account = getPlatformAccountByPlatform(input.platform);

    // Create content post record
    if (account && result.platformPostId) {
      createContentPost({
        contentItemId: input.contentItemId,
        platformAccountId: account.id,
        platformPostId: result.platformPostId,
        platformUrl: result.platformUrl,
        publishedAt: Math.floor(Date.now() / 1000),
        status: "published",
      });
    }
  } else {
    // Revert to draft on failure
    updateContentItem(input.contentItemId, { status: "draft" });
  }

  return NextResponse.json(result);
}
```

### 4.8 Scheduled Publishing

Content scheduled for future publishing uses the existing `scheduledJobs` table:

```ts
// When user schedules a post from compose dialog:
createScheduledJob({
  jobType: "content_publish",
  templateId: null,   // not template-driven
  payload: JSON.stringify({
    contentItemId: "...",
    platform: "x",
    mode: "auto",
    text: "...",
    mediaAssetIds: [...],
  }),
  runAt: scheduledTimestamp,  // unix seconds
});
```

The scheduler runner (`src/lib/scheduler/runner.ts`) needs a new job type handler:

```ts
// In executeJob(), add handling for "content_publish" jobType:
if (job.jobType === "content_publish") {
  const payload = JSON.parse(job.payload ?? "{}");
  // Import and call the publish function
  const { publishContent } = await import("@/lib/browser/publishers/publish");
  await publishContent(payload);
  return;
}
```

---

## 5. AI Content Creation

### 5.1 Three Modes

Reuses existing Vercel AI SDK 6 `generateText()` infrastructure (same pattern as `run-agent-workflow.ts`).

| Mode | Input | Output | Use Case |
|------|-------|--------|----------|
| **`draft`** | topic, platform, tone, optional goal/contact context | 2-3 complete post variations | "Write me a post about X" |
| **`suggest`** | topic area, platform | 3-5 topic/hook ideas as structured list | "What should I post about?" |
| **`refine`** | existing content + instruction | Refined version | "Make this shorter" |

### 5.2 API Route

**`POST /api/content/ai-generate`**

```ts
// src/app/api/content/ai-generate/route.ts

const generateSchema = z.object({
  mode: z.enum(["draft", "suggest", "refine"]),
  platform: z.enum(["x", "linkedin"]),
  goalId: z.string().optional(),
  contactIds: z.array(z.string()).optional(),
  topic: z.string().optional(),
  existingContent: z.string().optional(),  // required for refine mode
  tone: z.enum(["professional", "casual", "thought-leader", "promotional"]).optional(),
});

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 401 });
  }

  const input = generateSchema.parse(await req.json());

  const systemPrompt = buildContentSystemPrompt(input);
  const userPrompt = buildContentUserPrompt(input);

  const result = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    prompt: userPrompt,
  });

  return NextResponse.json({
    mode: input.mode,
    platform: input.platform,
    result: result.text,
  });
}
```

### 5.3 System Prompt Construction

```ts
function buildContentSystemPrompt(input: GenerateInput): string {
  const platformRules = input.platform === "x"
    ? "X (Twitter): Max 280 characters per tweet. Use concise language. Hashtags sparingly (1-2 max). No @mentions unless relevant."
    : "LinkedIn: Up to 3,000 characters. Professional tone. Can use formatting. Hashtags at the end (3-5). First line is the hook.";

  const toneGuide = {
    professional: "Write in a polished, authoritative voice suitable for industry peers.",
    casual: "Write in a conversational, approachable voice. Be relatable.",
    "thought-leader": "Write with bold opinions and unique insights. Challenge conventional thinking.",
    promotional: "Write persuasively but not salesy. Focus on value and outcomes.",
  }[input.tone ?? "professional"];

  return `You are a social media content strategist.

## Platform Rules
${platformRules}

## Tone
${toneGuide}

## Mode-Specific Instructions
${getModeInstructions(input.mode)}`;
}

function getModeInstructions(mode: string): string {
  switch (mode) {
    case "draft":
      return "Generate 2-3 complete post variations. Each should take a different angle on the topic. Format as numbered options.";
    case "suggest":
      return "Generate 3-5 topic/hook ideas. For each, provide: a short title, the angle/approach, and a 1-line preview of the post opening. Format as a structured list.";
    case "refine":
      return "Refine the provided content based on the user's instruction. Return only the refined version, not explanations.";
    default:
      return "";
  }
}
```

### 5.4 Context Injection

When `goalId` is provided, fetch the goal and inject its context:

```ts
if (input.goalId) {
  const goal = getGoal(input.goalId);
  if (goal) {
    contextParts.push(`## Goal Context
Name: ${goal.name}
Type: ${goal.goalType}
Target: ${goal.targetValue} ${goal.unit}
Current: ${goal.currentValue} ${goal.unit}
The content should contribute to this goal.`);
  }
}
```

When `contactIds` are provided, fetch contacts and inject persona insights:

```ts
if (input.contactIds?.length) {
  const contacts = input.contactIds.map(getContactById).filter(Boolean);
  const personas = contacts.map(c =>
    `- ${c.name}: ${c.title ?? "unknown title"} at ${c.company ?? "unknown company"} — ${c.headline ?? ""}`
  ).join("\n");
  contextParts.push(`## Target Audience\n${personas}\nTailor the content to resonate with these people.`);
}
```

### 5.5 Multi-Platform Adaptation

**"Adapt for X/LinkedIn" button** in the compose UI:

```ts
// When user clicks "Adapt for LinkedIn" while composing for X:
POST /api/content/ai-generate
{
  mode: "refine",
  platform: "linkedin",
  existingContent: "<current X tweet text>",
  topic: "Adapt this X post for LinkedIn. Expand the ideas, make it longer and more professional. Add relevant context."
}
```

This reuses the refine mode with cross-platform adaptation instructions.

### 5.6 UI: AI Assist Panel

New component: `src/app/dashboard/content/ai-assist-panel.tsx`

Renders as a collapsible sidebar within the compose dialog:

- **Mode selector**: Draft | Suggest | Refine tabs
- **Topic input**: Text field for topic/angle
- **Tone selector**: Dropdown (professional, casual, thought-leader, promotional)
- **Goal selector**: Optional dropdown populated from active goals
- **Contact selector**: Optional multi-select from contacts
- **Generate button**: Triggers `/api/content/ai-generate`
- **Output area**: Displays generated content with "Insert" button per variation
- **Insert action**: Clicking "Insert" replaces compose area text with the selected variation

---

## 6. Goals & Demand Generation

### 6.1 New Table: `goals`

```ts
// src/lib/db/schema.ts — addition

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),              // nanoid()
  name: text("name").notNull(),             // "Q1 Lead Generation", "Grow X Audience"
  goalType: text("goal_type", {
    enum: ["audience_growth", "lead_generation", "content_engagement", "pipeline_progression"],
  }).notNull(),
  platform: text("platform", {
    enum: ["x", "linkedin"],
  }),                                        // nullable for cross-platform goals
  targetValue: integer("target_value").notNull(),  // numeric target: 500 followers, 50 leads
  currentValue: integer("current_value").notNull().default(0),
  unit: text("unit").notNull(),             // "followers", "contacts", "engagements", "opportunities"
  deadline: integer("deadline"),             // unix timestamp, nullable for open-ended
  status: text("status", {
    enum: ["active", "achieved", "missed", "paused"],
  }).notNull().default("active"),
  ...timestamps,
});
```

### 6.2 New Table: `goalWorkflows`

Links goals to contributing workflow templates:

```ts
export const goalWorkflows = sqliteTable("goal_workflows", {
  id: text("id").primaryKey(),
  goalId: text("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  templateId: text("template_id")
    .notNull()
    .references(() => workflowTemplates.id, { onDelete: "cascade" }),
  contribution: text("contribution", {
    enum: ["primary", "supporting"],
  }).notNull().default("primary"),
  ...timestamps,
});
```

### 6.3 New Table: `goalProgress`

Time-series snapshots for trend visualization:

```ts
export const goalProgress = sqliteTable("goal_progress", {
  id: text("id").primaryKey(),
  goalId: text("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  value: integer("value").notNull(),         // snapshot of currentValue at this point
  delta: integer("delta").notNull(),         // change since last snapshot
  source: text("source"),                    // workflow run ID, "manual", or "system"
  note: text("note"),                        // "Added 12 contacts from AI Influencers search"
  snapshotAt: integer("snapshot_at")
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index("idx_goal_progress_goal").on(table.goalId),
  index("idx_goal_progress_snapshot").on(table.snapshotAt),
]);
```

### 6.4 Progress Tracking — Automatic Updates

Goals update automatically from workflow completions. The integration point is at the end of `executeAgentLoop()` in `src/lib/agents/run-agent-workflow.ts`:

```ts
// After updating the run as completed (line ~796-804):
// Check if this workflow is linked to any goals
if (config.templateId) {
  updateGoalProgressFromWorkflow(config.templateId, runId, config.workflowType, resultData);
}
```

The `updateGoalProgressFromWorkflow()` function:

```ts
// src/lib/db/queries/goals.ts

export function updateGoalProgressFromWorkflow(
  templateId: string,
  workflowRunId: string,
  workflowType: WorkflowType,
  resultData: Record<string, unknown>
): void {
  // Find goals linked to this template
  const linkedGoals = listGoalWorkflows({ templateId });
  if (linkedGoals.length === 0) return;

  for (const link of linkedGoals) {
    const goal = getGoal(link.goalId);
    if (!goal || goal.status !== "active") continue;

    // Compute delta based on goal type + workflow result
    const delta = computeGoalDelta(goal, workflowType, resultData);
    if (delta === 0) continue;

    // Update current value
    const newValue = goal.currentValue + delta;
    updateGoal(goal.id, {
      currentValue: newValue,
      status: newValue >= goal.targetValue ? "achieved" : "active",
    });

    // Record progress snapshot
    createGoalProgress({
      goalId: goal.id,
      value: newValue,
      delta,
      source: workflowRunId,
      note: buildProgressNote(workflowType, delta),
    });
  }
}
```

Delta computation rules:

| Goal Type | Workflow Type | Delta Calculation |
|-----------|--------------|-------------------|
| `lead_generation` | `search` | Count `contact_create` steps with `status: "completed"` |
| `lead_generation` | `enrich` | Count contacts with enrichment score improved |
| `audience_growth` | `agent` | Extracted from workflow result (follower delta) |
| `content_engagement` | `agent` | Sum engagement metrics from published posts |
| `pipeline_progression` | any | Count contacts that moved to a higher funnel stage |

### 6.5 API Routes

**`GET /api/goals`** — List all goals

```ts
// Query params: status?, goalType?, page?, pageSize?
// Response: { data: Goal[], total: number }
```

**`POST /api/goals`** — Create a new goal

```ts
// Body: { name, goalType, platform?, targetValue, unit, deadline? }
// Response: { goal: Goal }
```

**`GET /api/goals/[id]`** — Get single goal with linked workflows

```ts
// Response: { goal: Goal, workflows: GoalWorkflow[] }
```

**`PUT /api/goals/[id]`** — Update a goal

```ts
// Body: Partial<Goal>
// Response: { goal: Goal }
```

**`DELETE /api/goals/[id]`** — Delete a goal (cascades to goalWorkflows + goalProgress)

**`GET /api/goals/[id]/progress`** — Progress history for charts

```ts
// Query params: range? (7d, 30d, 90d)
// Response: { progress: GoalProgress[] }
```

**`POST /api/goals/[id]/link-workflow`** — Associate a template with a goal

```ts
// Body: { templateId, contribution? }
// Response: { link: GoalWorkflow }
```

### 6.6 Query Module

**`src/lib/db/queries/goals.ts`**

```ts
createGoal(data): Goal
getGoal(id): Goal | undefined
listGoals(opts?): PaginatedResult<Goal>
updateGoal(id, data): Goal | undefined
deleteGoal(id): boolean

createGoalProgress(data): GoalProgress
listGoalProgress(goalId, range?): GoalProgress[]

createGoalWorkflow(data): GoalWorkflow
listGoalWorkflows(opts?): GoalWorkflow[]
deleteGoalWorkflow(id): boolean

// Auto-progress integration
updateGoalProgressFromWorkflow(templateId, runId, workflowType, resultData): void
computeGoalDelta(goal, workflowType, resultData): number
```

### 6.7 UI

**Option A: Goals tab on Analytics dashboard** (`/dashboard/analytics`)
**Option B: Standalone page** (`/dashboard/goals`)

Recommended: **Option B** — standalone page, since goals are a first-class concept that users should access frequently. Add "Goals" to the sidebar navigation.

**Components:**

- `src/app/dashboard/goals/page.tsx` — Server component, fetches goals
- `src/app/dashboard/goals/goal-card.tsx` — Card with name, progress bar (currentValue/targetValue), deadline countdown, contributing workflows list, status badge
- `src/app/dashboard/goals/goal-detail.tsx` — Detail view: trend chart (goalProgress over time via area chart), linked workflows with recent run history, manual progress entry button
- `src/app/dashboard/goals/goal-create-dialog.tsx` — Dialog with: name, type (dropdown), target value + unit, deadline (date picker), platform (optional), linked templates (multi-select)

---

## 7. User-Defined Templates

### 7.1 Schema Changes to `workflowTemplates`

Add two columns to the existing `workflowTemplates` table:

```ts
// src/lib/db/schema.ts — modifications to workflowTemplates

export const workflowTemplates = sqliteTable("workflow_templates", {
  // ... existing columns unchanged ...

  // New columns for Phase 6
  isSystem: integer("is_system").notNull().default(0),           // 1 = system-seeded, 0 = user-created
  sourceTemplateId: text("source_template_id")
    .references(() => workflowTemplates.id, { onDelete: "set null" }),  // set when cloned from another template
});
```

**Migration strategy:** Use `ALTER TABLE` to add columns since `drizzle-kit push --force` may fail on FK constraints:

```sql
ALTER TABLE workflow_templates ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_templates ADD COLUMN source_template_id TEXT REFERENCES workflow_templates(id) ON DELETE SET NULL;
-- Mark existing templates as system
UPDATE workflow_templates SET is_system = 1;
```

### 7.2 Template Type Enum

The existing `templateType` enum on `workflowTemplates` already includes all needed values:

```ts
templateType: text("template_type", {
  enum: ["outreach", "engagement", "content", "nurture", "prospecting", "enrichment", "pruning"],
}).notNull(),
```

No schema change needed for the enum. The existing seed templates use `prospecting`, `enrichment`, and `pruning`. Phase 6 activates `content`, `engagement`, `outreach`, and `nurture` for user-created templates.

### 7.3 Workflow Type Mapping

Extend `WorkflowType` and the scheduler's `TEMPLATE_TO_WORKFLOW_TYPE` mapping:

```ts
// src/lib/workflows/types.ts — extension
export type WorkflowType = "sync" | "enrich" | "search" | "prune" | "sequence" | "agent"
  | "content" | "engagement" | "outreach";

// src/lib/scheduler/runner.ts — already has these mappings:
const TEMPLATE_TO_WORKFLOW_TYPE: Record<string, WorkflowType> = {
  prospecting: "search",
  enrichment: "enrich",
  pruning: "prune",
  outreach: "sequence",    // already mapped
  engagement: "agent",     // already mapped
  content: "agent",        // already mapped
  nurture: "agent",        // already mapped
};
```

Extend `WORKFLOW_TYPE_LABELS`:

```ts
export const WORKFLOW_TYPE_LABELS: Record<WorkflowType, string> = {
  // ... existing ...
  content: "Content Publishing",
  engagement: "Engagement",
  outreach: "Outreach",
};
```

### 7.4 Workflow Step Types

Add new step types to the `workflowSteps.stepType` enum:

```ts
// In schema.ts workflowSteps:
stepType: text("step_type", {
  enum: [
    // ... existing types ...
    "content_publish",      // new: browser-based content publishing
    "engagement_action",    // already exists
  ],
}).notNull(),
```

And in `src/lib/workflows/types.ts`:

```ts
export type WorkflowStepType =
  // ... existing ...
  | "content_publish";
```

### 7.5 Template Builder UI

New component: `src/app/dashboard/workflows/template-builder.tsx`

**Form fields:**
- **Name**: Text input (required)
- **Description**: Textarea
- **Template type**: Dropdown with all 7 types
- **Platform**: Optional dropdown (x, linkedin, or omit for cross-platform)
- **System prompt**: Rich textarea (monospace, larger) with "AI Generate" button
- **Target persona**: Text input
- **Estimated cost**: Number input (per run, in USD)
- **Default config**: Dynamic JSON form based on template type:
  - `prospecting`: maxResults, targetDomains
  - `enrichment`: maxContacts, maxEnrichmentScore
  - `pruning`: maxContacts, criteria, companyName
  - `content`: topics[], tone, frequency
  - `engagement`: targetAudience, actions (like/reply/retweet)
  - `outreach`: connectionMessage, followUpDelay
  - `nurture`: engagementFrequency, contentTypes

**System prompt AI assist:**
"Generate prompt" button calls `generateText()` with:
```
Generate a system prompt for a {templateType} workflow template.
Description: {description}
Target persona: {targetPersona}
Platform: {platform}
Follow the same format as existing templates (## Objective, ## Process, ## Rules sections).
```

**Clone from existing:** "Use as starting point" button on any template card in the gallery pre-fills builder with that template's data, sets `sourceTemplateId`. System template fields that shouldn't be modified are editable when cloned (the clone is a user template).

### 7.6 Template Library Tabs

Update `template-gallery.tsx` to have two sections:

- **System Templates** (read-only, `isSystem = 1`): The 7 seed templates. Run and Schedule buttons only.
- **My Templates** (`isSystem = 0`): User-created templates. Run, Schedule, Edit, and Delete buttons.

Filter tabs update to include all template types.

### 7.7 New Seed Templates

Add to `src/lib/db/seed-templates.ts` for Phase 6 template types:

```ts
// Append to SEED_TEMPLATES array:

{
  name: "Thought Leadership Posts",
  description: "Generate weekly thought leadership posts based on CRM insights and industry trends. Analyzes your contacts' interests to suggest relevant topics.",
  templateType: "content",
  targetPersona: "Your professional audience on X and LinkedIn",
  estimatedCost: 0.15,
  systemPrompt: `You are a content strategist creating thought leadership posts.

## Objective
Generate insightful posts that position the user as a thought leader.

## Process
1. Analyze the provided contact personas and their interests
2. Identify trending topics in their industry
3. Generate 2-3 post variations with different angles
4. Use \`publish_content\` to publish the best variation

## Rules
- Focus on insights, not self-promotion
- Each post should teach something or challenge a common assumption
- Keep posts concise and impactful`,
  config: { topics: [], tone: "thought-leader", frequency: "weekly" },
},
{
  name: "Reply to Mentions",
  description: "Automatically generate contextual replies to recent mentions and comments. Reviews mentions and crafts thoughtful responses.",
  templateType: "engagement",
  targetPersona: "People who mention or engage with your content",
  estimatedCost: 0.20,
  systemPrompt: `You are an engagement agent that replies to mentions.

## Objective
Find recent mentions and craft contextual, helpful replies.

## Process
1. Search for recent mentions and comments
2. For each mention, understand the context
3. Use \`engage_post\` to reply with a thoughtful response
4. Report progress after each reply

## Rules
- Be genuine and helpful, never spammy
- Match the tone of the original post
- Add value with each reply (insight, resource, or encouragement)`,
  config: { maxReplies: 10, platforms: ["x"] },
},
{
  name: "Cold Intro via Comments",
  description: "Find posts by target audience members and leave insightful comments to start conversations. A non-invasive approach to outreach.",
  templateType: "outreach",
  targetPersona: "Potential leads and industry connections",
  estimatedCost: 0.25,
  systemPrompt: `You are an outreach agent that builds relationships through insightful comments.

## Objective
Find posts by target personas and leave valuable comments to start conversations.

## Process
1. Search for recent posts by the target audience
2. Read each post to understand the topic
3. Use \`engage_post\` to leave an insightful comment
4. Report progress after each engagement

## Rules
- Never sell or pitch in comments
- Add genuine value (a unique perspective, relevant data, or thoughtful question)
- Vary your approach — don't repeat the same comment patterns`,
  config: { maxEngagements: 5, platforms: ["x", "linkedin"] },
},
```

Update `seedTemplates()` to only seed if total templates = 0 (existing behavior), but mark new templates with `isSystem: 1`.

### 7.8 New Agent Tools

#### `publish_content` — 8th Agent Tool

```ts
// src/lib/agents/tools/publish-content.ts

export async function publishContentTool(
  platform: "x" | "linkedin",
  text: string,
  workflowRunId: string,
  opts?: { mediaAssetIds?: string[]; mode?: "auto" | "review" }
): Promise<PublishContentResult> {
  const startTime = Date.now();

  // Create a content item for tracking
  const contentItem = createContentItem({
    body: text,
    contentType: "post",
    status: "draft",
    origin: "authored",
    direction: "outbound",
    platformTarget: platform,
  });

  // Publish via browser
  const publisher = platform === "x"
    ? new XPublisher()
    : new LinkedInPublisher();

  const result = await publisher.publish({
    platform,
    mode: opts?.mode ?? "auto",
    text,
    mediaAssetIds: opts?.mediaAssetIds,
    contentItemId: contentItem.id,
  });

  // Log workflow step
  createWorkflowStep({
    workflowRunId,
    stepIndex: nextStepIndex(workflowRunId),
    stepType: "content_publish",
    status: result.success ? "completed" : "failed",
    url: result.platformUrl,
    tool: "publish_content",
    input: JSON.stringify({ platform, text: text.slice(0, 200) }),
    output: JSON.stringify(result),
    durationMs: Date.now() - startTime,
  });

  // Update content item status
  updateContentItem(contentItem.id, {
    status: result.success ? "published" : "draft",
  });

  return {
    success: result.success,
    platformUrl: result.platformUrl,
    error: result.error,
  };
}
```

Registered in `run-agent-workflow.ts` tools object:

```ts
publish_content: tool({
  description: "Publish content to X or LinkedIn via browser automation. Returns the published post URL.",
  inputSchema: z.object({
    platform: z.enum(["x", "linkedin"]).describe("Target platform"),
    text: z.string().describe("The post content text"),
  }),
  execute: async ({ platform, text }) => {
    return publishContentTool(platform, text, runId);
  },
}),
```

#### `engage_post` — 9th Agent Tool

```ts
// src/lib/agents/tools/engage-post.ts

export async function engagePostTool(
  platform: "x" | "linkedin",
  postUrl: string,
  action: "like" | "reply" | "retweet",
  workflowRunId: string,
  opts?: { replyText?: string }
): Promise<EngagePostResult> {
  const startTime = Date.now();

  const session = loadSession(platform as BrowserPlatform);
  if (!session) {
    return { success: false, error: "No browser session" };
  }

  const { browser, context } = await createSessionContext(session);
  const page = await context.newPage();

  try {
    await page.goto(postUrl, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    let success = false;

    if (platform === "x") {
      switch (action) {
        case "like":
          await page.click('[data-testid="like"]');
          success = true;
          break;
        case "retweet":
          await page.click('[data-testid="retweet"]');
          await page.click('[data-testid="retweetConfirm"]');
          success = true;
          break;
        case "reply":
          if (opts?.replyText) {
            await page.click('[data-testid="reply"]');
            await page.waitForSelector('[data-testid="tweetTextarea_0"]');
            await page.keyboard.type(opts.replyText, { delay: 20 });
            await page.click('[data-testid="tweetButton"]');
            success = true;
          }
          break;
      }
    }
    // LinkedIn engagement selectors would go here

    createWorkflowStep({
      workflowRunId,
      stepIndex: nextStepIndex(workflowRunId),
      stepType: "engagement_action",
      status: success ? "completed" : "failed",
      url: postUrl,
      tool: "engage_post",
      input: JSON.stringify({ platform, postUrl, action }),
      output: JSON.stringify({ success }),
      durationMs: Date.now() - startTime,
    });

    return { success };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await browser.close();
  }
}
```

Registered in `run-agent-workflow.ts`:

```ts
engage_post: tool({
  description: "Engage with a post on X or LinkedIn (like, reply, or retweet) via browser automation.",
  inputSchema: z.object({
    platform: z.enum(["x", "linkedin"]).describe("Platform"),
    postUrl: z.string().describe("URL of the post to engage with"),
    action: z.enum(["like", "reply", "retweet"]).describe("Engagement action"),
    replyText: z.string().optional().describe("Reply text (required for reply action)"),
  }),
  execute: async ({ platform, postUrl, action, replyText }) => {
    return engagePostTool(platform, postUrl, action, runId, { replyText });
  },
}),
```

---

## 8. Schema Changes Summary

### 8.1 New Tables (4)

| Table | Purpose | FKs |
|-------|---------|-----|
| `media_assets` | Uploaded media files (images, video) | -> `contentItems` |
| `goals` | Demand generation goals | — |
| `goal_workflows` | Links goals to contributing templates | -> `goals`, -> `workflowTemplates` |
| `goal_progress` | Time-series goal tracking snapshots | -> `goals` |

### 8.2 Modified Tables

| Table | Change | Migration |
|-------|--------|-----------|
| `workflowTemplates` | Add `isSystem` (integer, default 0), `sourceTemplateId` (text, FK self-ref) | ALTER TABLE |
| `workflowRuns.workflowType` | Add `"content"`, `"engagement"`, `"outreach"` to enum | Schema update (SQLite text columns are untyped — no migration needed, just update the Drizzle enum) |
| `workflowSteps.stepType` | Add `"content_publish"` to enum | Same — update Drizzle enum only |

### 8.3 Unchanged Tables

- `contentItems` — `mediaPaths` column already exists (will now be populated with `mediaAsset.id` references)
- `contentPosts` — Used as-is for browser-published posts
- All other tables — no changes

### 8.4 New Enum Values

```ts
// WorkflowType additions
type WorkflowType = "sync" | "enrich" | "search" | "prune" | "sequence" | "agent"
  | "content" | "engagement" | "outreach";

// WorkflowStepType addition
type WorkflowStepType = /* existing */ | "content_publish";
```

### 8.5 New Types

```ts
// src/lib/db/types.ts — additions
export type MediaAsset = InferSelectModel<typeof mediaAssets>;
export type NewMediaAsset = InferInsertModel<typeof mediaAssets>;
export type Goal = InferSelectModel<typeof goals>;
export type NewGoal = InferInsertModel<typeof goals>;
export type GoalWorkflow = InferSelectModel<typeof goalWorkflows>;
export type NewGoalWorkflow = InferInsertModel<typeof goalWorkflows>;
export type GoalProgress = InferSelectModel<typeof goalProgress>;
export type NewGoalProgress = InferInsertModel<typeof goalProgress>;
```

---

## 9. New Files & Modules

### 9.1 Browser Publishers

```
src/lib/browser/publishers/
  types.ts                     — PublishRequest, PublishResult, PublishMode, PublishError
  base-publisher.ts            — Abstract base: session check, context creation, screenshot, media resolution
  x-publisher.ts               — X compose flow: selectors, media upload, thread chaining
  linkedin-publisher.ts        — LinkedIn compose flow: selectors, media/document upload
```

### 9.2 Agent Tools

```
src/lib/agents/tools/
  publish-content.ts           — 8th agent tool: publish via browser, logs content_publish step
  engage-post.ts               — 9th agent tool: like/reply/retweet via browser, logs engagement_action step
```

### 9.3 Query Modules

```
src/lib/db/queries/
  media.ts                     — MediaAsset CRUD (create, get, list, delete, link/unlink)
  goals.ts                     — Goal + GoalProgress + GoalWorkflow CRUD + auto-progress computation
```

### 9.4 API Routes

```
src/app/api/
  media/route.ts               — POST (multipart upload), GET (list)
  media/[id]/route.ts          — GET (serve file), DELETE

  content/ai-generate/route.ts — POST: AI content generation (draft/suggest/refine modes)
  content/publish/route.ts     — POST: trigger browser-based publishing

  goals/route.ts               — GET (list), POST (create)
  goals/[id]/route.ts          — GET (detail), PUT (update), DELETE
  goals/[id]/progress/route.ts — GET (progress history for charts)
  goals/[id]/link-workflow/route.ts — POST (link a template to a goal)
```

### 9.5 UI Components

```
src/components/
  compose-dialog.tsx           — MODIFIED: platform tabs, media attachment, publish mode toggle, schedule picker, AI assist integration

src/app/dashboard/content/
  content-calendar.tsx         — Calendar view (week/month grid of scheduled + published content)
  ai-assist-panel.tsx          — AI content generation sidebar (mode selector, generate, insert)
  content-list-client.tsx      — MODIFIED: add List | Calendar tab bar

src/app/dashboard/workflows/
  template-builder.tsx         — User template creation form (name, type, prompt, config)
  template-gallery.tsx         — MODIFIED: System Templates | My Templates tabs, add Edit/Delete for user templates

src/app/dashboard/goals/
  page.tsx                     — Goals dashboard page (server component)
  goal-card.tsx                — Individual goal card (progress bar, deadline, workflows)
  goal-detail.tsx              — Goal detail with progress trend chart
  goal-create-dialog.tsx       — Goal creation dialog (name, type, target, deadline, linked templates)
```

---

## 10. Implementation Phases

### Phase 6A — Media System + Enhanced Compose (Foundation)

**New files:**
- `src/lib/db/queries/media.ts`
- `src/app/api/media/route.ts`
- `src/app/api/media/[id]/route.ts`

**Modified files:**
- `src/lib/db/schema.ts` — add `mediaAssets` table
- `src/lib/db/types.ts` — add `MediaAsset`, `NewMediaAsset`
- `src/components/compose-dialog.tsx` — platform tabs, media attachment, character counters
- `src/app/dashboard/content/content-list-client.tsx` — List | Calendar tab bar
- `src/app/dashboard/content/content-calendar.tsx` — new calendar view component

**Deliverables:**
- Upload media files with platform validation
- Compose for X and LinkedIn with media previews
- Content calendar view with scheduled + published items

### Phase 6B — Browser Publishing (Core Differentiator)

**New files:**
- `src/lib/browser/publishers/types.ts`
- `src/lib/browser/publishers/base-publisher.ts`
- `src/lib/browser/publishers/x-publisher.ts`
- `src/lib/browser/publishers/linkedin-publisher.ts`
- `src/app/api/content/publish/route.ts`
- `src/lib/agents/tools/publish-content.ts`

**Modified files:**
- `src/lib/scheduler/runner.ts` — add `content_publish` job type handler
- `src/lib/agents/run-agent-workflow.ts` — register `publish_content` tool
- `src/lib/workflows/types.ts` — add `"content"` to WorkflowType, `"content_publish"` to WorkflowStepType
- `src/components/compose-dialog.tsx` — publish mode toggle (auto/review), schedule picker

**Deliverables:**
- Browser-based publishing for X and LinkedIn (auto + review modes)
- Media upload via browser file input
- Thread publishing for X
- Scheduled publishing via existing scheduler
- `publish_content` agent tool for workflow-driven publishing

### Phase 6C — AI Content Creation

**New files:**
- `src/app/api/content/ai-generate/route.ts`
- `src/app/dashboard/content/ai-assist-panel.tsx`

**Modified files:**
- `src/components/compose-dialog.tsx` — integrate AI Assist panel

**Deliverables:**
- Three AI content modes: draft, suggest, refine
- Multi-platform adaptation ("Adapt for X/LinkedIn")
- AI Assist panel in compose dialog
- Context injection from goals and contacts

### Phase 6D — Goals & Demand Generation

**New files:**
- `src/lib/db/queries/goals.ts`
- `src/app/api/goals/route.ts`
- `src/app/api/goals/[id]/route.ts`
- `src/app/api/goals/[id]/progress/route.ts`
- `src/app/api/goals/[id]/link-workflow/route.ts`
- `src/app/dashboard/goals/page.tsx`
- `src/app/dashboard/goals/goal-card.tsx`
- `src/app/dashboard/goals/goal-detail.tsx`
- `src/app/dashboard/goals/goal-create-dialog.tsx`

**Modified files:**
- `src/lib/db/schema.ts` — add `goals`, `goalWorkflows`, `goalProgress` tables
- `src/lib/db/types.ts` — add Goal types
- `src/lib/agents/run-agent-workflow.ts` — add goal progress update at end of `executeAgentLoop()`

**Deliverables:**
- Goals CRUD with progress tracking
- Goal dashboard UI with progress bars and trend charts
- Goal-workflow linking
- Auto-progress updates from workflow completions

### Phase 6E — User Templates + New Workflow Types

**New files:**
- `src/app/dashboard/workflows/template-builder.tsx`
- `src/lib/agents/tools/engage-post.ts`

**Modified files:**
- `src/lib/db/schema.ts` — add `isSystem`, `sourceTemplateId` to `workflowTemplates`
- `src/lib/db/seed-templates.ts` — add 3 new seed templates, mark all seeds with `isSystem: 1`
- `src/app/dashboard/workflows/template-gallery.tsx` — System/My Templates tabs, Edit/Delete buttons
- `src/lib/agents/run-agent-workflow.ts` — register `engage_post` tool
- `src/lib/db/queries/workflow-templates.ts` — add `isSystem` filter support

**Deliverables:**
- Template builder with AI-assisted prompt generation
- Clone existing templates
- System Templates vs My Templates library tabs
- 3 new seed templates (content, engagement, outreach)
- `engage_post` agent tool for browser-based engagement

---

## 11. Cross-Reference Verification

### 11.1 Schema Consistency

- All new tables use the standard `timestamps` helper (`createdAt`, `updatedAt` with `unixepoch()` defaults)
- All IDs use `nanoid()` (consistent with all existing tables)
- All FKs use `onDelete: "cascade"` or `"set null"` (consistent with existing patterns)
- `goalProgress` uses `snapshotAt` (not `createdAt`) for the time-series timestamp, matching `engagementMetrics.snapshotAt`

### 11.2 API Route Patterns

- All routes follow `NextRequest`/`NextResponse` pattern
- All input validated with Zod schemas
- All async route handlers with `await params` for Next.js 16
- Error responses use `{ error: string }` format with appropriate status codes

### 11.3 No Conflicts with Existing Specs

- **00-init**: Boot flow unchanged — `~/.openvolo/media/` already created
- **01-origin**: Contact model unchanged
- **02-channels**: Platform accounts unchanged
- **03-content-sync**: Content model extended, not replaced
- **04-frontend-design**: UI patterns consistent (shadcn/ui, Tailwind v4)
- **05-browser-enrichment**: Session infrastructure reused, not modified
- **06-unified-workflows**: Workflow system extended with new types
- **07-agentic-workflows**: Agent tools extended, runner loop gets goal integration point

### 11.4 Browser Publisher Compatibility

- `createSessionContext()` from `session.ts` is reused directly for auto mode
- `launchPersistentContext()` with `STEALTH_ARGS` reused for review mode
- `loadSession()` / `hasSession()` used for session validation
- `BrowserPlatform` type (`"x" | "linkedin"`) matches publisher targets
- Anti-detection delays (`sleep()`, `randomDelay()`) available from `anti-detection.ts`

### 11.5 Agent Tool Pattern Compliance

Both new tools follow the established pattern:
- Registered via Vercel AI SDK `tool()` with `inputSchema` (Zod) + `execute` (async)
- Log `workflowStep` records via `createWorkflowStep()` + `nextStepIndex()`
- Record `durationMs` for performance tracking
- Return structured result objects
- Accept `workflowRunId` for step association
