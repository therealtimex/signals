export const RELATIONSHIP_GOAL_ENUM = [
  "follow_back",
  "repost_amplification",
  "mutual_engagement",
  "warm_conversation",
  "partnership",
] as const;

export type RelationshipGoal = (typeof RELATIONSHIP_GOAL_ENUM)[number];

export const RELATIONSHIP_GOAL_STATUS_ENUM = [
  "not_started",
  "in_progress",
  "achieved",
  "paused",
] as const;

export type RelationshipGoalStatus = (typeof RELATIONSHIP_GOAL_STATUS_ENUM)[number];

export const RELATIONSHIP_GOAL_LABELS: Record<RelationshipGoal, string> = {
  follow_back: "Follow Back",
  repost_amplification: "Repost & Amplify",
  mutual_engagement: "Mutual Engagement",
  warm_conversation: "Warm Conversation",
  partnership: "Partnership / Collab",
};

export const RELATIONSHIP_GOAL_SHORT_LABELS: Record<RelationshipGoal, string> = {
  follow_back: "Follow",
  repost_amplification: "Repost",
  mutual_engagement: "Engage",
  warm_conversation: "Talk",
  partnership: "Collab",
};

export const RELATIONSHIP_GOAL_STATUS_LABELS: Record<RelationshipGoalStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  achieved: "Achieved",
  paused: "Paused",
};
