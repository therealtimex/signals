import type { Org, OrgIdentity } from "@/lib/db/types";
import type { OrgEnrichmentState } from "@/lib/orgs/enrichment";
import {
  formatProvenanceLine,
  type ProvenanceSummary,
} from "@/lib/orgs/provenance";

export type OrgIdentitySummary = Pick<
  OrgIdentity,
  "id" | "platform" | "platformHandle" | "platformUrl" | "displayName" | "avatarUrl" | "isVerified"
>;

export type OrgFieldProvenance = Record<
  string,
  {
    source: string;
    tag: string;
    at: number;
    workflowRunId?: string;
    evidenceUrl?: string;
  }
>;

export type OrgDTO = Omit<Org, "tags"> & {
  tags: string[];
  domains: { domain: string; kind: "primary" | "alias" }[];
  identities: OrgIdentitySummary[];
  owner: { contactId: string; name: string } | null;
  provenance: ProvenanceSummary;
  fieldProvenance: OrgFieldProvenance;
  enrichment: OrgEnrichmentState;
  completeness: { score: number; missing: string[] };
};

function parseMetadata(metadata: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadata ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function serializeOrgDTO(input: {
  org: Org;
  domains: { domain: string; kind: "primary" | "alias" }[];
  identities: OrgIdentity[];
  owner: { contactId: string; name: string } | null;
  enrichment?: OrgEnrichmentState;
  createdTemplateName?: string | null;
}): OrgDTO {
  const metadata = parseMetadata(input.org.metadata);
  const fieldProvenance =
    typeof metadata.fieldProvenance === "object" &&
    metadata.fieldProvenance !== null &&
    !Array.isArray(metadata.fieldProvenance)
      ? (metadata.fieldProvenance as OrgFieldProvenance)
      : {};
  const tracked = {
    domain: input.org.domain,
    website: input.org.website,
    description: input.org.description,
    industry: input.org.industry,
    companySize: input.org.companySize,
    headquarters: input.org.location,
    logo: input.org.avatarUrl,
    socialProfile: input.identities.length > 0 ? "present" : null,
  };
  const missing = Object.entries(tracked)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    ...input.org,
    tags: parseStringArray(input.org.tags),
    domains: input.domains,
    identities: input.identities.map((identity) => ({
      id: identity.id,
      platform: identity.platform,
      platformHandle: identity.platformHandle,
      platformUrl: identity.platformUrl,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      isVerified: identity.isVerified,
    })),
    owner: input.owner,
    provenance: formatProvenanceLine({
      createdSource: input.org.createdSource,
      createdSourceDetail: input.org.createdSourceDetail,
      legacySource: input.org.source,
      createdWorkflowRunId: input.org.createdWorkflowRunId,
      createdTemplateId: input.org.createdTemplateId,
      createdTemplateName: input.createdTemplateName,
      createdAt: input.org.createdAt,
    }),
    fieldProvenance,
    enrichment: input.enrichment ?? {
      status: "idle",
      workflowRunId: null,
      lastRunAt: null,
      fieldsUpdated: [],
      unresolvedFields: [],
      message: null,
    },
    completeness: {
      score: Math.round(((Object.keys(tracked).length - missing.length) / Object.keys(tracked).length) * 100),
      missing,
    },
  };
}

function parseStringArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
