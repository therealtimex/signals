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
  const engagementFormats = parseArrayField(persona?.engagementFormats);

  const interestsList = interests.length > 0
    ? interests.slice(0, 3).join(", ")
    : "their core domain";

  const trigger = conversionTriggers.length > 0
    ? conversionTriggers[0]
    : "shared technical interests";

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
        agentPrompt: `Execute 3-touch follow-back protocol on ${handle} (${name}):\n1. Inspect recent posts by ${handle} on ${contact.platform || "X"}.\n2. Leave a high-value comment matching their interest in ${interestsList}.\n3. Follow ${handle} from acting profile.\n4. Log touchpoint in Signals.`,
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
        agentPrompt: `Draft and publish an organic spotlight post for ${handle} (${name}, ${company}):\n1. Highlight ${company}'s unique angle on ${interestsList}.\n2. Tag ${handle} naturally as the creator/builder.\n3. Tone: ${tone}.\n4. Log content post in Signals.`,
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
        agentPrompt: `Lurk and engage on ${handle}'s active discussions:\n1. Search latest posts from ${handle} discussing ${interestsList}.\n2. Post a high-effort value reply in a ${tone} tone.\n3. Record engagement in Signals CRM.`,
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
        agentPrompt: `Prepare warm conversation outreach for ${handle} (${name}):\n1. Reference recent public engagement on ${company}.\n2. Focus message on ${trigger}.\n3. Tone: ${tone}.\n4. Stage draft task in Signals.`,
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
        agentPrompt: `Draft partnership brief for ${name} (${company}):\n1. Scope mutual co-marketing or integration opportunity around ${interestsList}.\n2. Emphasize ${trigger}.\n3. Create follow-up task in Signals.`,
      };
    }
  }
}
