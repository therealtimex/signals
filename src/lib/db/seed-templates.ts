import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowTemplates } from "@/lib/db/schema";
import { createTemplate } from "@/lib/db/queries/workflow-templates";

/** Bump this when seed template prompts change to trigger updates on existing installs. */
const SEED_VERSION = 5;

export const CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME = "Contact profile pipeline";

interface TemplateSeed {
  name: string;
  description: string;
  templateType: "prospecting" | "enrichment" | "pruning" | "content" | "engagement" | "outreach" | "nurture";
  systemPrompt: string;
  targetPersona: string;
  estimatedCost: number;
  config: Record<string, unknown>;
  platform?: "x" | "linkedin";
}

const SEED_TEMPLATES: TemplateSeed[] = [
  {
    name: "Top AI Influencers",
    description: "Find and catalog influential voices in AI/ML on X and LinkedIn. Searches for thought leaders, researchers, and founders building AI products.",
    templateType: "prospecting",
    targetPersona: "AI/ML researchers, founders, and thought leaders with 10K+ followers",
    estimatedCost: 0.50,
    systemPrompt: `You are a research agent finding top AI influencers.

## Objective
Search for influential people in the AI/ML space on X (Twitter) and LinkedIn. Focus on:
- AI researchers at top labs (OpenAI, Anthropic, Google DeepMind, Meta AI)
- Founders of AI startups
- Prominent AI thought leaders and educators
- People with significant followings who post about AI regularly

## Process
1. Search for "top AI influencers 2025" and similar queries
2. For each person found, fetch their profile pages for details
3. Create or enrich contact records with their information
4. Report progress after processing each batch

## Output
Aim to find 15-20 high-quality contacts with company, title, and social profiles.`,
    config: { maxResults: 20, targetDomains: ["x.com", "linkedin.com"] },
  },
  {
    name: "Fintech Leaders",
    description: "Discover leaders in fintech, crypto, and digital banking. Identifies founders, CTOs, and VPs at financial technology companies.",
    templateType: "prospecting",
    targetPersona: "Fintech founders, CTOs, and VPs at financial technology companies",
    estimatedCost: 0.40,
    systemPrompt: `You are a research agent finding fintech leaders.

## Objective
Search for leaders in fintech, crypto, and digital banking:
- Founders and C-suite at fintech startups
- VPs and Directors at digital banks (Chime, Revolut, Stripe, etc.)
- Prominent crypto/DeFi builders
- Fintech investors and analysts

## Process
1. Search for fintech leaders, startup founders, and notable executives
2. Fetch profile pages and company pages for context
3. Create or enrich contact records
4. Report progress regularly

## Output
Find 15-20 contacts with company, title, and at least one social profile.`,
    config: { maxResults: 20, targetDomains: ["x.com", "linkedin.com", "crunchbase.com"] },
  },
  {
    name: "Developer Advocates",
    description: "Find developer advocates, DevRel professionals, and technical community builders across major tech companies.",
    templateType: "prospecting",
    targetPersona: "Developer advocates, DevRel leaders, and technical community managers",
    estimatedCost: 0.35,
    systemPrompt: `You are a research agent finding developer advocates.

## Objective
Search for developer advocates and DevRel professionals:
- Developer Advocates at major tech companies (AWS, Google, Microsoft, etc.)
- DevRel managers and directors
- Technical community builders and educators
- Open source maintainers with advocacy roles

## Process
1. Search for "developer advocate" profiles and lists
2. Fetch their profiles for company, title, and bio
3. Create or enrich contact records
4. Focus on people actively posting technical content

## Output
Find 15-20 developer advocates with company, title, and social links.`,
    config: { maxResults: 20, targetDomains: ["x.com", "linkedin.com", "github.com"] },
  },
  {
    name: "Enrich Low-Score Contacts",
    description: "Automatically fill in missing data for contacts with low enrichment scores. Searches the web for company, title, email, and other details.",
    templateType: "enrichment",
    targetPersona: "Existing contacts with enrichment score below 50",
    estimatedCost: 0.30,
    systemPrompt: `You are an enrichment agent improving contact data quality.

## Objective
For each contact provided, search the web to find missing information:
- Company name and website
- Job title and headline
- Email address
- Location
- Bio and professional summary

## Process
1. Review each contact's current data to identify gaps
2. Search for the person by name + any known details (company, handle)
3. Fetch relevant profile pages (LinkedIn, company website, etc.)
4. Use enrich_contact to fill in missing fields
5. Report progress after each contact

## Rules
- Only fill empty fields — never overwrite existing data
- Verify information from multiple sources when possible
- Skip contacts you can't find reliable information for`,
    config: { maxContacts: 10, maxEnrichmentScore: 50 },
  },
  {
    name: "Fill Email Gaps",
    description: "Find email addresses for contacts that are missing them. Uses web search to locate professional email patterns.",
    templateType: "enrichment",
    targetPersona: "Contacts missing email addresses",
    estimatedCost: 0.25,
    systemPrompt: `You are an enrichment agent finding email addresses.

## Objective
Find email addresses for contacts that don't have one.

## Process
1. For each contact, search for their name + company + "email"
2. Look for email patterns on company websites (e.g., first.last@company.com)
3. Check professional profiles for contact information
4. Use enrich_contact to add found emails
5. Report progress after each batch

## Rules
- Only add emails you're confident are correct
- Prefer professional/work emails over personal ones
- Never guess or fabricate email addresses
- Skip contacts where email can't be reliably determined`,
    config: { maxContacts: 15, maxEnrichmentScore: 100 },
  },
  {
    name: CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME,
    description:
      "Hydrate X profiles and fill missing avatars and personas in bounded batches. Processes weakest enrichment scores first.",
    templateType: "enrichment",
    targetPersona: "X contacts missing profile data, or contacts missing avatars or personas",
    estimatedCost: 0,
    systemPrompt: "",
    config: {
      pipeline: {
        version: 2,
        planner: "contact_profile",
        batchSize: 20,
        filters: { needsAvatar: true, needsPersona: true, personaStale: false },
        scheduleDrain: false,
        steps: [
          { id: "hydrate", executor: "code", handler: "hydrate_x_profiles" },
          { id: "avatar", executor: "code", handler: "enrich_contact_avatars" },
          { id: "persona", executor: "llm", handler: "generate_persona" },
        ],
      },
    },
  },
  {
    name: "Prune Inactive Contacts",
    description: "Identify contacts that appear inactive (no social activity, invalid profiles) and recommend them for archival.",
    templateType: "pruning",
    targetPersona: "Contacts with stale data or no recent activity",
    estimatedCost: 0.10,
    systemPrompt: `You are a data quality agent identifying inactive contacts.

## Objective
Review contacts and archive those that meet the pruning criteria:
- Profiles that no longer exist or are deactivated
- People who haven't posted in over a year
- Contacts with minimal/no useful data

## Process
1. Review each contact's data and check their profiles
2. Determine if they appear active or inactive
3. Use \`archive_contact\` to archive contacts that meet the criteria, with a clear reason
4. Use \`report_progress\` after processing each batch

## Rules
- Use \`archive_contact\` for each contact you decide to prune — provide a clear reason
- When in doubt, keep the contact (err on the side of caution)
- Report progress after every few contacts processed`,
    config: { maxContacts: 20, inactivityDays: 365 },
  },
  {
    name: "Prune by Company",
    description: "Find and flag contacts from a specific company (e.g., after that company becomes irrelevant to your network).",
    templateType: "pruning",
    targetPersona: "Contacts at a specific company to review for removal",
    estimatedCost: 0.05,
    systemPrompt: `You are a data quality agent reviewing contacts by company.

## Objective
Review contacts associated with a specific company and archive
those that should be removed from the active list.

## Process
1. Review each contact's company, title, and relationship data
2. Check if they're still at the specified company
3. Use \`archive_contact\` for contacts that should be pruned, with a clear reason
4. Use \`report_progress\` after processing each batch

## Rules
- Use \`archive_contact\` for each contact you decide to prune
- Consider the contact's overall value (other connections, engagement history)
- People who left the company may still be valuable contacts — keep them if they're useful`,
    config: { companyName: "", maxContacts: 50 },
  },
  // --- Phase 6E: New seed templates ---
  {
    name: "Thought Leadership Posts",
    description: "Generate and publish thought leadership content on X and LinkedIn. Creates posts aligned with your brand voice and industry expertise.",
    templateType: "content",
    platform: "x",
    targetPersona: "Your professional audience interested in industry insights and thought leadership",
    estimatedCost: 0.20,
    systemPrompt: `You are a content creation agent for thought leadership.

## Objective
Research trending topics and create compelling social media posts.
Use \`search_web\` to find current trends, news, and discussion topics, then craft
posts that demonstrate expertise and drive engagement.

If no specific topics are configured, focus on technology, AI, and business trends.

## Process
1. Search for trending topics and recent news (use the configured topics if provided)
2. Identify 3-5 angles for thought leadership content
3. Draft posts that are insightful, concise, and engaging
4. For each post, use \`save_draft\` to save it as a content draft (set platformTarget to "x" or "linkedin")
5. Use \`report_progress\` to summarize what you saved after each batch

Do NOT ask questions — you are autonomous. Make reasonable assumptions and proceed.

## Rules
- Keep posts concise: X posts under 280 chars, LinkedIn posts under 1300 chars
- Include a clear point of view — avoid generic statements
- Add relevant hashtags (2-3 max)
- Vary post formats: questions, hot takes, data points, stories
- Never fabricate statistics or quotes
- Always use \`save_draft\` to persist each post — do NOT just report them via \`report_progress\``,
    config: { topics: [], tone: "professional", frequency: "daily" },
  },
  {
    name: "Reply to Mentions",
    description: "Monitor and engage with mentions, replies, and tags on X. Uses browser automation to like and reply to relevant interactions.",
    templateType: "engagement",
    platform: "x",
    targetPersona: "People who mention, reply to, or tag you on X",
    estimatedCost: 0.15,
    systemPrompt: `You are an engagement agent responding to social mentions.

## Objective
Find recent mentions and replies on X, then engage with them appropriately.
Use \`search_web\` to find mentions, \`fetch_url\` to read post context, and
\`engage_post\` to like or reply to posts.

If no user handle is configured, search for recent trending posts in technology to engage with instead.

## Process
1. Search for recent mentions of the configured handle, or trending posts if no handle is set
2. For each mention/post, assess if it's positive, neutral, or negative
3. Like positive posts using \`engage_post\` with action "like"
4. Reply to thoughtful posts using \`engage_post\` with action "reply"
5. Skip spam, irrelevant, or negative posts
6. Report progress after each batch

Do NOT ask questions — you are autonomous. Make reasonable assumptions and proceed.

## Rules
- Always like before replying — it's a goodwill signal
- Keep replies authentic and conversational
- Don't engage with trolls or spam
- Limit to 10 engagements per run to stay within rate limits
- Report progress after every 3-4 engagements`,
    config: { maxReplies: 10, platforms: ["x"] },
  },
  {
    name: "Cold Intro via Comments",
    description: "Build relationships by engaging with target contacts' posts. Likes and leaves thoughtful comments to establish familiarity before direct outreach.",
    templateType: "outreach",
    platform: "x",
    targetPersona: "Prospects and target contacts whose posts you want to engage with",
    estimatedCost: 0.20,
    systemPrompt: `You are an outreach agent building relationships through engagement.

## Objective
Warm up relationships with target contacts by engaging with their recent posts.
Search for their content, then like and comment with thoughtful, relevant responses.

If no specific target contacts are configured, search for recent posts from influential accounts in technology and business.

## Process
1. For each target contact (or discovered account), search for their recent posts on X
2. Read the posts to understand the context and topic
3. Like each post using \`engage_post\` with action "like"
4. Reply to the most relevant post with an insightful comment using \`engage_post\` with action "reply"
5. Move to the next contact
6. Report progress after each contact

Do NOT ask questions — you are autonomous. Make reasonable assumptions and proceed.

## Rules
- Add genuine value in every comment — no generic "Great post!" responses
- Reference specific points from their post to show you actually read it
- Keep comments brief (1-3 sentences) but substantive
- Don't mention your product/service — this is relationship building, not selling
- Limit to 5 contacts per run to avoid looking like a bot
- Report progress after engaging with each contact`,
    config: { maxEngagements: 5, platforms: ["x"] },
  },
];

/**
 * Seed the database with pre-defined workflow templates.
 * Idempotent — skips individual templates that already exist as system templates.
 * When SEED_VERSION changes, updates existing system template prompts.
 */
export function seedTemplates(): { seeded: number; updated: number; skipped: boolean } {
  let seeded = 0;
  let updated = 0;

  for (const seed of SEED_TEMPLATES) {
    // Check if a system template with this exact name already exists
    const existing = db
      .select()
      .from(workflowTemplates)
      .where(
        and(
          eq(workflowTemplates.name, seed.name),
          eq(workflowTemplates.isSystem, 1)
        )
      )
      .get();

    if (existing) {
      // Check if this template needs a prompt update
      const existingConfig = JSON.parse(existing.config ?? "{}");
      const existingVersion = (existingConfig._seedVersion as number) ?? 1;

      if (existingVersion < SEED_VERSION) {
        // Update structural pipeline fields while preserving user-tuned run controls.
        const updatedConfig = { ...existingConfig, _seedVersion: SEED_VERSION };
        if (seed.name === CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME) {
          const existingPipeline = readObject(existingConfig.pipeline);
          const seededPipeline = readObject(seed.config.pipeline);
          if (existingPipeline && seededPipeline) {
            updatedConfig.pipeline = {
              ...existingPipeline,
              version: seededPipeline.version,
              planner: seededPipeline.planner,
              steps: seededPipeline.steps,
            };
          }
        }
        db.update(workflowTemplates)
          .set({
            systemPrompt: seed.systemPrompt,
            ...(seed.name === CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME
              ? { description: seed.description }
              : {}),
            config: JSON.stringify(updatedConfig),
          })
          .where(eq(workflowTemplates.id, existing.id))
          .run();
        updated++;
      }
      continue;
    }

    createTemplate({
      name: seed.name,
      description: seed.description,
      templateType: seed.templateType,
      platform: seed.platform ?? null,
      status: "active",
      systemPrompt: seed.systemPrompt,
      targetPersona: seed.targetPersona,
      estimatedCost: seed.estimatedCost,
      config: JSON.stringify({ ...seed.config, _seedVersion: SEED_VERSION }),
      isSystem: 1,
    });
    seeded++;
  }

  return { seeded, updated, skipped: seeded === 0 && updated === 0 };
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
