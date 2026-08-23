import {
  RELATIONSHIP_GOAL_LABELS,
  type RelationshipGoal,
  type RelationshipGoalStatus,
} from "@/lib/relationship-goals";

export interface ContactGoalContext {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  platform?: string | null;
  platformHandle?: string | null;
  relationshipGoal?: RelationshipGoal | string | null;
  relationshipGoalStatus?: RelationshipGoalStatus | string | null;
}

export interface PersonaGoalContext {
  archetype?: string | null;
  tone?: string | null;
  summary?: string | null;
  interests?: string[] | string | null;
  conversionTriggers?: string[] | string | null;
  engagementFormats?: string[] | string | null;
}

export interface GoalTactic {
  goal: RelationshipGoal;
  goalLabel: string;
  headline: string;
  strategy: string;
  recommendedActions: string[];
  suggestedDraft: string;
  agentPrompt: string;
}

function parseArrayField(field: unknown): string[] {
  if (Array.isArray(field)) return field.map(String);
  if (typeof field === "string" && field.trim()) {
    try {
      const parsed = JSON.parse(field);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return field.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export function generateGoalTactic(
  contact: ContactGoalContext,
  persona?: PersonaGoalContext | null,
  overrideGoal?: RelationshipGoal | null,
  options?: { signalsBaseUrl?: string; taskId?: string },
): GoalTactic | null {
  const goal = (overrideGoal ?? contact.relationshipGoal) as RelationshipGoal | null;
  if (!goal || !(goal in RELATIONSHIP_GOAL_LABELS)) {
    return null;
  }

  const name = contact.firstName || contact.name || "this contact";
  const handle = contact.platformHandle ? `@${contact.platformHandle.replace(/^@/, "")}` : name;
  const company = contact.company || "their project";
  const role = contact.title || persona?.archetype || "builder";
  const tone = persona?.tone || "thoughtful and authentic";

  const interests = parseArrayField(persona?.interests);
  const conversionTriggers = parseArrayField(persona?.conversionTriggers);

  const interestsList = interests.length > 0
    ? interests.slice(0, 3).join(", ")
    : "their core domain";

  const trigger = conversionTriggers.length > 0
    ? conversionTriggers[0]
    : "shared technical interests";

  const baseUrl = options?.signalsBaseUrl || "$SIGNALS_BASE_URL";
  const taskCompletion = options?.taskId
    ? `\n   d. Mark CRM task done: POST ${baseUrl}/api/agent-tools/invoke with { "tool": "update_task", "input": { "taskId": "${options.taskId}", "status": "done" } }`
    : "";

  switch (goal) {
    case "follow_back": {
      return {
        goal,
        goalLabel: RELATIONSHIP_GOAL_LABELS[goal],
        headline: `3-Touch Follow-Back Strategy for ${name}`,
        strategy: `${name} responds to ${trigger}. Establish familiarity and technical credibility before following to trigger a natural follow-back.`,
        recommendedActions: [
          `Like ${name}'s latest milestone or project update about ${company}.`,
          `Reply with a concise, high-signal technical observation on ${interestsList} in a ${tone} tone.`,
          `Follow ${handle} from the acting profile after positive interaction.`,
        ],
        suggestedDraft: `Great work scaling ${company}. The focus on ${interestsList} is especially relevant as the space matures.`,
        agentPrompt: `Execute 3-touch follow-back protocol on ${handle} (${name}):
1. Inspect recent posts by ${handle} on ${contact.platform || "X"} via RealTimeX Browser / CDP.
2. Leave a high-value comment on their post about ${interestsList} (Suggested angle: "${name}, great work scaling ${company}...").
3. Follow ${handle} from the acting profile after commenting.
4. WRITE BACK TO SIGNALS CRM (Required):
   a. Save published comment to Signals Content:
      POST ${baseUrl}/api/content
      { "body": "<published comment text>", "contentType": "reply", "status": "published", "origin": "authored", "direction": "outbound", "platformTarget": "x", "contactId": "${contact.id}" }
   b. Log interaction touchpoint:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "log_interaction", "input": { "contactId": "${contact.id}", "interactionType": "social_reply", "summary": "Replied to ${handle}'s post on ${interestsList} and followed" } }
   c. Update contact goal status:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "update_contact", "input": { "contactId": "${contact.id}", "relationshipGoalStatus": "in_progress" } }${taskCompletion}`,
      };
    }

    case "repost_amplification": {
      return {
        goal,
        goalLabel: RELATIONSHIP_GOAL_LABELS[goal],
        headline: `Organic Amplification & Repost Plan for ${name}`,
        strategy: `As a ${role}, ${name} values ${trigger}. Highlighting ${company} in a curated teardown or spotlight creates strong social proof and immense incentive for ${handle} to repost to their audience.`,
        recommendedActions: [
          `Draft a curated spotlight post or breakdown featuring ${company} and tag ${handle}.`,
          `Highlight the unique mechanic or value proposition of ${company} around ${interestsList}.`,
          `Engage with ${name}'s reply when they acknowledge the spotlight.`,
        ],
        suggestedDraft: `Fascinating approach by ${handle} with ${company} — tackling ${interestsList} with a fresh model. Worth checking out for anyone tracking ${trigger}.`,
        agentPrompt: `Draft and publish an organic spotlight post for ${handle} (${name}, ${company}):
1. Draft high-signal spotlight highlighting ${company}'s work on ${interestsList} and tag ${handle}.
2. Publish post via RealTimeX Browser session.
3. WRITE BACK TO SIGNALS CRM (Required):
   a. Save published post to Signals Content:
      POST ${baseUrl}/api/content
      { "body": "<published post text>", "contentType": "post", "status": "published", "origin": "authored", "direction": "outbound", "platformTarget": "x", "contactId": "${contact.id}" }
   b. Log interaction touchpoint:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "log_interaction", "input": { "contactId": "${contact.id}", "interactionType": "tweet", "summary": "Published spotlight breakdown tagging ${handle}" } }
   c. Update contact goal status:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "update_contact", "input": { "contactId": "${contact.id}", "relationshipGoalStatus": "in_progress" } }${taskCompletion}`,
      };
    }

    case "mutual_engagement": {
      return {
        goal,
        goalLabel: RELATIONSHIP_GOAL_LABELS[goal],
        headline: `Peer Engagement & Rapport Building with ${name}`,
        strategy: `Build reciprocal engagement by answering ${name}'s open questions and contributing to their threads with genuine domain expertise.`,
        recommendedActions: [
          `Monitor ${handle}'s feed for questions, polls, or debate posts on ${interestsList}.`,
          `Provide an answer that gives specific data or practical solutions without pitching.`,
          `Acknowledge their responses promptly to build conversational momentum.`,
        ],
        suggestedDraft: `We noticed a similar pattern when testing ${interestsList} — decoupling the distribution layer made the biggest difference.`,
        agentPrompt: `Engage on ${handle}'s active discussions:
1. Find latest discussion post from ${handle} regarding ${interestsList}.
2. Post an authoritative, value-dense answer in a ${tone} tone.
3. WRITE BACK TO SIGNALS CRM (Required):
   a. Save comment to Signals Content:
      POST ${baseUrl}/api/content
      { "body": "<reply text>", "contentType": "reply", "status": "published", "origin": "authored", "direction": "outbound", "platformTarget": "x", "contactId": "${contact.id}" }
   b. Log interaction:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "log_interaction", "input": { "contactId": "${contact.id}", "interactionType": "social_reply", "summary": "Contributed domain answer to ${handle}'s thread" } }
   c. Update contact status:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "update_contact", "input": { "contactId": "${contact.id}", "relationshipGoalStatus": "in_progress" } }${taskCompletion}`,
      };
    }

    case "warm_conversation": {
      return {
        goal,
        goalLabel: RELATIONSHIP_GOAL_LABELS[goal],
        headline: `Direct Conversation / DM Outreach for ${name}`,
        strategy: `${name} is motivated by ${trigger}. Bridge recent public interactions into a private message asking for their feedback or sharing a specific resource.`,
        recommendedActions: [
          `Verify that at least 2 public interactions (likes/replies) have been completed.`,
          `Send a short, personalized DM referencing their work on ${company}.`,
          `Keep the ask low-friction: share a relevant insight or ask for their perspective on ${interestsList}.`,
        ],
        suggestedDraft: `Hey ${name}, loved your recent point about ${interestsList}. Had a quick thought on how that relates to ${company} — open to comparing notes?`,
        agentPrompt: `Send warm DM outreach to ${handle} (${name}):
1. Send personalized DM referencing public engagement on ${company} focusing on ${trigger}.
2. WRITE BACK TO SIGNALS CRM (Required):
   a. Save message to Signals Content:
      POST ${baseUrl}/api/content
      { "body": "<dm text>", "contentType": "dm", "status": "published", "origin": "authored", "direction": "outbound", "platformTarget": "x", "contactId": "${contact.id}" }
   b. Log interaction:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "log_interaction", "input": { "contactId": "${contact.id}", "interactionType": "dm", "summary": "Sent warm DM to ${handle} regarding ${interestsList}" } }
   c. Update contact status:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "update_contact", "input": { "contactId": "${contact.id}", "relationshipGoalStatus": "in_progress" } }${taskCompletion}`,
      };
    }

    case "partnership": {
      return {
        goal,
        goalLabel: RELATIONSHIP_GOAL_LABELS[goal],
        headline: `Partnership & Co-Marketing Proposal for ${name}`,
        strategy: `Align with ${name}'s goal of ${trigger}. Propose a mutual collaboration, cross-promotion, or ecosystem integration.`,
        recommendedActions: [
          `Identify a complementary distribution or integration hook between your product and ${company}.`,
          `Draft a structured proposal highlighting mutual audience reach in ${interestsList}.`,
          `Reach out through ${handle} with concrete mutual value metrics.`,
        ],
        suggestedDraft: `Hey ${name}, seeing great alignment between our ecosystems around ${interestsList}. Would love to explore a joint co-marketing feature that gives ${company} extra distribution.`,
        agentPrompt: `Draft partnership proposal for ${name} (${company}):
1. Scope mutual co-marketing opportunity around ${interestsList} emphasizing ${trigger}.
2. Reach out to ${handle} or stage brief in CRM.
3. WRITE BACK TO SIGNALS CRM (Required):
   a. Log interaction touchpoint:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "log_interaction", "input": { "contactId": "${contact.id}", "interactionType": "email", "summary": "Staged partnership proposal for ${name} on ${interestsList}" } }
   b. Update contact status:
      POST ${baseUrl}/api/agent-tools/invoke
      { "tool": "update_contact", "input": { "contactId": "${contact.id}", "relationshipGoalStatus": "in_progress" } }${taskCompletion}`,
      };
    }
  }
}
