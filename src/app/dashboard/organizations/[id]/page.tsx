import { notFound } from "next/navigation";
import { getOrgById, listOrgLinkedContacts } from "@/lib/db/queries/orgs";
import { OrganizationDetailClient } from "./organization-detail-client";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = getOrgById(id);
  if (!org) {
    notFound();
  }

  const contacts = listOrgLinkedContacts(id);
  return <OrganizationDetailClient org={org} contacts={contacts} />;
}
