import {
  getContactById,
  recalcEnrichment,
  updateContact,
} from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { contactIdentities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { normalizeChannelValue } from "@/lib/db/channel-types";
import {
  createContactChannel,
  listContactChannels,
  resolvePrimaryChannel,
  updateContactChannel,
} from "@/lib/db/queries/contact-channels";
import {
  createContactEmployment,
  listContactEmployments,
  updateContactEmployment,
} from "@/lib/db/queries/contact-employments";
import { ensureOrgByName } from "@/lib/db/queries/orgs";
import {
  createWorkflowStep,
  nextStepIndex,
} from "@/lib/db/queries/workflows";
import type { EnrichContactResult } from "@/lib/agents/types";

type ResearchEvidence = {
  evidenceUrl: string;
  evidenceText?: string;
  sourcePlatform?: string;
};

type ObservedEmail = ResearchEvidence & {
  address: string;
  evidenceText: string;
};

type EmploymentObservation = ResearchEvidence & {
  orgName: string;
  title?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  isCurrent: boolean;
};

type EnrichmentData = {
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
  observedEmails?: ObservedEmail[];
  employmentObservations?: EmploymentObservation[];
};

function parseMetadata(value: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function appendResearchEvidence(
  existingMetadata: Record<string, unknown>,
  input: ResearchEvidence & { kind: "profile_email" | "profile_experience" },
): { metadata: Record<string, unknown>; changed: boolean } {
  const research = objectValue(existingMetadata.contactWebResearch);
  const observations = Array.isArray(research.observations)
    ? research.observations.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === "object" && !Array.isArray(value),
      )
    : [];
  const evidenceText = input.evidenceText?.trim();
  const sourcePlatform = input.sourcePlatform?.trim();
  const duplicate = observations.some(
    (observation) =>
      observation.kind === input.kind &&
      observation.evidenceUrl === input.evidenceUrl &&
      observation.evidenceText === evidenceText &&
      observation.sourcePlatform === sourcePlatform,
  );
  if (duplicate) return { metadata: existingMetadata, changed: false };

  const nextObservation = {
    kind: input.kind,
    evidenceUrl: input.evidenceUrl,
    ...(evidenceText ? { evidenceText } : {}),
    ...(sourcePlatform ? { sourcePlatform } : {}),
    ...(input.kind === "profile_email" ? { sourceConfirmed: true } : {}),
    observedAt: Math.floor(Date.now() / 1000),
  };
  return {
    metadata: {
      ...existingMetadata,
      contactWebResearch: {
        ...research,
        observations: [...observations, nextObservation],
      },
    },
    changed: true,
  };
}

function recordObservedEmail(contactId: string, observation: ObservedEmail): boolean {
  const normalized = normalizeChannelValue("email", observation.address);
  const existing = listContactChannels(contactId).find(
    (channel) =>
      channel.channelType === "email" && channel.valueNormalized === normalized,
  );
  const evidence = appendResearchEvidence(parseMetadata(existing?.metadata ?? null), {
    ...observation,
    kind: "profile_email",
  });

  if (existing) {
    if (evidence.changed) {
      updateContactChannel(existing.id, { metadata: evidence.metadata });
    }
    return evidence.changed;
  }

  createContactChannel({
    contactId,
    channelType: "email",
    value: observation.address,
    label: observation.sourcePlatform === "linkedin" ? "LinkedIn self-published" : "Self-published",
    isPrimary: !resolvePrimaryChannel(contactId, "email"),
    isVerified: false,
    source: "agent:contact_web_research",
    metadata: evidence.metadata,
  });
  return true;
}

function normalizedTitle(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function recordEmploymentObservation(
  contactId: string,
  observation: EmploymentObservation,
): boolean {
  const org = ensureOrgByName(observation.orgName, "agent:contact_web_research");
  const sameRole = listContactEmployments(contactId).filter(
    (employment) =>
      employment.orgId === org.id &&
      normalizedTitle(employment.title) === normalizedTitle(observation.title),
  );
  const existing =
    sameRole.find((employment) => employment.startedAt === (observation.startedAt ?? null)) ??
    sameRole.find(
      (employment) => employment.startedAt === null || observation.startedAt == null,
    );
  const evidence = appendResearchEvidence(parseMetadata(existing?.metadata ?? null), {
    ...observation,
    kind: "profile_experience",
  });

  if (!existing) {
    createContactEmployment({
      contactId,
      orgId: org.id,
      title: observation.title ?? null,
      startedAt: observation.startedAt ?? null,
      endedAt: observation.endedAt ?? null,
      isCurrent: observation.isCurrent,
      source: "agent:contact_web_research",
      metadata: evidence.metadata,
    });
    return true;
  }

  const updates: Parameters<typeof updateContactEmployment>[1] = {};
  if (existing.startedAt === null && observation.startedAt != null) {
    updates.startedAt = observation.startedAt;
  }
  if (existing.endedAt === null && observation.endedAt != null) {
    updates.endedAt = observation.endedAt;
  }
  if (existing.isCurrent !== observation.isCurrent) {
    updates.isCurrent = observation.isCurrent;
  }
  if (evidence.changed) updates.metadata = evidence.metadata;
  if (Object.keys(updates).length === 0) return false;

  updateContactEmployment(existing.id, updates);
  return true;
}

/**
 * Enrich a contact with extracted data using "fill gaps, don't overwrite" strategy.
 * Updates the contact record and recalculates enrichment score.
 */
export async function enrichContact(
  contactId: string,
  data: EnrichmentData,
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
      emailsObserved: 0,
      experiencesUpserted: 0,
    };
  }

  const previousScore = contact.enrichmentScore;
  const fieldsUpdated: string[] = [];
  const updates: Record<string, unknown> = {};

  // Fill gaps — only set if the contact field is currently empty
  if (!contact.company && data.company) { updates.company = data.company; fieldsUpdated.push("company"); }
  if (!contact.title && data.title) { updates.title = data.title; fieldsUpdated.push("title"); }
  if (!contact.primaryEmail && data.email) { updates.email = data.email; fieldsUpdated.push("email"); }
  if (!contact.primaryPhone && data.phone) { updates.phone = data.phone; fieldsUpdated.push("phone"); }

  const identityPatch: Record<string, string> = {};
  if (!contact.profile.headline && data.headline) {
    identityPatch.headline = data.headline;
    fieldsUpdated.push("headline");
  }
  if (!contact.profile.location && data.location) {
    identityPatch.location = data.location;
    fieldsUpdated.push("location");
  }
  if (!contact.profile.website && data.website) {
    identityPatch.websiteUrl = data.website;
    fieldsUpdated.push("website");
  }
  if (!contact.profile.bio && data.bio) {
    identityPatch.bio = data.bio;
    fieldsUpdated.push("bio");
  }

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
  if (Object.keys(identityPatch).length > 0) {
    const primary =
      contact.identities.find((identity) => identity.isPrimary) ?? contact.identities[0];
    if (primary) {
      db.update(contactIdentities)
        .set({
          ...identityPatch,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(contactIdentities.id, primary.id))
        .run();
    }
  }
  if (Object.keys(updates).length > 0) {
    const updated = updateContact(contactId, updates);
    newScore = updated?.enrichmentScore ?? previousScore;
  } else if (Object.keys(identityPatch).length > 0) {
    recalcEnrichment(contactId);
    const updated = getContactById(contactId);
    newScore = updated?.enrichmentScore ?? previousScore;
  }

  let emailsObserved = 0;
  let experiencesUpserted = 0;
  let emailEvidenceUpdated = false;
  let experienceUpdated = false;
  for (const observation of data.observedEmails ?? []) {
    emailsObserved += 1;
    if (recordObservedEmail(contactId, observation)) emailEvidenceUpdated = true;
  }
  for (const observation of data.employmentObservations ?? []) {
    experiencesUpserted += 1;
    if (recordEmploymentObservation(contactId, observation)) experienceUpdated = true;
  }
  if (emailEvidenceUpdated) fieldsUpdated.push("emailEvidence");
  if (experienceUpdated) fieldsUpdated.push("experience");
  if (emailEvidenceUpdated || experienceUpdated) {
    recalcEnrichment(contactId);
    newScore = getContactById(contactId)?.enrichmentScore ?? newScore;
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
        emailsObserved,
        experiencesUpserted,
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
    emailsObserved,
    experiencesUpserted,
  };
}
