import {
  getContactById,
  updateContact,
} from "@/lib/db/queries/contacts";
import {
  createWorkflowStep,
  nextStepIndex,
} from "@/lib/db/queries/workflows";
import type { EnrichContactResult } from "@/lib/agents/types";

/**
 * Enrich a contact with extracted data using "fill gaps, don't overwrite" strategy.
 * Updates the contact record and recalculates enrichment score.
 */
export async function enrichContact(
  contactId: string,
  data: {
    company?: string;
    title?: string;
    headline?: string;
    email?: string;
    phone?: string;
    location?: string;
    website?: string;
    bio?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  },
  workflowRunId?: string
): Promise<EnrichContactResult> {
  const startTime = Date.now();

  const contact = getContactById(contactId);
  if (!contact) {
    const error = `Contact not found: ${contactId}`;

    if (workflowRunId) {
      createWorkflowStep({
        workflowRunId,
        stepIndex: nextStepIndex(workflowRunId),
        stepType: "contact_merge",
        status: "failed",
        contactId,
        tool: "enrich_contact",
        input: JSON.stringify({ contactId }),
        output: JSON.stringify({ error }),
        error,
        durationMs: Date.now() - startTime,
      });
    }

    return {
      contactId,
      contactName: "Unknown",
      fieldsUpdated: [],
      previousScore: 0,
      newScore: 0,
    };
  }

  const previousScore = contact.enrichmentScore;
  const fieldsUpdated: string[] = [];
  const updates: Record<string, unknown> = {};

  // Fill gaps — only set if the contact field is currently empty
  if (!contact.company && data.company) { updates.company = data.company; fieldsUpdated.push("company"); }
  if (!contact.title && data.title) { updates.title = data.title; fieldsUpdated.push("title"); }
  if (!contact.headline && data.headline) { updates.headline = data.headline; fieldsUpdated.push("headline"); }
  if (!contact.email && data.email) { updates.email = data.email; fieldsUpdated.push("email"); }
  if (!contact.phone && data.phone) { updates.phone = data.phone; fieldsUpdated.push("phone"); }
  if (!contact.location && data.location) { updates.location = data.location; fieldsUpdated.push("location"); }
  if (!contact.website && data.website) { updates.website = data.website; fieldsUpdated.push("website"); }
  if (!contact.bio && data.bio) { updates.bio = data.bio; fieldsUpdated.push("bio"); }

  // Merge tags additively
  if (data.tags && data.tags.length > 0) {
    const existingTags: string[] = JSON.parse(contact.tags ?? "[]");
    const mergedTags = [...new Set([...existingTags, ...data.tags])];
    if (mergedTags.length > existingTags.length) {
      updates.tags = JSON.stringify(mergedTags);
      fieldsUpdated.push("tags");
    }
  }

  // Merge metadata additively
  if (data.metadata) {
    const existingMeta: Record<string, unknown> = JSON.parse(contact.metadata ?? "{}");
    updates.metadata = JSON.stringify({
      ...existingMeta,
      ...data.metadata,
      agentEnrichment: {
        ...(existingMeta.agentEnrichment as Record<string, unknown> ?? {}),
        ...data.metadata,
        enrichedAt: Math.floor(Date.now() / 1000),
      },
    });
    fieldsUpdated.push("metadata");
  }

  // Apply updates if any
  let newScore = previousScore;
  if (fieldsUpdated.length > 0) {
    const updated = updateContact(contactId, updates);
    newScore = updated?.enrichmentScore ?? previousScore;
  }

  if (workflowRunId) {
    createWorkflowStep({
      workflowRunId,
      stepIndex: nextStepIndex(workflowRunId),
      stepType: "contact_merge",
      status: "completed",
      contactId,
      tool: "enrich_contact",
      input: JSON.stringify({ contactId, fieldsProvided: Object.keys(data) }),
      output: JSON.stringify({
        fieldsUpdated,
        previousScore,
        newScore,
      }),
      durationMs: Date.now() - startTime,
    });
  }

  return {
    contactId,
    contactName: contact.name,
    fieldsUpdated,
    previousScore,
    newScore,
  };
}
