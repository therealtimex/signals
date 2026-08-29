# Content and Publishing

**Build in public. Ship content that compounds. Let AI handle the grind.**

---

## The Content Loop

If you're building a startup, content is how the world finds out. X threads, LinkedIn posts, build-in-public updates — this is the engine that turns followers into customers and connections into collaborators. But the content loop has always been a grind: write, format for each platform, publish, track, repeat. For solo founders, it's the first thing that gets dropped when shipping takes priority.

Signals makes the content loop AI-native. Write once, adapt across platforms, publish through browser automation, and track everything in one library. The AI doesn't replace your voice — it handles the mechanical parts so you can focus on what you actually want to say.

## The Content Library

The Content page is your central hub for everything you've written, drafted, or published.

![Content library — browse and manage content across platforms](assets/content-library.png)
*The Content library: filter by type (All, Posts, Inbound, Drafts) and platform (X, LinkedIn, Gmail). Each item shows engagement status and timestamps.*

The library supports several views:

- **All** — Every content item across all platforms
- **Posts** — Published content
- **Inbound** — Content others have sent you (replies, mentions)
- **Drafts** — Work in progress, not yet published

Platform filters let you narrow down to X, LinkedIn, or Gmail content. Each item shows its type (Post), authorship (authored/inbound), status (draft/published), engagement data, and creation date.

## Composing Content

Click the **Compose** button to open the compose dialog — the central place for creating new content.

![Compose dialog — write and publish posts with platform controls](assets/compose-dialog.png)
*The Compose dialog: platform selector (X/LinkedIn), publish mode (Auto/Review), thread toggle, media upload, and character count.*

The compose dialog packs a lot into a clean interface:

### Platform Selector
Toggle between **X** and **LinkedIn** at the top. The character counter adjusts automatically — 280 for X, 3,000 for LinkedIn.

### Publish Mode
Two modes, inspired by what Andrej Karpathy calls the [autonomy slider](https://karpathy.ai/) — the idea that AI should range from full human control to full autonomy, and you pick the level:

- **Auto** — Headless browser publishing. The agent opens a browser, types your content, attaches media, and publishes. You don't see it happen.
- **Review** — Headed browser mode. The browser opens visibly, fills in your content, and pauses before the final click. You review and confirm.

This is the "Iron Man suit" model of AI assistance. Auto mode is for routine posts you've already reviewed in the compose dialog. Review mode is for high-stakes content where you want to see exactly what's going out.

### Thread Support
Toggle **Thread** mode to compose multi-part X threads. Each segment gets its own text area with an individual character count. Threads are published sequentially through browser automation — the agent posts each part as a reply to the previous one.

### Media Upload
Drag and drop images (JPEG, PNG, GIF, WebP up to 5 MB) into the upload zone. The media system tracks platform-specific constraints — X allows 4 images per tweet, LinkedIn has different dimension requirements. Media thumbnails preview below the upload zone, and you can remove individual attachments before publishing.

### Action Buttons
- **Cancel** — Discard the compose session
- **Save Draft** — Save to your content library without publishing
- **API Publish** — Publish via platform APIs (requires X API Basic tier at $200/month)
- **Publish** — Browser-based publishing (free, works with any account)

## Writing with your terminal agent

Start from a Launch and run the **Platform-native writing** template. The RealTimeX terminal agent
uses your approved voice profile and a source-backed evidence spine to create independent X,
LinkedIn, and Facebook variants. Each variant is measured, audited, and shown as an approval card
with its claims, voice drift, risk, and publishing capability.

If no approved voice exists, the agent asks for at least three real, self-authored samples, shows
the derived profile, and waits for your approval. It then extracts source claims once and drafts
each platform directly from that shared spine—not by trimming one network's post into another.

Review the full cards and respond with `approve <variantId>`, `revise <instruction>`, or `reject`.
Approval materializes one inspectable content item. Publishing remains separate: only after you
say to publish should the item be sent to the publish agent.

| Surface | Writing | Publishing |
|---|---|---|
| X post and thread | Draft, audit, approve | Direct |
| LinkedIn post | Draft, audit, approve | Beta |
| Facebook post | Draft, audit, approve | Direct |
| Other surfaces | No writing variant; explicit sketch only | Draft/export only |

The evidence spine prevents unsupported facts, numbers, dates, names, quotes, and citations from
slipping into a rewrite. A changed spine, body, target, voice, or audit invalidates old approval
and returns the item for review.

## Browser-Based Publishing

This is where Signals breaks from every other content tool. Instead of requiring expensive API access ($200/month for X API Basic, no LinkedIn write API at all), Signals publishes through actual browser automation.

Here's what happens when you click **Publish**:

1. **Session check** — Verifies your browser session is active (configured in Settings)
2. **Browser launch** — Opens Chromium (headless in Auto mode, visible in Review mode)
3. **Navigation** — Goes to the platform's compose interface
4. **Content entry** — Types your text character-by-character (to trigger platform-specific JS handlers)
5. **Media attachment** — Uploads images through the platform's file input
6. **Publication** — Clicks the post/share button
7. **Verification** — Confirms the post went live by checking for the published URL
8. **Screenshot** — Captures a screenshot of the published post for your records

For X threads, the agent posts each segment as a reply chain. For LinkedIn, it interacts with the Quill rich text editor and share box.

Review mode pauses before step 6, opening the browser window so you can see exactly what's about to be published. This is the trust-building step — you verify the content, media, and formatting look right before the final click.

## Content Detail

Click any content item in the library to see its detail view.

![Content detail — individual content item with metadata](assets/content-detail.png)
*Content detail: type tags (Post, authored, outbound, draft), full text, and timestamp.*

The detail view shows:
- **Type badges** — Post type, authorship, direction (outbound/inbound), and status (draft/published)
- **Full text** — The complete content without truncation
- **Timestamp** — When it was created or published
- **Edit** — Modify the content, change status, or re-publish

## The Content Workflow in Practice

Here's how a typical content session looks for a solo founder:

1. **Ideate** — Use a RealTimeX terminal agent or your own notes to brainstorm themes
2. **Draft** — Write in Compose (or paste agent output) and refine in the editor
3. **Edit** — Add your personal voice and specific details
4. **Adapt** — Manually tailor tone/length per platform, or ask an RTX agent to rewrite for the second platform
5. **Publish** — Hit Publish in Review mode for the first few times, switch to Auto once you trust the flow
6. **Track** — Check your content library to see engagement data flowing in

The loop — from idea to published on both platforms — stays fast when creative work runs in RTX and publishing stays in Signals.

## What's Next

Content creation is one side of the coin. The other is automation — agents that create content, engage with your audience, and handle outreach on autopilot.

**Next: [AI Agents and Automation](04-ai-agents-and-automation.md)** — Deploy agents for search, enrichment, content creation, and engagement.

**Also see: [Analytics and Goals](05-analytics-and-goals.md)** — Track content performance and set publishing goals.
