export const ORG_ACTIVITY_TYPE_GROUPS = {
  signal: [
    "funding",
    "hiring",
    "leadership_change",
    "product_launch",
    "news",
    "content",
    "engagement",
  ],
  workspace: [
    "note",
    "contact_linked",
    "contact_unlinked",
    "profile_updated",
    "profile_enriched",
    "email_pattern_inferred",
    "email_verified",
    "followed",
    "unfollowed",
    "workflow_started",
    "task_created",
  ],
} as const;

export type OrgActivityCategory = keyof typeof ORG_ACTIVITY_TYPE_GROUPS;
export type OrgActivityType = (typeof ORG_ACTIVITY_TYPE_GROUPS)[OrgActivityCategory][number];
export const ORG_ACTIVITY_TYPES = [
  ...ORG_ACTIVITY_TYPE_GROUPS.signal,
  ...ORG_ACTIVITY_TYPE_GROUPS.workspace,
] as const;

export function assertOrgActivityType(value: string): OrgActivityType {
  if (!(ORG_ACTIVITY_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Invalid company activity type: ${value}`);
  }
  return value as OrgActivityType;
}

export function orgActivityCategory(value: string): OrgActivityCategory {
  return (ORG_ACTIVITY_TYPE_GROUPS.signal as readonly string[]).includes(value)
    ? "signal"
    : "workspace";
}
