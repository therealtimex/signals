import type { GuideMeta } from "@/lib/guide/types";

const GUIDES: GuideMeta[] = [
  {
    slug: "getting-started",
    filename: "01-getting-started.md",
    order: 1,
    title: "Getting Started",
    description:
      "Installation, API keys, platform connections, and your first dashboard tour",
    icon: "Rocket",
  },
  {
    slug: "contacts-and-enrichment",
    filename: "02-contacts-and-enrichment.md",
    order: 2,
    title: "Contacts and Enrichment",
    description:
      "Multi-platform contacts, AI-powered enrichment, and smart pruning",
    icon: "Users",
  },
  {
    slug: "content-and-publishing",
    filename: "03-content-and-publishing.md",
    order: 3,
    title: "Content and Publishing",
    description:
      "Content library, AI-assisted writing, and browser-based publishing",
    icon: "FileText",
  },
  {
    slug: "ai-agents-and-automation",
    filename: "04-ai-agents-and-automation.md",
    order: 4,
    title: "AI Agents and Automation",
    description:
      "Agent gallery, workflow execution, scheduling, and observability",
    icon: "Zap",
  },
  {
    slug: "analytics-and-goals",
    filename: "05-analytics-and-goals.md",
    order: 5,
    title: "Analytics and Goals",
    description: "Dashboard analytics, goal tracking, and demand generation",
    icon: "BarChart3",
  },
];

/** Returns all guide metas ordered by `order`. */
export function getAllGuideMetas(): GuideMeta[] {
  return GUIDES;
}

/** Returns a single guide meta by slug, or undefined. */
export function getGuideMeta(slug: string): GuideMeta | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/**
 * Derive a slug from a guide filename.
 * `01-getting-started.md` → `getting-started`
 */
export function filenameToSlug(filename: string): string {
  return filename.replace(/^\d+-/, "").replace(/\.md$/, "");
}
