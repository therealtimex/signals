import {
  BarChart3,
  TrendingUp,
  Activity,
  Users,
  Search,
  Sparkles,
  UserPlus,
  FileText,
  Play,
  AlertCircle,
  ListChecks,
  PenTool,
  MessageSquare,
  Settings,
  Database,
  Hash,
  ClipboardList,
  Eye,
  Target,
  Zap,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import type { PageContext } from "@/lib/chat/types";

export interface SmartPrompt {
  text: string;
  icon: LucideIcon;
}

type PromptTuple = [string, LucideIcon];

const PAGE_PROMPTS: Record<string, PromptTuple[]> = {
  "/dashboard": [
    ["Give me a summary of my CRM", BarChart3],
    ["Show my top contacts by enrichment score", TrendingUp],
    ["What workflows ran recently?", Activity],
  ],
  "/dashboard/contacts": [
    ["Show my highest-scored contacts", TrendingUp],
    ["Which contacts need enrichment?", Search],
    ["Add a new contact to my CRM", UserPlus],
  ],
  "/dashboard/contacts/[id]": [
    ["Summarize this contact's profile and activity", Users],
    ["Create a follow-up task for this contact", ClipboardList],
    ["Find similar contacts in my CRM", Search],
  ],
  "/dashboard/workflows": [
    ["Show me recently completed runs", ListChecks],
    ["Which agents are available to run?", FileText],
    ["Start an enrichment agent", Play],
  ],
  "/dashboard/workflows/[id]": [
    ["What is the status of this run?", Activity],
    ["Show me the results from this run", Eye],
    ["Are there any errors in this run?", AlertCircle],
  ],
  "/dashboard/content": [
    ["Show my most recent published content", FileText],
    ["What content types do I have the most of?", Hash],
    ["Find draft content that needs publishing", PenTool],
  ],
  "/dashboard/content/[id]": [
    ["Summarize this content item", Sparkles],
    ["Who engaged with this content?", MessageSquare],
    ["Suggest a follow-up post based on this", PenTool],
  ],
  "/dashboard/analytics": [
    ["Give me a CRM health overview", BarChart3],
    ["How are my workflows performing?", Activity],
    ["Which contacts have the highest engagement?", TrendingUp],
  ],
  "/dashboard/goals": [
    ["Show my active goals", Target],
    ["Which goals are behind schedule?", AlertCircle],
    ["What workflows contribute to my goals?", Zap],
  ],
  "/dashboard/goals/[id]": [
    ["How is this goal progressing?", TrendingUp],
    ["Which workflows are linked to this goal?", Zap],
    ["Is this goal on track to meet the deadline?", Target],
  ],
  "/dashboard/settings": [
    ["What platforms are connected?", Settings],
    ["Show me my CRM statistics", Database],
    ["How many contacts do I have?", Users],
  ],
  "/dashboard/guide": [
    ["How do I get started with Signals?", BookOpen],
    ["What AI agents are available?", Zap],
    ["How does contact enrichment work?", Users],
  ],
  "/dashboard/guide/[slug]": [
    ["Summarize this guide for me", BookOpen],
    ["What are the key steps in this tutorial?", BookOpen],
    ["How does this feature connect to other parts of Signals?", Zap],
  ],
};

const DEFAULT_KEY = "/dashboard";

/**
 * Returns 3 context-aware prompts for the current page.
 * Detail pages (contacts/[id], workflows/[id], content/[id]) are
 * matched by checking for a present entity ID in the context.
 */
export function getSmartPrompts(ctx: PageContext): SmartPrompt[] {
  let key: string;

  if (ctx.contactId) {
    key = "/dashboard/contacts/[id]";
  } else if (ctx.workflowId) {
    key = "/dashboard/workflows/[id]";
  } else if (ctx.contentId) {
    key = "/dashboard/content/[id]";
  } else if (ctx.goalId) {
    key = "/dashboard/goals/[id]";
  } else if (ctx.guideSlug) {
    key = "/dashboard/guide/[slug]";
  } else {
    // Try exact path match, fall back to default
    key = PAGE_PROMPTS[ctx.path] ? ctx.path : DEFAULT_KEY;
  }

  const tuples = PAGE_PROMPTS[key] ?? PAGE_PROMPTS[DEFAULT_KEY];
  return tuples.map(([text, icon]) => ({ text, icon }));
}
