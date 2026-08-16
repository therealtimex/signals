import type { ContactEmploymentDTO } from "@/lib/db/queries/contact-dto";

export type DraftContactEmployment = {
  id?: string;
  orgId?: string;
  orgName?: string;
  title?: string;
  startedAt?: number | null;
  endedAt?: number | null;
  isCurrent?: boolean;
};

export function emptyDraftEmployment(): DraftContactEmployment {
  return {
    orgName: "",
    title: "",
    isCurrent: true,
  };
}

export function draftFromContactEmployment(
  employment: ContactEmploymentDTO,
): DraftContactEmployment {
  return {
    id: employment.id,
    orgId: employment.orgId,
    orgName: employment.orgName,
    title: employment.title ?? "",
    startedAt: employment.startedAt,
    endedAt: employment.endedAt,
    isCurrent: employment.isCurrent,
  };
}

export function draftFromLegacyCompany(company?: string | null, title?: string | null): DraftContactEmployment[] {
  if (!company?.trim()) return [];
  return [
    {
      orgName: company,
      title: title ?? "",
      isCurrent: true,
    },
  ];
}
