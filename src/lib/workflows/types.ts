/** Workflow type identifiers. */
export type WorkflowType =
  | "sync"
  | "import"
  | "enrich"
  | "search"
  | "prune"
  | "sequence"
  | "agent"
  | "simulate"
  | "calibrate"
  | "persona";

/** Step types for workflow observability. */
export type WorkflowStepType =
  | "url_fetch"
  | "browser_scrape"
  | "web_search"
  | "llm_extract"
  | "contact_merge"
  | "contact_create"
  | "contact_archive"
  | "routing_decision"
  | "sync_page"
  | "error"
  // Agent step types
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "decision"
  | "engagement_action"
  // Phase 6 step types
  | "content_publish"
  | "post_engagement";

/** Human-readable labels for workflow types. */
export const WORKFLOW_TYPE_LABELS: Record<WorkflowType, string> = {
  sync: "Platform Sync",
  import: "File Import",
  enrich: "Contact Enrichment",
  search: "Web Search",
  prune: "Contact Pruning",
  sequence: "Sequence",
  agent: "AI Agent",
  simulate: "Wind Tunnel Simulation",
  calibrate: "Simulation Calibration",
  persona: "Persona Generation",
};

/** Sub-type qualifiers for sync workflows. */
export type SyncSubType =
  | "x_contacts"
  | "x_tweets"
  | "x_mentions"
  | "x_enrich"
  | "gmail_contacts"
  | "gmail_metadata"
  | "linkedin_contacts";

/** Human-readable labels for sync sub-types. */
export const SYNC_SUBTYPE_LABELS: Record<SyncSubType, string> = {
  x_contacts: "X Contacts",
  x_tweets: "X Tweets",
  x_mentions: "X Mentions",
  x_enrich: "X Profile Enrichment",
  gmail_contacts: "Gmail Contacts",
  gmail_metadata: "Gmail Email Metadata",
  linkedin_contacts: "LinkedIn Connections",
};

/** Config shape stored in workflowRuns.config JSON. */
export interface WorkflowConfig {
  syncSubType?: SyncSubType;
  platformAccountId?: string;
  maxPages?: number;
  maxProfiles?: number;
  maxContacts?: number;
  contactIds?: string[];
  [key: string]: unknown;
}

/** Config for agent-type workflows. */
export interface AgentConfig {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: string[];
}
