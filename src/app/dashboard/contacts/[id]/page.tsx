import { notFound } from "next/navigation";
import { getContactById } from "@/lib/db/queries/contacts";
import { getContactExploreCard } from "@/lib/db/queries/contact-explore";
import { getTasksByContact } from "@/lib/db/queries/tasks";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME } from "@/lib/db/seed-templates";
import { ContactDetailClient } from "./contact-detail-client";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = getContactById(id);

  if (!contact) {
    notFound();
  }

  const tasks = getTasksByContact(id);
  const explore = getContactExploreCard(id);
  if (!explore) {
    notFound();
  }

  const profilePipelineTemplate = getSystemTemplateByName(CONTACT_PROFILE_PIPELINE_TEMPLATE_NAME);

  return (
    <ContactDetailClient
      contact={contact}
      tasks={tasks}
      explore={explore}
      profilePipelineTemplateId={profilePipelineTemplate?.id ?? null}
    />
  );
}
