import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactChannels, contactEmailCandidates } from "@/lib/db/schema";
import { resolveEmailVerificationSettings } from "@/lib/settings/email-verification-settings";

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
  const candidate = db.select().from(contactEmailCandidates).where(eq(contactEmailCandidates.contactId, contactId)).get();
  if (!candidate) return { address: null, status: "none", eligible: false, reason: "no_email" };
  const enabled = resolveEmailVerificationSettings().allowPredictedInAutomation.effectiveValue;
  const eligible = candidate.status === "predicted" && options?.includePredicted === true && enabled;
  return {
    address: candidate.address,
    status: candidate.status,
    eligible,
    ...(!eligible ? { reason: "predicted_email_disabled" } : {}),
  };
}
