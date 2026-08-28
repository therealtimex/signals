import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contactChannels, contactEmailCandidates, orgDomains } from "@/lib/db/schema";
import { normalizeChannelValue } from "@/lib/db/channel-types";
import { ensureContactChannel } from "@/lib/db/queries/contact-channel-writes";
import { updateContactChannel } from "@/lib/db/queries/contact-channels";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import { logOrgActivity } from "@/lib/db/queries/org-activities";
import { transitionCandidate, type CandidateEvent } from "./transitions";
import { resolveEmailVerificationSettings } from "@/lib/settings/email-verification-settings";
import { resolveCandidateEmailEligibility } from "@/lib/contacts/email-eligibility";
import { checkOrgMailDomains, type MxResolver } from "./mail-domains";
import { smtpRcptProbe, type SmtpProbeProvider } from "./smtp-probe";

function parseEvidence(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function listContactEmailCandidates(contactId: string, options?: { includePredicted?: boolean }) {
  const allowPredicted = resolveEmailVerificationSettings().allowPredictedInAutomation.effectiveValue;
  return db.select().from(contactEmailCandidates).where(eq(contactEmailCandidates.contactId, contactId)).all()
    .map((candidate) => ({
      ...candidate,
      ...resolveCandidateEmailEligibility(candidate.status, {
        includePredicted: options?.includePredicted,
        allowPredicted,
      }),
    }));
}

export function listOrgEmailCandidates(
  orgId: string,
  options?: { status?: "predicted" | "uncertain" | "verified" | "invalid"; includePredicted?: boolean },
) {
  const allowPredicted = resolveEmailVerificationSettings().allowPredictedInAutomation.effectiveValue;
  return db.select().from(contactEmailCandidates).where(and(
    eq(contactEmailCandidates.orgId, orgId),
    options?.status ? eq(contactEmailCandidates.status, options.status) : undefined,
  )).all().map((candidate) => ({
    ...candidate,
    ...resolveCandidateEmailEligibility(candidate.status, {
      includePredicted: options?.includePredicted,
      allowPredicted,
    }),
  }));
}

export type EmailCandidateDependencies = {
  settings?: typeof resolveEmailVerificationSettings;
  mxResolver?: MxResolver;
  probe?: SmtpProbeProvider;
  catchAllAddress?: (domain: string) => string;
};

async function resolveProbeEvent(
  candidate: typeof contactEmailCandidates.$inferSelect,
  dependencies: EmailCandidateDependencies,
): Promise<{ event: CandidateEvent; catchAll: "yes" | "no" | "unknown"; detail: string }> {
  const settings = (dependencies.settings ?? resolveEmailVerificationSettings)();
  if (!settings.smtpProbeEnabled.effectiveValue) {
    return { event: "probe_inconclusive", catchAll: "unknown", detail: "smtp_probe_disabled" };
  }
  const checked = await checkOrgMailDomains(candidate.orgId, dependencies.mxResolver);
  const domain = candidate.addressNormalized.split("@").at(-1) ?? "";
  const mailDomain = checked.find((row) => row.domain === domain);
  if (!mailDomain || mailDomain.mxStatus === "none") {
    return { event: "probe_undeliverable", catchAll: "unknown", detail: "domain_has_no_mx" };
  }
  if (mailDomain.mxStatus !== "ok") {
    return { event: "probe_inconclusive", catchAll: "unknown", detail: "mx_lookup_inconclusive" };
  }
  const provider = dependencies.probe ?? smtpRcptProbe;
  const target = await provider(candidate.addressNormalized, mailDomain.records);
  if (target.outcome === "rejected") {
    return { event: "probe_undeliverable", catchAll: "unknown", detail: target.detail ?? "recipient_rejected" };
  }
  if (target.outcome === "inconclusive") {
    return { event: "probe_inconclusive", catchAll: "unknown", detail: target.detail ?? "probe_inconclusive" };
  }
  const randomAddress = dependencies.catchAllAddress?.(domain)
    ?? `signals-probe-${nanoid(12).toLowerCase()}@${domain}`;
  const catchAllProbe = await provider(randomAddress, mailDomain.records);
  const catchAll = catchAllProbe.outcome === "accepted" ? "yes"
    : catchAllProbe.outcome === "rejected" ? "no" : "unknown";
  const domainRow = db.select().from(orgDomains).where(and(
    eq(orgDomains.orgId, candidate.orgId), eq(orgDomains.domain, domain),
  )).get();
  if (domainRow) {
    const evidence = parseEvidence(domainRow.mailEvidence);
    db.update(orgDomains).set({
      catchAll,
      mailEvidence: JSON.stringify({ ...evidence, smtp: { target, catchAll: catchAllProbe } }),
      updatedAt: Math.floor(Date.now() / 1000),
    }).where(eq(orgDomains.id, domainRow.id)).run();
  }
  return {
    event: "probe_deliverable",
    catchAll,
    detail: catchAll === "yes" ? "catch_all_domain" : catchAll === "no" ? "recipient_accepted" : "catch_all_inconclusive",
  };
}

export async function updateEmailCandidate(
  candidateId: string,
  input: {
    action: "verify" | "invalidate" | "mark_uncertain" | "correct" | "probe";
    address?: string;
    evidenceUrl?: string;
    note?: string;
    actor?: "manual" | "agent";
  },
  dependencies: EmailCandidateDependencies = {},
) {
  const candidate = db.select().from(contactEmailCandidates).where(eq(contactEmailCandidates.id, candidateId)).get();
  if (!candidate) return undefined;
  const now = Math.floor(Date.now() / 1000);

  if (input.action === "correct") {
    if (!input.address?.trim()) throw new Error("A corrected address is required");
    const normalized = normalizeChannelValue("email", input.address);
    const replacementId = nanoid();
    const oldEvidence = parseEvidence(candidate.evidence);
    db.transaction((tx) => {
      tx.update(contactEmailCandidates).set({
        status: "invalid",
        evidence: JSON.stringify({ ...oldEvidence, supersededBy: replacementId }),
        updatedAt: now,
      }).where(eq(contactEmailCandidates.id, candidate.id)).run();
      tx.insert(contactEmailCandidates).values({
        id: replacementId,
        contactId: candidate.contactId,
        orgId: candidate.orgId,
        address: input.address!.trim(),
        addressNormalized: normalized,
        pattern: null,
        status: "predicted",
        confidence: candidate.confidence,
        source: "manual:correct_email",
        evidence: JSON.stringify({ correctedFrom: candidate.id, correctedAt: now }),
      }).run();
    });
    return db.select().from(contactEmailCandidates).where(eq(contactEmailCandidates.id, replacementId)).get();
  }

  const actor = input.actor ?? "manual";
  const probe = input.action === "probe" ? await resolveProbeEvent(candidate, dependencies) : null;
  const event: CandidateEvent =
    input.action === "verify"
      ? actor === "agent" ? "agent_verify" : "manual_verify"
      : input.action === "invalidate"
        ? actor === "agent" ? "agent_invalidate" : "manual_invalidate"
        : input.action === "probe"
          ? probe!.event
          : "mark_uncertain";
  const transition = transitionCandidate(candidate.status, event, { catchAll: probe?.catchAll });
  const evidence = parseEvidence(candidate.evidence);
  const history = Array.isArray(evidence.history) ? evidence.history : [];
  const nextEvidence = {
    ...evidence,
    ...(input.evidenceUrl ? { evidenceUrl: input.evidenceUrl } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(transition.reason ? { reason: transition.reason } : {}),
    history: [...history, {
      from: candidate.status,
      to: transition.status,
      event,
      method: transition.verificationMethod,
      at: now,
      detail: input.note ?? probe?.detail ?? transition.reason ?? null,
    }],
  };
  let promotedChannelId = candidate.promotedChannelId;
  if (transition.status === "verified") {
    const channel = ensureContactChannel({
      contactId: candidate.contactId,
      channelType: "email",
      value: candidate.address,
      isVerified: true,
      source: "enrich:email_pattern",
      metadata: { candidateId: candidate.id },
    });
    promotedChannelId = channel.id;
    recalcContactEnrichment(candidate.contactId);
  } else if (transition.status === "invalid" && promotedChannelId) {
    const channel = db.select().from(contactChannels).where(eq(contactChannels.id, promotedChannelId)).get();
    if (channel) updateContactChannel(channel.id, { isVerified: false });
  }

  db.update(contactEmailCandidates).set({
    status: transition.status,
    verificationMethod: transition.verificationMethod,
    verifiedAt: transition.status === "verified" ? now : candidate.verifiedAt,
    checkedAt: input.action === "probe" ? now : candidate.checkedAt,
    probeAttempts: input.action === "probe" ? candidate.probeAttempts + 1 : candidate.probeAttempts,
    promotedChannelId,
    evidence: JSON.stringify(nextEvidence),
    updatedAt: now,
  }).where(eq(contactEmailCandidates.id, candidate.id)).run();
  if (transition.status === "verified") {
    logOrgActivity({
      orgId: candidate.orgId,
      contactId: candidate.contactId,
      activityType: "email_verified",
      title: "Predicted email verified",
      summary: candidate.address,
      source: `${actor}:verify_email_candidate`,
      dedupeKey: `email_verified:${candidate.id}`,
      metadata: { candidateId: candidate.id, verificationMethod: transition.verificationMethod },
    });
  }
  return db.select().from(contactEmailCandidates).where(eq(contactEmailCandidates.id, candidate.id)).get();
}
