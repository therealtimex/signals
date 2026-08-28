export const VALID_ORG_TABS = ["overview", "people", "signals", "activity", "notes"] as const;
export type OrgTab = (typeof VALID_ORG_TABS)[number];

export function parseOrgTab(value: string | null | undefined): OrgTab {
  return value && (VALID_ORG_TABS as readonly string[]).includes(value)
    ? (value as OrgTab)
    : "overview";
}

export function orgTabHref(orgId: string, tab: OrgTab): string {
  return `/dashboard/organizations/${orgId}?tab=${tab}`;
}
