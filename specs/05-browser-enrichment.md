# Browser Enrichment Framework

> **Superseded (2026-08)** — Describes pre-#5 in-process Playwright + Vercel AI SDK enrichment.
> **Current path:** [`docs/rtx-agent-browser-enrichment.md`](../docs/rtx-agent-browser-enrichment.md) and [`docs/realtimex-local-app.md`](../docs/realtimex-local-app.md).
> Retained for historical context; do not implement new work from this spec.

> Multi-platform Playwright-based browser enrichment for OpenVolo contacts.
> Scrapes profile pages and uses LLM extraction to fill CRM fields that
> platform APIs cannot provide. X/Twitter is the first implementation;
> the architecture supports LinkedIn profiles and personal websites.
> See [`specs/02-channels.md`](./02-channels.md) for the contacts golden record.

---

## 1. Overview & Motivation

### 1.1 The Gap

X API (Free tier) returns basic profile data — `name`, `bio`, `location`,
`website`, `photoUrl`, follower/following counts, and the handle. Critical
CRM fields remain empty:

| Field | X API provides? | Browser can extract? |
|-------|:-:|:-:|
| `name`, `bio`, `location`, `website` | Yes | Yes |
| `photoUrl`, `avatarUrl` | Yes | Yes |
| `company` | No | Yes (from bio text) |
| `title` | No | Yes (from bio text) |
| `headline` | No | Yes (synthesized from bio) |
| `email` | No | Sometimes (bio / pinned tweet) |
| `phone` | No | Rarely (bio text) |
| `skills`, `interests` | No | Yes (from bio + tweets) |
| `previousCompanies` | No | Yes (from bio text) |

### 1.2 Enrichment Score Impact

The enrichment score is calculated in `src/lib/db/enrichment.ts`. Every
contact write triggers `recalcEnrichment(contactId)`.

**Current scoring breakdown (max 100):**

| Category | Points | Fields |
|----------|--------|--------|
| Full name | 10 | `firstName` + `lastName` |
| Email (verified / unverified) | 15 / 10 | `email` |
| Phone | 10 | `phone` |
| Headline | 5 | `headline` |
| Company | 5 | `company` |
| Title | 5 | `title` |
| Location | 5 | `location` |
| Bio | 5 | `bio` |
| Photo | 5 | `photoUrl` or `avatarUrl` |
| Website | 5 | `website` |
| 2+ active identities | 10 | `contactIdentities.isActive` |
| 3+ active identities | +5 | Bonus |
| Rich platformData (>3 fields) | 10 | Any identity's JSON |
| Platform handles | 1-5 | 1 per handle, max 5 |

**Score progression with browser enrichment:**

| Source | Fields Filled | Approx Score |
|--------|--------------|:---:|
| X API only | name, bio, location, website, photo, 1 handle | ~31 |
| + Bio parsing | + company, title, headline | ~46 |
| + Email found in bio | + email | ~56 |
| + Rich platformData | + skills, interests, previousCompanies | ~66 |
| + Multiple identities | + cross-platform matches | ~71 |

### 1.3 Multi-Platform Vision

The framework is designed for three enrichment sources:

1. **X/Twitter** (this spec) — Bio text, pinned tweet, recent tweets
2. **LinkedIn** (future) — Public profile headline, experience, education
3. **Personal websites** (future) — Contact pages, about pages, structured data

Each platform gets its own scraper in `src/lib/browser/platforms/` but shares
the session manager, anti-detection layer, and LLM extractor.

---

## 2. Architecture — Three-Layer Design

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Platform Scrapers                                 │
│  src/lib/browser/platforms/                                 │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ x-scraper.ts │  │ linkedin-scraper │  │ website-scrap │ │
│  │  (this spec) │  │    (future)      │  │   (future)    │ │
│  └──────┬───────┘  └────────┬─────────┘  └───────┬───────┘ │
├─────────┼──────────────────┼──────────────────────┼─────────┤
│  Layer 2: LLM Extractors                                    │
│  src/lib/browser/extractors/                                │
│  ┌────────────────────────┐  ┌──────────────────────────┐   │
│  │ profile-parser.ts      │  │ profile-merger.ts        │   │
│  │ generateObject() +     │  │ "fill gaps, don't        │   │
│  │ Zod schema             │  │  overwrite" merge        │   │
│  └────────────────────────┘  └──────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Browser Engine (deterministic)                    │
│  src/lib/browser/                                           │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────────────────┐ │
│  │ session.ts   │ │ scraper.ts  │ │ anti-detection.ts     │ │
│  │ cookie store │ │ base class  │ │ delays, scroll, batch │ │
│  └─────────────┘ └─────────────┘ └───────────────────────┘ │
│  types.ts — shared types                                    │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Design Principle: Deterministic Browser + LLM Extraction

Playwright handles **all browser automation deterministically** — navigation,
DOM queries, scrolling, waiting. No LLM is involved in browser control.

Vercel AI SDK 6 `generateObject()` with Zod schemas handles **text parsing
only** — converting unstructured bio/tweet text into structured contact fields.
This is a single API call per profile, not a multi-step agent workflow.
Claude Agent SDK is not needed.

---

## 3. Layer 1 — Browser Engine

### 3.1 `src/lib/browser/types.ts`

```typescript
/** Platform identifiers for browser sessions */
export type BrowserPlatform = "x" | "linkedin";

/** Stored session (encrypted at rest) */
export interface BrowserSession {
  platform: BrowserPlatform;
  cookies: CookieData[];
  userAgent: string;
  viewport: { width: number; height: number };
  createdAt: number;       // Unix seconds
  lastValidatedAt: number; // Unix seconds
  expiresAt?: number;      // Unix seconds (platform-specific)
}

/** Serialized cookie (matches Playwright's Cookie type) */
export interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

/** Anti-detection configuration */
export interface AntiDetectionConfig {
  /** Min delay between page loads (ms) */
  minDelay: number;
  /** Max delay between page loads (ms) */
  maxDelay: number;
  /** Max profiles per session batch */
  batchLimit: number;
  /** Cooldown between batches (ms) */
  batchCooldown: number;
  /** Scroll range after page load (px) */
  scrollMin: number;
  scrollMax: number;
}

/** Raw text extracted from a profile page */
export interface RawProfileData {
  platform: BrowserPlatform;
  platformHandle: string;
  displayName: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  pinnedTweetText: string | null;
  recentTweetTexts: string[];
  followerCount: number | null;
  followingCount: number | null;
  scrapedAt: number; // Unix seconds
}

/** Result from the LLM extractor */
export interface ParsedProfileData {
  company: string | null;
  title: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  skills: string[];
  interests: string[];
  previousCompanies: string[];
  industry: string | null;
  confidence: number; // 0.0 - 1.0
}

/** Per-profile scrape result */
export interface ScrapeResult {
  contactId: string;
  platformHandle: string;
  raw: RawProfileData | null;
  parsed: ParsedProfileData | null;
  merged: boolean;
  error?: string;
}
```

### 3.2 `src/lib/browser/session.ts`

Manages Playwright browser contexts with persistent cookies.

**Key responsibilities:**
- Store/load session cookies encrypted at `~/.openvolo/sessions/{platform}-browser.json`
- Launch Playwright browser context with stored cookies + viewport
- Validate sessions (navigate to platform, check logged-in state)
- Detect session expiry and signal re-authentication needed

**Session storage path:** `~/.openvolo/sessions/x-browser.json` (same
directory pattern as existing `sessions/` dir created by CLI).

**Encryption:** Uses existing `encrypt()` / `decrypt()` from
`src/lib/auth/crypto.ts` (AES-256-GCM, machine-specific passphrase).

```typescript
// Session file structure (encrypted at rest)
{
  platform: "x",
  cookies: [...],      // Playwright cookies
  userAgent: "...",
  viewport: { width: 1366, height: 768 },
  createdAt: 1738900000,
  lastValidatedAt: 1738900000
}
```

**Manual login flow:**
1. User clicks "Setup Browser Session" in Settings
2. API route launches Playwright in **headed mode** (visible browser)
3. Navigates to `https://x.com/login`
4. User logs in manually (handles 2FA, CAPTCHA — we never automate auth)
5. On completion, cookies are captured and stored encrypted
6. Browser closes, session is ready for headless use

**Session validation:**
1. Before each enrichment batch, load cookies into a headless context
2. Navigate to `https://x.com/home`
3. Check for logged-in indicators (presence of compose button, absence of login prompt)
4. If invalid → mark session as expired, return error to UI
5. If valid → update `lastValidatedAt`, proceed with batch

### 3.3 `src/lib/browser/anti-detection.ts`

Provides delay, scroll, and viewport randomization utilities.

**Default configuration:**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `minDelay` | 8000ms | Below 5s triggers rate detection |
| `maxDelay` | 20000ms | Above 25s wastes time |
| Delay distribution | Normal (Gaussian) | Uniform random looks robotic |
| `scrollMin` | 300px | Simulate reading page |
| `scrollMax` | 800px | Don't scroll past content |
| `batchLimit` | 15-20 profiles | X monitors rapid profile visits |
| `batchCooldown` | 30 minutes | Cool down between batches |
| Sequential only | No parallel tabs | Multiple tabs trigger detection |

**Delay strategy:**
```typescript
/** Generate a normally distributed random delay between min and max (ms). */
export function randomDelay(min: number, max: number): number {
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  // Map to [min, max] range, centered at midpoint
  const mid = (min + max) / 2;
  const spread = (max - min) / 6; // 99.7% within range
  return Math.max(min, Math.min(max, Math.round(mid + z * spread)));
}
```

**Scroll simulation:**
```typescript
/** Simulate human-like scroll after page load. */
export async function simulateScroll(page: Page, config: AntiDetectionConfig): Promise<void> {
  const distance = randomInRange(config.scrollMin, config.scrollMax);
  const steps = randomInRange(3, 7); // Scroll in multiple steps
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, distance / steps);
    await sleep(randomInRange(100, 400));
  }
}
```

**Viewport variation:**
```typescript
/** Common desktop viewports to rotate through. */
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
];
```

### 3.4 `src/lib/browser/scraper.ts`

Base scraper class providing shared behavior for all platform scrapers.

```typescript
export abstract class BaseScraper {
  protected session: BrowserSession;
  protected config: AntiDetectionConfig;
  protected context: BrowserContext | null = null;

  /** Initialize Playwright context with stored cookies. */
  async init(): Promise<void>;

  /** Validate session is still active. Platform-specific. */
  abstract validateSession(): Promise<boolean>;

  /** Navigate to URL with anti-detection delays. */
  protected async navigateWithDelay(url: string): Promise<Page>;

  /** Close browser context and clean up. */
  async close(): Promise<void>;

  /** Get number of profiles scraped in current batch. */
  get profilesScraped(): number;

  /** Check if batch limit reached. */
  get batchLimitReached(): boolean;
}
```

---

## 4. Layer 2 — LLM Extractors

### 4.1 `src/lib/browser/extractors/profile-parser.ts`

Uses Vercel AI SDK 6 `generateObject()` to extract structured data from
unstructured profile text.

**Model:** Claude Sonnet (via `@ai-sdk/anthropic`)
**Method:** `generateObject()` with Zod schema
**Input:** ~500 tokens (bio + 3-5 tweet texts)
**Output:** ~200 tokens (structured JSON)
**Cost:** ~$0.002/profile, ~$2/1000 contacts

**Zod schema:**

```typescript
import { z } from "zod";

export const profileExtractionSchema = z.object({
  company: z.string().nullable()
    .describe("Current company or organization. Extract from patterns like 'CTO @Company', 'Working at Company', 'Company.com'. Null if not stated."),
  title: z.string().nullable()
    .describe("Professional title or role. Extract from patterns like 'CTO', 'Software Engineer', 'Founder'. Null if not stated."),
  headline: z.string().nullable()
    .describe("Professional headline synthesized from bio. A one-line summary of who this person is. Null if bio is too vague."),
  email: z.string().email().nullable()
    .describe("Email address if explicitly present in bio or tweets. Null if not found. Must be a valid email format."),
  phone: z.string().nullable()
    .describe("Phone number if explicitly present. Null if not found."),
  skills: z.array(z.string())
    .describe("Technical or professional skills mentioned. E.g., ['AI/ML', 'React', 'Product Management']. Empty array if none found."),
  interests: z.array(z.string())
    .describe("Professional interests or topics they engage with. E.g., ['Open Source', 'Startups', 'Climate Tech']. Empty array if none found."),
  previousCompanies: z.array(z.string())
    .describe("Past companies mentioned. Extract from patterns like 'ex-@Google', 'former VP at Meta'. Empty array if none found."),
  industry: z.string().nullable()
    .describe("Primary industry. E.g., 'Technology', 'Finance', 'Healthcare'. Null if unclear."),
  confidence: z.number().min(0).max(1)
    .describe("Overall confidence in extractions. 1.0 = explicitly stated, 0.5 = strongly implied, 0.0 = guessing."),
});

export type ProfileExtraction = z.infer<typeof profileExtractionSchema>;
```

**System prompt:**

```
You extract structured professional information from social media profiles.

Rules:
- Only extract information that is explicitly stated or strongly implied
- Set fields to null when information is missing — never guess
- Email must be a valid format if present (check for @ and domain)
- The "headline" field should synthesize who this person is professionally
- Skills and interests should be concise tags, not sentences
- Previous companies should be company names only, not roles
- Confidence reflects how certain you are about ALL extractions combined
```

**User prompt template:**

```
Extract professional information from this X/Twitter profile.

Display Name: {displayName}
Bio: {bio}
Location: {location}
Website: {website}

Pinned Tweet: {pinnedTweetText}

Recent Tweets:
{recentTweetTexts.map(t => `- ${t}`).join("\n")}
```

**Implementation pattern:**

```typescript
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export async function parseProfile(raw: RawProfileData): Promise<ParsedProfileData> {
  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-5-20250929"),
    schema: profileExtractionSchema,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(raw),
  });
  return object;
}
```

### 4.2 `src/lib/browser/extractors/profile-merger.ts`

Merges parsed profile data into existing contact fields using a
"fill gaps, don't overwrite" strategy.

**Merge rules:**

| Contact Field | Merge Behavior |
|--------------|----------------|
| `company` | Fill if currently null/empty |
| `title` | Fill if currently null/empty |
| `headline` | Fill if currently null/empty |
| `email` | Fill if currently null/empty |
| `phone` | Fill if currently null/empty |
| `metadata` | **Additive merge** — add `browserEnrichment` key |
| `bio` | Never overwrite (API bio is canonical) |
| `name`, `location`, `website` | Never overwrite (API is canonical) |

**Metadata merge pattern** (follows `sync-gmail-metadata.ts`):

```typescript
export function mergeProfileData(
  contact: Contact,
  parsed: ParsedProfileData,
  raw: RawProfileData
): Partial<NewContact> {
  const updates: Partial<NewContact> = {};

  // Fill gaps — only set if contact field is currently empty
  if (!contact.company && parsed.company) updates.company = parsed.company;
  if (!contact.title && parsed.title) updates.title = parsed.title;
  if (!contact.headline && parsed.headline) updates.headline = parsed.headline;
  if (!contact.email && parsed.email) updates.email = parsed.email;
  if (!contact.phone && parsed.phone) updates.phone = parsed.phone;

  // Additive metadata merge (same pattern as gmail metadata)
  const existingMetadata = contact.metadata
    ? JSON.parse(contact.metadata)
    : {};

  const updatedMetadata = {
    ...existingMetadata,
    browserEnrichment: {
      source: raw.platform,
      scrapedAt: raw.scrapedAt,
      confidence: parsed.confidence,
      skills: parsed.skills,
      interests: parsed.interests,
      previousCompanies: parsed.previousCompanies,
      industry: parsed.industry,
    },
  };

  updates.metadata = JSON.stringify(updatedMetadata);

  return updates;
}
```

**Identity platformData update:**

In addition to contact-level fields, the scraper updates the X identity's
`platformData` JSON to include extracted skills/interests/previousCompanies.
This triggers the "rich platformData" bonus in enrichment scoring (+10 pts
when >3 fields present).

```typescript
export function buildPlatformDataUpdate(
  existingPlatformData: string | null,
  parsed: ParsedProfileData
): string {
  const existing = existingPlatformData
    ? JSON.parse(existingPlatformData)
    : {};

  return JSON.stringify({
    ...existing,
    skills: parsed.skills,
    interests: parsed.interests,
    previousCompanies: parsed.previousCompanies,
    industry: parsed.industry,
    enrichedAt: Math.floor(Date.now() / 1000),
  });
}
```

---

## 5. Layer 3 — Platform Scrapers

### 5.1 `src/lib/browser/platforms/x-scraper.ts`

Extends `BaseScraper` to scrape X/Twitter profile pages.

**Navigation target:** `https://x.com/{handle}`

**Session validation:**
1. Navigate to `https://x.com/home`
2. Wait for page load (networkidle or 5s timeout)
3. Check for `[data-testid="primaryColumn"]` — present when logged in
4. Check for `[data-testid="loginButton"]` — present when logged out
5. Return `true` if logged in, `false` if logged out or ambiguous

**DOM extraction targets:**

| Data | Selector Strategy | Notes |
|------|------------------|-------|
| Display name | `[data-testid="UserName"] > div:first-child` | First child div has display name |
| Bio | `[data-testid="UserDescription"]` | `textContent` preserves line breaks |
| Location | `[data-testid="UserLocation"]` | May be absent |
| Website | `[data-testid="UserUrl"] a` | `href` attribute, may be t.co shortened |
| Pinned tweet | `[data-testid="tweet"][tabindex="0"]` with pin icon | First tweet with pin indicator |
| Recent tweets | `[data-testid="tweet"]` | First 3-5 tweets, skip retweets |
| Follower count | `a[href$="/followers"] span` | Text content |
| Following count | `a[href$="/following"] span` | Text content |

**Important:** Selectors may change when X updates their UI. The scraper
should use defensive extraction — `try/catch` around each field, returning
`null` for fields that fail to extract, rather than failing the entire profile.

**Retweet detection:** Skip tweets that contain `[data-testid="socialContext"]`
with "Reposted" text — these are retweets, not original content.

**Website URL resolution:** X shortens links through `t.co`. The DOM
`<a>` tag's visible text typically shows the real URL. Extract visible text
content rather than `href` to avoid t.co URLs.

**Scrape flow per profile:**

```
1. navigateWithDelay("https://x.com/{handle}")
2. Wait for [data-testid="UserName"] (max 10s)
3. simulateScroll() — anti-detection
4. Extract all DOM fields into RawProfileData
5. Return ScrapeResult
```

### 5.2 Future Scrapers (out of scope)

**`linkedin-scraper.ts`** — LinkedIn public profiles show headline,
current position, education. Requires separate session management.

**`website-scraper.ts`** — Personal websites linked from X profiles.
No session needed (public). Extract contact info, about pages.

---

## 6. Session Management

### 6.1 Session Lifecycle

```
┌──────────┐   User clicks    ┌──────────────┐   User logs in   ┌───────────┐
│  No       │ "Setup Session" │  Headed       │    manually      │  Session   │
│  Session  │ ──────────────→ │  Browser      │ ───────────────→ │  Stored   │
│           │                 │  (visible)    │                  │ (encrypted)│
└──────────┘                  └──────────────┘                  └─────┬─────┘
                                                                      │
                              ┌──────────────┐   Validation     ┌─────▼─────┐
                              │  Session      │    fails         │  Session   │
                              │  Expired      │ ←────────────── │  Active    │
                              │  (prompt user)│                  │ (headless) │
                              └──────────────┘                  └───────────┘
```

### 6.2 Session Storage

**Path:** `~/.openvolo/sessions/{platform}-browser.json`

**Contents:** AES-256-GCM encrypted JSON containing `BrowserSession` object.

**CLI integration:** The `bin/cli.ts` boot flow already creates
`~/.openvolo/sessions/`. No directory changes needed.

### 6.3 Session API Routes

**`POST /api/platforms/x/browser-session`** — Launch headed browser for login

Request: `{ action: "setup" }`
Response: `{ status: "waiting_for_login" }` (starts browser, waits for user)

**`GET /api/platforms/x/browser-session`** — Check session status

Response: `{ hasSession: boolean, lastValidatedAt?: number, isValid?: boolean }`

**`DELETE /api/platforms/x/browser-session`** — Clear stored session

Response: `{ status: "cleared" }`

### 6.4 Playwright as Project Dependency

Playwright is added as a regular project dependency, **not** used via MCP.

```json
// package.json
{
  "dependencies": {
    "playwright": "^1.50.0"
  }
}
```

**First-boot browser install:** The CLI (`bin/cli.ts`) checks if the
Playwright Chromium binary exists on startup. If not, runs
`npx playwright install chromium` automatically. This is a one-time download.

---

## 7. Orchestration — Sync Pattern

### 7.1 `src/lib/platforms/sync-x-profiles.ts`

Follows the exact pattern from `sync-gmail-metadata.ts`:

```typescript
import type { SyncResult } from "@/lib/platforms/adapter";
import { getSyncCursor, updateSyncCursor } from "@/lib/db/queries/sync";
import { updateContact, getContactById } from "@/lib/db/queries/contacts";
import { updatePlatformAccount } from "@/lib/db/queries/platform-accounts";
import { XScraper } from "@/lib/browser/platforms/x-scraper";
import { parseProfile } from "@/lib/browser/extractors/profile-parser";
import { mergeProfileData, buildPlatformDataUpdate } from "@/lib/browser/extractors/profile-merger";

export async function syncXProfiles(
  accountId: string,
  opts?: {
    maxProfiles?: number;
    contactIds?: string[];  // Optional: specific contacts to enrich
  }
): Promise<SyncResult> {
  const maxProfiles = opts?.maxProfiles ?? 15;
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };

  // 1. Get or create sync cursor
  const cursor = getSyncCursor(accountId, "x_profiles");
  updateSyncCursor(cursor.id, {
    syncStatus: "syncing",
    lastSyncStartedAt: Math.floor(Date.now() / 1000),
  });

  try {
    // 2. Select contacts to enrich
    const contacts = selectContactsForEnrichment(accountId, {
      maxProfiles,
      contactIds: opts?.contactIds,
    });

    // 3. Initialize scraper (validates session)
    const scraper = new XScraper(accountId);
    await scraper.init();

    if (!await scraper.validateSession()) {
      throw new Error("X browser session is invalid or expired. Please re-authenticate.");
    }

    let processed = 0;

    // 4. Per-contact enrichment loop
    for (const contact of contacts) {
      if (scraper.batchLimitReached) {
        result.errors.push(`Batch limit reached after ${processed} profiles. Remaining contacts will be enriched in the next batch.`);
        break;
      }

      try {
        // 4a. Scrape profile page
        const raw = await scraper.scrapeProfile(contact.platformHandle);
        if (!raw) {
          result.skipped++;
          continue;
        }

        // 4b. LLM extraction
        const parsed = await parseProfile(raw);

        // 4c. Merge into contact (fill gaps, don't overwrite)
        const updates = mergeProfileData(contact, parsed, raw);

        if (Object.keys(updates).length > 0) {
          updateContact(contact.id, updates);
          // updateContact already calls recalcEnrichment(contactId)
          result.updated++;
        } else {
          result.skipped++;
        }

        // 4d. Update identity platformData for rich data scoring
        updateIdentityPlatformData(contact.identityId, parsed);

        processed++;
      } catch (err) {
        // Per-contact error isolation — continue on failure
        result.errors.push(
          `Failed to enrich @${contact.platformHandle}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 5. Mark sync completed
    const now = Math.floor(Date.now() / 1000);
    updateSyncCursor(cursor.id, {
      syncStatus: "completed",
      totalItemsSynced: (cursor.totalItemsSynced ?? 0) + processed,
      lastSyncCompletedAt: now,
    });
    updatePlatformAccount(accountId, { lastSyncedAt: now });

    // 6. Clean up
    await scraper.close();
  } catch (err) {
    // Partial sync pattern: ALWAYS set lastSyncCompletedAt even on error
    result.errors.push(
      `Profile enrichment failed: ${err instanceof Error ? err.message : String(err)}`
    );
    updateSyncCursor(cursor.id, {
      syncStatus: "failed",
      lastSyncCompletedAt: Math.floor(Date.now() / 1000),
      lastError: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
```

### 7.2 Contact Selection Strategy

```typescript
function selectContactsForEnrichment(
  accountId: string,
  opts: { maxProfiles: number; contactIds?: string[] }
): EnrichableContact[] {
  // If specific contacts requested, use those
  if (opts.contactIds?.length) {
    return getContactsWithXIdentity(opts.contactIds);
  }

  // Otherwise: prioritize low enrichment scores, skip recently scraped
  const COOLDOWN_DAYS = 7;
  const cooldownThreshold = Math.floor(Date.now() / 1000) - (COOLDOWN_DAYS * 86400);

  return db.select(...)
    .from(contacts)
    .innerJoin(contactIdentities, ...)
    .where(and(
      eq(contactIdentities.platform, "x"),
      isNotNull(contactIdentities.platformHandle),
      // Skip recently enriched (check metadata.browserEnrichment.scrapedAt)
    ))
    .orderBy(asc(contacts.enrichmentScore))  // Lowest scores first
    .limit(opts.maxProfiles)
    .all();
}
```

**Selection criteria:**
1. Contact must have an X identity with a `platformHandle`
2. Skip contacts where `metadata.browserEnrichment.scrapedAt > (now - 7 days)`
3. Order by `enrichmentScore ASC` — enrich the least-complete contacts first
4. Limit to `maxProfiles` (default 15)

### 7.3 CAPTCHA / Detection Handling

If the scraper encounters a CAPTCHA or challenge page:

1. **Stop the batch immediately** — don't attempt more profiles
2. **Save progress** — update sync cursor with what was processed
3. **Mark session as needing validation** — next attempt will re-validate
4. **Report to user** — include in `SyncResult.errors`
5. **Don't retry automatically** — user must manually verify their session

Detection heuristics:
- Page title contains "verify" or "challenge"
- No `[data-testid="UserName"]` selector found after 10s timeout
- Redirect to login page when session was previously valid

---

## 8. Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ Trigger: Dashboard UI                                                │
│   "Enrich from X" button (single) or "Enrich Low-Score" (bulk)     │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ API Route: POST /api/platforms/x/enrich                             │
│   Body: { contactIds?: string[], maxProfiles?: number }             │
│   Validates X platform account exists + browser session valid       │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Sync Orchestrator: syncXProfiles(accountId, opts)                   │
│   1. Get/create sync cursor (dataType: "x_profiles")               │
│   2. Select contacts (low score, not recently scraped)              │
│   3. Initialize browser (load encrypted cookies)                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Browser Engine: XScraper.scrapeProfile(handle)                      │
│   1. Navigate to x.com/{handle} with randomized delay              │
│   2. Simulate scroll (anti-detection)                               │
│   3. Extract DOM text → RawProfileData                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ LLM Extractor: parseProfile(rawProfileData)                         │
│   Vercel AI SDK 6 generateObject() + Zod schema                    │
│   Input: bio + tweets (~500 tokens)                                 │
│   Output: ParsedProfileData (~200 tokens)                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Profile Merger: mergeProfileData(contact, parsed, raw)              │
│   Strategy: "fill gaps, don't overwrite"                            │
│   - Empty contact fields ← parsed values                            │
│   - metadata.browserEnrichment ← skills, interests, etc.           │
│   - identity.platformData ← skills, interests (triggers +10 score) │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ DB Update                                                           │
│   updateContact(id, updates)  ← auto-calls recalcEnrichment()      │
│   updateIdentity(id, { platformData })  ← triggers rich data bonus │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. API Route

### 9.1 `POST /api/platforms/x/enrich/route.ts`

```typescript
// Request
{
  contactIds?: string[];   // Specific contacts (single or bulk)
  maxProfiles?: number;    // Override batch limit (default 15)
}

// Response (200)
{
  result: SyncResult;      // { added, updated, skipped, errors }
}

// Response (400)
{
  error: "No X platform account found"
  | "No browser session configured. Set up in Settings."
  | "Browser session expired. Please re-authenticate."
}
```

**Authorization:** Uses existing pattern — find the user's X platform
account via `listPlatformAccounts()`.

### 9.2 Browser Session Routes

**`POST /api/platforms/x/browser-session/route.ts`**

Actions: `setup` (launch headed browser), `validate` (check session)

**`GET /api/platforms/x/browser-session/route.ts`**

Returns current session status.

**`DELETE /api/platforms/x/browser-session/route.ts`**

Clears stored session cookies.

---

## 10. Schema Changes

### 10.1 `src/lib/db/schema.ts`

Add `"x_profiles"` to the `syncCursors.dataType` enum:

```typescript
dataType: text("data_type", {
  enum: [
    "tweets", "mentions", "followers", "following", "dms", "likes",
    "connections", "google_contacts", "gmail_metadata",
    "x_profiles",              // ← NEW
    // Future: "linkedin_profiles", "website"
  ],
}).notNull()
```

### 10.2 `src/lib/db/queries/sync.ts`

Add `"x_profiles"` to the `DataType` union:

```typescript
type DataType =
  | "tweets" | "mentions" | "followers" | "following"
  | "dms" | "likes" | "connections"
  | "google_contacts" | "gmail_metadata"
  | "x_profiles";    // ← NEW
```

### 10.3 No New Tables

All enrichment data is stored in existing structures:
- **Contact fields:** `company`, `title`, `headline`, `email`, `phone`
- **Contact metadata JSON:** `{ browserEnrichment: { skills, interests, ... } }`
- **Identity platformData JSON:** `{ skills, interests, previousCompanies, ... }`
- **Sync cursor:** tracks enrichment progress per platform account

---

## 11. UI Integration

### 11.1 Enrich Button Component

**`src/components/enrich-button.tsx`**

A reusable button that triggers browser enrichment for a single contact
or a batch. Used in both contact detail and contacts list views.

```typescript
interface EnrichButtonProps {
  contactId?: string;        // Single contact enrichment
  contactIds?: string[];     // Bulk enrichment
  platform: "x";             // Extensible to "linkedin" later
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
  onComplete?: (result: SyncResult) => void;
}
```

**States:** idle → enriching (spinner) → complete (show result) → error

### 11.2 Contact Detail Page

**`src/app/dashboard/contacts/[id]/contact-detail-client.tsx`**

Add "Enrich from X" button — only shown when:
1. Contact has an X identity (`contactIdentities` where `platform === "x"`)
2. X platform account exists (user has connected X)
3. Browser session is configured

**Placement:** Near the existing contact info section, alongside other action
buttons.

### 11.3 Contacts List Page

Add "Enrich Low-Score" bulk action button to the contacts list header.
Triggers enrichment for the lowest-scoring contacts with X identities.

### 11.4 Settings — Browser Sessions

**`src/app/dashboard/settings/page.tsx`**

Add a "Browser Sessions" card using the existing `PlatformConnectionCard`
pattern. Shows:

- **Session status:** Active / Expired / Not configured
- **Last validated:** Relative time (e.g., "2h ago")
- **Actions:** Setup (launch browser), Validate, Clear
- **Per-platform:** One card per platform (X now, LinkedIn later)

---

## 12. Anti-Detection Strategy Summary

| Measure | Implementation | Why |
|---------|---------------|-----|
| Randomized delays | 8-20s normal distribution between pages | Uniform intervals look robotic |
| Scroll simulation | 300-800px in 3-7 steps after page load | No scroll = bot fingerprint |
| Viewport variation | Rotate 5 common desktop resolutions | Fixed viewport = fingerprint |
| Batch limits | 15-20 profiles per session | Rapid visits trigger detection |
| Batch cooldown | 30-minute pause between batches | Rate limit avoidance |
| Sequential only | One tab, one profile at a time | Parallel tabs = obvious bot |
| Real cookies | Manual login, stored session | No auth automation |
| Graceful stop | On CAPTCHA/challenge, stop batch + save | Don't fight detection |
| Cooldown per contact | 7-day minimum between re-scrapes | Don't hammer same profiles |

---

## 13. Error Handling

| Error | Handling |
|-------|----------|
| No browser session | Return 400 with setup instructions |
| Session expired | Return 400, prompt re-authentication |
| CAPTCHA detected | Stop batch, save progress, report to user |
| Profile not found (404/suspended) | Skip, add to `errors[]`, continue |
| DOM selector not found | Return `null` for that field, don't fail |
| LLM extraction fails | Skip profile, add to `errors[]`, continue |
| Rate limited by X | Stop batch (same as CAPTCHA handling) |
| Playwright crash | Catch, save progress, report |
| Network timeout | Retry once (30s timeout), then skip |

**Error isolation principle:** A failure on one profile must never crash
the entire batch. The per-contact `try/catch` in the enrichment loop
(matching `sync-gmail-metadata.ts`) ensures this.

---

## 14. Implementation Sprints

### Sprint 1: Browser Foundation
**Files created:**
- `src/lib/browser/types.ts` — All shared types
- `src/lib/browser/session.ts` — Session manager (cookie store/load/validate)
- `src/lib/browser/anti-detection.ts` — Delay, scroll, viewport utilities
- `src/lib/browser/scraper.ts` — Base scraper class

**Depends on:** `package.json` adding `playwright` dependency

### Sprint 2: X Scraper
**Files created:**
- `src/lib/browser/platforms/x-scraper.ts` — X profile DOM extraction

**Depends on:** Sprint 1 (base scraper class)

### Sprint 3: LLM Extraction
**Files created:**
- `src/lib/browser/extractors/profile-parser.ts` — `generateObject()` + Zod
- `src/lib/browser/extractors/profile-merger.ts` — Contact merge logic

**Depends on:** Types from Sprint 1

### Sprint 4: Orchestration
**Files created:**
- `src/lib/platforms/sync-x-profiles.ts` — Enrichment orchestrator
- `src/app/api/platforms/x/enrich/route.ts` — API route
- `src/app/api/platforms/x/browser-session/route.ts` — Session management routes

**Files modified:**
- `src/lib/db/schema.ts` — Add `"x_profiles"` to dataType enum
- `src/lib/db/queries/sync.ts` — Add `"x_profiles"` to DataType union
- `package.json` — Add `playwright` dependency
- `bin/cli.ts` — Add Playwright browser install check

### Sprint 5: UI
**Files created:**
- `src/components/enrich-button.tsx` — Reusable enrich button

**Files modified:**
- `src/app/dashboard/contacts/[id]/contact-detail-client.tsx` — Add enrich button
- `src/app/dashboard/settings/page.tsx` — Add browser sessions card

---

## 15. New Files Summary

| File | Purpose |
|------|---------|
| `specs/05-browser-enrichment.md` | This specification |
| `src/lib/browser/types.ts` | Shared types (BrowserSession, RawProfileData, etc.) |
| `src/lib/browser/session.ts` | Session manager (cookie store, validation, Playwright lifecycle) |
| `src/lib/browser/scraper.ts` | Base scraper class (anti-detection, batch limits) |
| `src/lib/browser/anti-detection.ts` | Delay strategies, scroll simulation, viewport variation |
| `src/lib/browser/extractors/profile-parser.ts` | LLM-powered bio/tweet extraction via generateObject() |
| `src/lib/browser/extractors/profile-merger.ts` | Contact field merge logic ("fill gaps, don't overwrite") |
| `src/lib/browser/platforms/x-scraper.ts` | X profile page DOM extraction |
| `src/lib/platforms/sync-x-profiles.ts` | Enrichment orchestrator (follows sync-gmail-metadata pattern) |
| `src/app/api/platforms/x/enrich/route.ts` | API route for triggering enrichment |
| `src/app/api/platforms/x/browser-session/route.ts` | Session management API routes |
| `src/components/enrich-button.tsx` | Reusable enrich button component |

## 16. Files to Modify

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `"x_profiles"` to `syncCursors.dataType` enum |
| `src/lib/db/queries/sync.ts` | Add `"x_profiles"` to `DataType` union |
| `src/app/dashboard/contacts/[id]/contact-detail-client.tsx` | Add enrich button |
| `src/app/dashboard/settings/page.tsx` | Add browser sessions card |
| `package.json` | Add `playwright` dependency |
| `bin/cli.ts` | Add Playwright browser install check on boot |

## 17. Key Reference Files

| File | Pattern to Follow |
|------|-------------------|
| `src/lib/platforms/sync-gmail-metadata.ts` | Per-contact enrichment loop, metadata merge, sync cursor, partial-failure handling |
| `src/lib/db/enrichment.ts` | Score calculation — must call `recalcEnrichment()` after every update |
| `src/lib/platforms/sync-contacts.ts` | SyncResult accumulation, dedup-then-update flow |
| `src/lib/auth/crypto.ts` | AES-256 encryption for session cookie storage |
| `src/components/platform-connection-card.tsx` | Card-based UI pattern for settings integration |
| `src/lib/platforms/adapter.ts` | SyncResult type, PlatformAdapter interface |

## 18. Verification Checklist

- [ ] Launch Playwright, navigate to x.com, verify session cookies load and user is logged in
- [ ] Scrape a single known profile, verify raw text extraction matches page content
- [ ] Pass raw text through LLM extractor, verify Zod schema validates output
- [ ] Verify "fill gaps, don't overwrite" — existing fields remain unchanged
- [ ] Check enrichment score increased after merge + `recalcEnrichment()` call
- [ ] Verify sync cursor lifecycle: created → syncing → completed/failed
- [ ] Verify partial sync: cursor always gets `lastSyncCompletedAt` set, even on error
- [ ] Verify batch limit: scraper stops after 15-20 profiles
- [ ] Verify CAPTCHA handling: batch stops, progress saved, error reported
- [ ] Run `npm run build` — no type errors
- [ ] Run `npm run test` — no regressions
