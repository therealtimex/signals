/**
 * A small, wholly fictional CRM, sized for the user-guide screenshots.
 *
 * The guide assets were previously captured against whatever CRM the person
 * running the capture happened to have. On a public repo that publishes real
 * people — names, photographs, employers — annotated with a private commercial
 * assessment of them ("Prospect", "Follow Back"). This dataset exists so the
 * screenshots can be reproduced by anyone, from nothing, without that.
 *
 * Everything here is invented. Email domains are RFC 2606 `example.com`, which
 * is reserved and cannot belong to anyone, so a reviewer can tell at a glance
 * that no real address is on screen.
 *
 * Rows go in through the query layer rather than `db.insert`, so the demo graph
 * carries the same derived state real data does: enrichment scores, the
 * `company` field the dashboard reads off `currentEmployment`, and the
 * engagement→interaction projection the analytics UNION depends on.
 */
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import { createContact } from "@/lib/db/queries/contacts";
import { createContentItem } from "@/lib/db/queries/content";
import { logInteraction } from "@/lib/db/queries/interactions";
import { createGoal, createGoalProgress, linkWorkflowToGoal } from "@/lib/db/queries/goals";
import { createIdentity } from "@/lib/db/queries/identities";
import { createOrg } from "@/lib/db/queries/orgs";
import { createPlatformAccount } from "@/lib/db/queries/platform-accounts";
import { createTask } from "@/lib/db/queries/tasks";
import { createWorkflowRun, createWorkflowStep } from "@/lib/db/queries/workflows";
import { listTemplates } from "@/lib/db/queries/workflow-templates";
import { seedTemplates } from "@/lib/db/seed-templates";

/** Seconds, because every timestamp column here is unixepoch. */
const DAY = 86_400;

export type DemoSeedSummary = {
  orgs: number;
  contacts: number;
  identities: number;
  contentItems: number;
  interactions: number;
  goals: number;
  workflowRuns: number;
  workflowSteps: number;
  tasks: number;
  platformAccounts: number;
};

export const DEMO_ORGS = [
  { name: "Northwind Analytics", domain: "northwind.example.com", industry: "Data Infrastructure", companySize: "11-50" as const },
  { name: "Halyard Labs", domain: "halyard.example.com", industry: "Developer Tools", companySize: "1-10" as const },
  { name: "Cobalt Ridge", domain: "cobaltridge.example.com", industry: "Fintech", companySize: "51-200" as const },
  { name: "Marram Systems", domain: "marram.example.com", industry: "Open Source AI", companySize: "11-50" as const },
  { name: "Ostara Health", domain: "ostara.example.com", industry: "Health Tech", companySize: "201-500" as const },
];

/**
 * Twelve contacts spread across all six funnel stages, so the dashboard's
 * funnel bar is a distribution rather than one block. `orgIndex` drives the
 * employment row that the "Recent Contacts" company line reads from.
 *
 * `daysAgo` is clustered rather than evenly spaced. One contact every two days
 * makes every bar in the analytics Contact Growth chart exactly 1, so the
 * y-axis maxes at 1 and the area fills flat — a chart that illustrates nothing.
 * Repeats here give it peaks.
 *
 * `richness` drives how complete each profile is, which is what the Enrichment
 * Score Distribution histogram buckets on. Uniformly thin profiles put all
 * twelve contacts in one bar. See `src/lib/db/enrichment.ts` for the weights;
 * these tiers land near 95 / 52 / 26. No avatars at any tier — initials keep
 * the guide free of photographs.
 */
export const DEMO_CONTACTS = [
  { name: "Aria Park", daysAgo: 28, richness: "rich" as const, title: "Founder", orgIndex: 0, funnelStage: "customer" as const, handle: "ariapark", headline: "Building data pipelines that explain themselves.", followers: 18_400, score: 88 },
  { name: "Devan Osei", daysAgo: 28, richness: "rich" as const, title: "Head of Engineering", orgIndex: 0, funnelStage: "advocate" as const, handle: "devanosei", headline: "Distributed systems, mostly on purpose.", followers: 9_120, score: 81 },
  { name: "Mira Lindqvist", daysAgo: 26, richness: "rich" as const, title: "Co-Founder", orgIndex: 1, funnelStage: "opportunity" as const, handle: "miralind", headline: "Developer tools for very small teams.", followers: 24_700, score: 76 },
  { name: "Tomas Reyes", daysAgo: 21, richness: "medium" as const, title: "Principal Engineer", orgIndex: 1, funnelStage: "qualified" as const, handle: "tomasreyes", headline: "Local-first software, offline by default.", followers: 5_380, score: 64 },
  { name: "Noor Haddad", daysAgo: 21, richness: "medium" as const, title: "VP Product", orgIndex: 2, funnelStage: "qualified" as const, handle: "noorhaddad", headline: "Payments infrastructure and the humans who use it.", followers: 12_900, score: 69 },
  { name: "Iwan Sobczak", daysAgo: 21, richness: "medium" as const, title: "Staff Designer", orgIndex: 2, funnelStage: "engaged" as const, handle: "iwansob", headline: "Interface design for dense, boring, important screens.", followers: 3_150, score: 52 },
  { name: "Petra Halvorsen", daysAgo: 17, richness: "rich" as const, title: "Research Lead", orgIndex: 3, funnelStage: "engaged" as const, handle: "petrahalv", headline: "Open weights, open evals, open notebooks.", followers: 31_200, score: 71 },
  { name: "Leo Amankwah", daysAgo: 14, richness: "medium" as const, title: "ML Engineer", orgIndex: 3, funnelStage: "prospect" as const, handle: "leoamank", headline: "Small models, careful benchmarks.", followers: 7_640, score: 44 },
  { name: "Saoirse Byrne", daysAgo: 14, richness: "sparse" as const, title: "Chief of Staff", orgIndex: 4, funnelStage: "prospect" as const, handle: "saoirseb", headline: "Operations for teams that ship weekly.", followers: 2_080, score: 38 },
  { name: "Kenji Watanabe", daysAgo: 9, richness: "medium" as const, title: "Founder", orgIndex: 4, funnelStage: "prospect" as const, handle: "kenjiwat", headline: "Clinical workflows, minus the fax machine.", followers: 14_300, score: 41 },
  { name: "Rosa Delacroix", daysAgo: 5, richness: "sparse" as const, title: "Angel Investor", orgIndex: null, funnelStage: "engaged" as const, handle: "rosadela", headline: "Pre-seed cheques for infrastructure founders.", followers: 41_800, score: 58 },
  { name: "Ben Ostrowski", daysAgo: 5, richness: "sparse" as const, title: "Technical Writer", orgIndex: null, funnelStage: "prospect" as const, handle: "benostr", headline: "Docs are a feature.", followers: 1_460, score: 29 },
];

/**
 * Content the guide can show without publishing anyone's real posts. `age` is
 * days before the run, kept inside the analytics 30-day window so the charts
 * are populated rather than empty.
 */
/**
 * What each tier supplies, in the terms `calculateEnrichmentScore` actually
 * weighs. Kept as data so the spread is legible without reading the seeding
 * loop.
 */
export const RICHNESS_TIERS = {
  rich: { verifiedEmail: true, phone: true, location: true, bio: true, website: true, identities: 3, richPlatformData: true },
  medium: { verifiedEmail: false, phone: false, location: true, bio: false, website: false, identities: 2, richPlatformData: false },
  sparse: { verifiedEmail: false, phone: false, location: false, bio: false, website: false, identities: 1, richPlatformData: false },
} as const;

export const DEMO_CONTENT = [
  { title: "Why local-first CRMs win on trust", contentType: "article" as const, body: "Your relationship graph is the most sensitive thing you own. Shipping it to someone else's cloud is a choice, not a requirement.", status: "published" as const, origin: "authored" as const, direction: "outbound" as const, platform: "linkedin" as const, age: 2, likes: 214, comments: 31, shares: 18, impressions: 9_400 },
  { title: "Thread: what a one-person GTM stack looks like", contentType: "thread" as const, body: "Six tools, one afternoon of setup, no seat licences. Here is the whole thing.", status: "published" as const, origin: "authored" as const, direction: "outbound" as const, platform: "x" as const, age: 4, likes: 488, comments: 64, shares: 122, impressions: 27_300 },
  { title: null, contentType: "reply" as const, body: "Agreed — the interesting constraint is not model quality, it is whether the workflow survives being interrupted halfway through.", status: "published" as const, origin: "authored" as const, direction: "outbound" as const, platform: "x" as const, age: 5, likes: 37, comments: 4, shares: 2, impressions: 1_900 },
  { title: "Enrichment without scraping anyone", contentType: "post" as const, body: "Most enrichment is just asking the person. We made that the default path.", status: "published" as const, origin: "authored" as const, direction: "outbound" as const, platform: "x" as const, age: 8, likes: 156, comments: 22, shares: 41, impressions: 11_200 },
  { title: "The case against seat-based pricing for solo founders", contentType: "article" as const, body: "A seat you never fill is still a seat you pay for.", status: "published" as const, origin: "authored" as const, direction: "outbound" as const, platform: "linkedin" as const, age: 11, likes: 302, comments: 47, shares: 26, impressions: 15_800 },
  { title: null, contentType: "reply" as const, body: "This matches what we saw — the bottleneck was never generation, it was review.", status: "published" as const, origin: "authored" as const, direction: "outbound" as const, platform: "x" as const, age: 13, likes: 61, comments: 8, shares: 5, impressions: 3_400 },
  { title: "Shipping notes: relationship goals", contentType: "post" as const, body: "Follow back, mutual engagement, warm conversation. Three states, one clear next action each.", status: "published" as const, origin: "authored" as const, direction: "outbound" as const, platform: "x" as const, age: 17, likes: 98, comments: 14, shares: 11, impressions: 6_700 },
  { title: "Draft: launch note for the graph explorer", contentType: "post" as const, body: "Still deciding whether to lead with the graph or the outcome.", status: "draft" as const, origin: "authored" as const, direction: "outbound" as const, platform: "x" as const, age: 1, likes: 0, comments: 0, shares: 0, impressions: 0 },
  { title: "Draft: comparison post, honestly this time", contentType: "article" as const, body: "Naming the things we are worse at, first.", status: "draft" as const, origin: "authored" as const, direction: "outbound" as const, platform: "linkedin" as const, age: 1, likes: 0, comments: 0, shares: 0, impressions: 0 },
  { title: null, contentType: "reply" as const, body: "Would love to see the eval harness if you ever open it up.", status: "imported" as const, origin: "received" as const, direction: "inbound" as const, platform: "x" as const, age: 3, likes: 12, comments: 1, shares: 0, impressions: 640 },
  { title: null, contentType: "dm" as const, body: "Following up on the pipeline conversation — happy to share what we changed.", status: "imported" as const, origin: "received" as const, direction: "inbound" as const, platform: "linkedin" as const, age: 6, likes: 0, comments: 0, shares: 0, impressions: 0 },
  { title: "Weekly digest: what shipped", contentType: "newsletter" as const, body: "Three fixes, one feature, and a migration you do not have to think about.", status: "published" as const, origin: "authored" as const, direction: "outbound" as const, platform: "substack" as const, age: 9, likes: 74, comments: 6, shares: 9, impressions: 4_100 },
];

export const DEMO_GOALS = [
  { name: "Grow X audience to 25k", goalType: "audience_growth" as const, targetValue: 25_000, currentValue: 18_400, unit: "followers", platform: "x" as const, status: "active" as const },
  { name: "100 qualified conversations", goalType: "lead_generation" as const, targetValue: 100, currentValue: 41, unit: "conversations", platform: null, status: "active" as const },
  { name: "Publish 40 posts this quarter", goalType: "content_engagement" as const, targetValue: 40, currentValue: 28, unit: "posts", platform: null, status: "active" as const },
  { name: "Move 12 contacts to opportunity", goalType: "pipeline_progression" as const, targetValue: 12, currentValue: 12, unit: "contacts", platform: null, status: "achieved" as const },
];

export const DEMO_TASKS = [
  { title: "Reply to Mira about the pilot scope", priority: "high" as const, contactIndex: 2 },
  { title: "Send Northwind the migration checklist", priority: "medium" as const, contactIndex: 0 },
  { title: "Review draft launch note before Thursday", priority: "high" as const, contactIndex: null },
  { title: "Warm intro: Rosa → Kenji", priority: "medium" as const, contactIndex: 10 },
  { title: "Check whether Leo's benchmark post landed", priority: "low" as const, contactIndex: 7 },
];

/**
 * Runs cover what the automation and analytics screens each need: one `running`
 * row for the dashboard's active count, completed rows for the history table,
 * and `agent` rows carrying `model`/cost — without which the agent-cost charts
 * are empty however much other data exists.
 */
export const DEMO_WORKFLOW_RUNS = [
  { workflowType: "enrich" as const, status: "running" as const, age: 0, model: "claude-sonnet-4-5", costUsd: 0.42, inputTokens: 128_400, outputTokens: 9_100, processed: 34, success: 31, steps: ["url_fetch", "llm_extract", "contact_merge"] },
  { workflowType: "agent" as const, status: "completed" as const, age: 1, model: "claude-sonnet-4-5", costUsd: 1.18, inputTokens: 402_600, outputTokens: 24_800, processed: 62, success: 60, steps: ["web_search", "llm_extract", "contact_create", "routing_decision"] },
  { workflowType: "sync" as const, status: "completed" as const, age: 2, model: null, costUsd: 0, inputTokens: 0, outputTokens: 0, processed: 218, success: 218, steps: ["sync_page", "sync_page"] },
  { workflowType: "agent" as const, status: "completed" as const, age: 5, model: "claude-sonnet-4-5", costUsd: 0.87, inputTokens: 291_300, outputTokens: 18_200, processed: 45, success: 43, steps: ["thinking", "tool_call", "tool_result", "content_create"] },
  { workflowType: "search" as const, status: "failed" as const, age: 7, model: "claude-sonnet-4-5", costUsd: 0.09, inputTokens: 22_100, outputTokens: 1_400, processed: 8, success: 3, steps: ["web_search", "error"] },
  { workflowType: "sequence" as const, status: "completed" as const, age: 12, model: null, costUsd: 0, inputTokens: 0, outputTokens: 0, processed: 27, success: 27, steps: ["engagement_action", "post_engagement"] },
];

export function seedDemoData(now = Math.floor(Date.now() / 1000)): DemoSeedSummary {
  const ago = (days: number) => now - days * DAY;
  const summary: DemoSeedSummary = {
    orgs: 0, contacts: 0, identities: 0, contentItems: 0, interactions: 0,
    goals: 0, workflowRuns: 0, workflowSteps: 0, tasks: 0, platformAccounts: 0,
  };

  // System workflow templates ship with every install; goals and runs link to
  // them by name rather than inventing parallel templates.
  seedTemplates();
  const templates = listTemplates().data;

  const accounts = (["x", "linkedin", "substack"] as const).map((platform) => {
    summary.platformAccounts += 1;
    return createPlatformAccount({
      platform,
      displayName: platform === "x" ? "@novaharbor" : "Nova Harbor",
      authType: "session",
      status: "active",
    });
  });
  const accountFor = (platform: string) =>
    accounts.find((account) => account.platform === platform) ?? accounts[0];

  const orgs = DEMO_ORGS.map((org) => {
    summary.orgs += 1;
    return createOrg({ ...org, orgType: "company", accountStage: "prospect" });
  });

  const contacts = DEMO_CONTACTS.map((person, index) => {
    const org = person.orgIndex === null ? null : orgs[person.orgIndex];
    const tier = RICHNESS_TIERS[person.richness];
    summary.contacts += 1;
    const contact = createContact({
      name: person.name,
      funnelStage: person.funnelStage,
      score: person.score,
      // Reserved by RFC 2606, so no real mailbox can appear in a screenshot.
      email: `${person.handle}@example.com`,
      verifiedEmail: tier.verifiedEmail,
      // A documentation range (RFC 3849 style is IPv6; for phones E.164 has no
      // reserved block, so this uses the 555 fictional prefix).
      ...(tier.phone ? { phone: "+1-555-0100" } : {}),
      title: person.title,
      ...(org ? { orgId: org.id } : {}),
      headline: person.headline,
      relationshipGoal: index % 3 === 0 ? "mutual_engagement" : "follow_back",
      relationshipGoalStatus: index % 3 === 0 ? "in_progress" : "not_started",
      createdAt: ago(person.daysAgo),
    });

    // >3 keys is what `calculateEnrichmentScore` counts as rich platform data.
    const platformData = tier.richPlatformData
      ? JSON.stringify({
          verified: true,
          accountAge: "4y",
          tweetCount: 3_100,
          mediaCount: 210,
          pinnedPost: `demo-post-${index}`,
        })
      : null;

    const platforms = ["x", "linkedin", "substack"] as const;
    for (let n = 0; n < tier.identities; n += 1) {
      summary.identities += 1;
      createIdentity({
        contactId: contact.id,
        platform: platforms[n],
        platformUserId: `demo-${platforms[n]}-${person.handle}`,
        platformHandle: person.handle,
        displayName: person.name,
        headline: person.headline,
        followersCount: Math.round(person.followers * (n === 0 ? 1 : 0.4)),
        isPrimary: n === 0 ? 1 : 0,
        // `resolveContactProfile` reads headline/bio/location/website off the
        // identities, never off the contact, so these have to live here to
        // count toward the enrichment score.
        ...(tier.bio ? { bio: person.headline } : {}),
        ...(tier.location ? { location: "Remote" } : {}),
        ...(tier.website ? { websiteUrl: `https://${person.handle}.example.com` } : {}),
        ...(n === 0 && platformData ? { platformData } : {}),
      });
    }

    // `createContact` scores the contact before any identity exists, and
    // `createIdentity` does not re-score. Without this every contact keeps the
    // score it had when it had no platform profile at all — which is why the
    // first seeded set landed in a single histogram bucket.
    recalcContactEnrichment(contact.id);
    return contact;
  });

  DEMO_CONTENT.forEach((item, index) => {
    const account = accountFor(item.platform);
    const publishedAt = ago(item.age);
    summary.contentItems += 1;
    createContentItem(
      {
        title: item.title,
        body: item.body,
        contentType: item.contentType,
        status: item.status,
        origin: item.origin,
        direction: item.direction,
        platformAccountId: account.id,
        contactId: item.direction === "inbound" ? contacts[index % contacts.length].id : null,
        aiGenerated: index % 4 === 0,
        createdAt: publishedAt,
      },
      item.status === "published"
        ? {
            platformAccountId: account.id,
            status: "published",
            publishedAt,
            platformPostId: `demo-post-${index}`,
            engagementSnapshot: JSON.stringify({
              likes: item.likes, comments: item.comments,
              shares: item.shares, impressions: item.impressions,
            }),
          }
        : undefined,
    );
  });

  // The engagement analytics read a UNION over `interactions`, and only
  // `logInteraction` lets the timestamps be placed — `createEngagement` omits
  // `createdAt`, which would stack every row on today and flatten the chart.
  contacts.forEach((contact, index) => {
    const types = ["like", "reply", "follow", "comment", "share"] as const;
    for (let n = 0; n < 3; n += 1) {
      summary.interactions += 1;
      logInteraction({
        contactId: contact.id,
        interactionType: types[(index + n) % types.length],
        direction: n % 2 === 0 ? "inbound" : "outbound",
        occurredAt: ago((index + n * 3) % 28),
        source: "demo-seed",
        isMeaningful: n === 0,
      });
    }
  });

  const runs = DEMO_WORKFLOW_RUNS.map((run) => {
    const template = templates[summary.workflowRuns % Math.max(templates.length, 1)];
    summary.workflowRuns += 1;
    const created = createWorkflowRun({
      workflowType: run.workflowType,
      status: run.status,
      templateId: template?.id ?? null,
      platformAccountId: accountFor("x").id,
      model: run.model,
      costUsd: run.costUsd,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      processedItems: run.processed,
      successItems: run.success,
      errorItems: run.processed - run.success,
      trigger: "user",
      startedAt: ago(run.age),
      completedAt: run.status === "running" ? null : ago(run.age) + 240,
      createdAt: ago(run.age),
    });
    run.steps.forEach((stepType, stepIndex) => {
      summary.workflowSteps += 1;
      createWorkflowStep({
        workflowRunId: created.id,
        stepIndex,
        stepType: stepType as never,
        status: run.status === "failed" && stepIndex === run.steps.length - 1 ? "failed" : "completed",
        durationMs: 30_000 * (stepIndex + 1),
        createdAt: ago(run.age),
      });
    });
    return created;
  });

  DEMO_GOALS.forEach((goal, index) => {
    summary.goals += 1;
    const created = createGoal({
      name: goal.name,
      goalType: goal.goalType,
      targetValue: goal.targetValue,
      currentValue: goal.currentValue,
      unit: goal.unit,
      platform: goal.platform,
      status: goal.status,
      createdAt: ago(45),
    });
    const template = templates[index % Math.max(templates.length, 1)];
    if (template) {
      linkWorkflowToGoal(created.id, template.id, "primary");
    }
    // A short progress history so the goal detail chart is a line, not a point.
    for (let step = 4; step >= 0; step -= 1) {
      const value = Math.round((goal.currentValue * (5 - step)) / 5);
      createGoalProgress({
        goalId: created.id,
        value,
        delta: Math.round(goal.currentValue / 5),
        source: "demo-seed",
      });
    }
  });

  DEMO_TASKS.forEach((task) => {
    summary.tasks += 1;
    createTask({
      title: task.title,
      status: "todo",
      priority: task.priority,
      taskType: "follow_up",
      assignee: "user",
      relatedContactId: task.contactIndex === null ? null : contacts[task.contactIndex].id,
      createdAt: ago(2),
    });
  });

  void runs;
  return summary;
}
