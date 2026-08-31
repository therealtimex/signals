import type { WorkflowType } from "@/lib/workflows/types";

/** Search provider for web search routing. */
export type SearchProvider = "serper" | "tavily";

/** Configuration for an agent workflow run. */
export interface AgentRunConfig {
  templateId?: string;
  workflowType: WorkflowType;
  systemPrompt?: string;
  maxSteps?: number;
  model?: string;
  config?: Record<string, unknown>;
}

/** Result of a URL fetch operation. */
export interface UrlFetchResult {
  url: string;
  title: string;
  description: string;
  content: string;
  contentLength: number;
  needsBrowser: boolean;
}

/** A single web search result. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Result of a web search operation. */
export interface WebSearchResult {
  query: string;
  results: SearchResult[];
  totalResults: number;
  provider?: SearchProvider;
  /** AI-generated summary (Tavily only). */
  answer?: string;
}

/** Result of enriching a contact. */
export interface EnrichContactResult {
  contactId: string;
  contactName: string;
  fieldsUpdated: string[];
  previousScore: number;
  newScore: number;
  emailsObserved: number;
  experiencesUpserted: number;
}

/** Result of engaging with a post via browser automation. */
export interface EngagePostResult {
  success: boolean;
  action: "like" | "reply" | "retweet";
  platform: "x" | "linkedin";
  postUrl: string;
  error?: string;
}

/** Routing strategy for a URL. */
export type FetchStrategy = "url_fetch" | "browser_scrape";

/** Result of the routing decision. */
export interface RoutingDecision {
  url: string;
  strategy: FetchStrategy;
  reason: string;
}

/** Cost rates for Claude models (per 1M tokens). */
export const MODEL_COST_RATES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.0 },
};

/** Default model for agent workflows. */
export const DEFAULT_AGENT_MODEL = "claude-sonnet-4-5-20250929";
