import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getOrgDTO } from "@/lib/db/queries/orgs";
import { getContactById, getOwnerContactId } from "@/lib/db/queries/contacts";
import { getOrgRelationshipSummary } from "@/lib/db/queries/org-relationships";
import { listOrgPeople } from "@/lib/db/queries/org-people";
import { getOrgEmailIntelligence } from "@/lib/contacts/email-patterns/intelligence";
import { listOrgTimeline } from "@/lib/db/queries/org-activities";
import { OrganizationDetailClient } from "./organization-detail-client";
import { getOrgSignalScanState } from "@/lib/orgs/signal-scan-state";
import { loadAndProjectOrgToAroo } from "@/lib/arpp/load";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = getOrgDTO(id);
  if (!org) {
    notFound();
  }

  const people = listOrgPeople(id, { employment: "all", pageSize: 100 });
  const relationships = getOrgRelationshipSummary(id);
  const emailIntelligence = getOrgEmailIntelligence(id);
  const timeline = listOrgTimeline(id, { pageSize: 100 });
  const signalScanState = getOrgSignalScanState(id, org.followedAt);
  const ownerContactId = getOwnerContactId();
  const selfContact = ownerContactId ? getContactById(ownerContactId) : null;
  const agentProfile = loadAndProjectOrgToAroo(id, { visibility: "internal" });
  return (
    <Suspense fallback={<div className="min-h-96 animate-pulse rounded-lg bg-muted/40" />}>
      <OrganizationDetailClient
        org={org}
        people={people.data}
        relationships={relationships}
        emailIntelligence={emailIntelligence}
        timeline={timeline}
        signalScanState={signalScanState}
        selfContact={selfContact ? { id: selfContact.id, name: selfContact.name } : null}
        agentProfile={agentProfile}
      />
    </Suspense>
  );
}
