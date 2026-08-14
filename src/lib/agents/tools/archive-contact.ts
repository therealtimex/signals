import {
  getContactById,
  archiveContact as archiveContactQuery,
} from "@/lib/db/queries/contacts";
import {
  createWorkflowStep,
  nextStepIndex,
} from "@/lib/db/queries/workflows";

export interface ArchiveContactResult {
  contactId: string;
  contactName: string;
  reason: string;
  archived: boolean;
}

/**
 * Archive a contact with a reason. Logs a `contact_archive` workflow step.
 * Used by the agent runner's `archive_contact` tool during prune workflows.
 */
export async function archiveContactTool(
  contactId: string,
  reason: string,
  workflowRunId?: string
): Promise<ArchiveContactResult> {
  const startTime = Date.now();

  const contact = getContactById(contactId);
  if (!contact) {
    const error = `Contact not found: ${contactId}`;

    if (workflowRunId) {
      createWorkflowStep({
        workflowRunId,
        stepIndex: nextStepIndex(workflowRunId),
        stepType: "contact_archive",
        status: "failed",
        contactId,
        tool: "archive_contact",
        input: JSON.stringify({ contactId, reason }),
        output: JSON.stringify({ error }),
        error,
        durationMs: Date.now() - startTime,
      });
    }

    return {
      contactId,
      contactName: "Unknown",
      reason,
      archived: false,
    };
  }

  const updated = archiveContactQuery(contactId, reason, workflowRunId);

  if (workflowRunId) {
    createWorkflowStep({
      workflowRunId,
      stepIndex: nextStepIndex(workflowRunId),
      stepType: "contact_archive",
      status: "completed",
      contactId,
      tool: "archive_contact",
      input: JSON.stringify({ contactId, reason }),
      output: JSON.stringify({
        contactId,
        contactName: contact.name,
        reason,
        archived: !!updated,
      }),
      durationMs: Date.now() - startTime,
    });
  }

  return {
    contactId,
    contactName: contact.name,
    reason,
    archived: !!updated,
  };
}
