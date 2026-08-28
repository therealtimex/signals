import type { Org } from "@/lib/db/types";

const SIZE_RANGES: Record<
  NonNullable<Org["companySize"]>,
  { min: number; max: number | null }
> = {
  "1-10": { min: 1, max: 10 },
  "11-50": { min: 11, max: 50 },
  "51-200": { min: 51, max: 200 },
  "201-500": { min: 201, max: 500 },
  "501-1000": { min: 501, max: 1000 },
  "1001-5000": { min: 1001, max: 5000 },
  "5001-10000": { min: 5001, max: 10000 },
  "10001+": { min: 10001, max: null },
};

export function companySizeToEmployeeRange(companySize: Org["companySize"]) {
  if (!companySize) return undefined;
  const range = SIZE_RANGES[companySize];
  return { min: range.min, max: range.max, unitText: "employees" as const };
}

const ORG_TYPE_MAP: Record<Org["orgType"], string> = {
  company: "Corporation",
  fund: "InvestmentFund",
  team: "Organization",
  community: "Organization",
  other: "Organization",
};

export function orgTypeToArooOrganizationType(orgType: Org["orgType"]): string {
  return ORG_TYPE_MAP[orgType];
}
