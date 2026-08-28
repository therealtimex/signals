import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactChannels, contactEmailCandidates } from "@/lib/db/schema";
import { resolveEmailVerificationSettings } from "@/lib/settings/email-verification-settings";
import { selectActiveEmailCandidate } from "@/lib/contacts/email-verification/active-candidate";

export type CandidateEmailEligibility = { sendable: boolean; reason?: string };

export function resolveCandidateEmailEligibility(
  status: "predicted" | "uncertain" | "verified" | "invalid",
  options: { includePredicted?: boolean; allowPredicted?: boolean } = {},
): CandidateEmailEligibility {
  if (status === "verified") return { sendable: true };
  if (status === "predicted") {
    if (!options.allowPredicted) return { sendable: false, reason: "predicted_email_disabled" };
    if (!options.includePredicted) return { sendable: false, reason: "predicted_email_not_requested" };
    return { sendable: true };
  }
  return { sendable: false, reason: status === "invalid" ? "invalid_email" : "email_not_verified" };
}

export function resolveAutomationEmail(
  contactId: string,
  options?: { includePredicted?: boolean },
): { address: string | null; status: string; eligible: boolean; reason?: string } {
  const channels = db.select().from(contactChannels).where(
    and(eq(contactChannels.contactId, contactId), eq(contactChannels.channelType, "email")),
  ).all();
  const verified = channels.find((channel) => channel.isVerified);
  if (verified) return { address: verified.value, status: "verified", eligible: true };
  if (channels[0]) return { address: channels[0].value, status: "unverified", eligible: true };
  const candidate = selectActiveEmailCandidate(
    db.select().from(contactEmailCandidates).where(eq(contactEmailCandidates.contactId, contactId)).all(),
  );
  if (!candidate) return { address: null, status: "none", eligible: false, reason: "no_email" };
  const decision = resolveCandidateEmailEligibility(candidate.status, {
    includePredicted: options?.includePredicted,
    allowPredicted: resolveEmailVerificationSettings().allowPredictedInAutomation.effectiveValue,
  });
  return {
    address: candidate.address,
    status: candidate.status,
    eligible: decision.sendable,
    ...(decision.reason ? { reason: decision.reason } : {}),
  };
}
