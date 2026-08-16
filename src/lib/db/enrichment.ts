import type { Contact, ContactChannel, ContactIdentity } from "./types";
import type { ContactEmploymentWithOrg } from "@/lib/db/queries/contact-employments";

/**
 * Calculates an enrichment score (0-100) based on how complete
 * a contact's profile data is across all identity sources.
 */
export function calculateEnrichmentScore(
  contact: Contact,
  identities: ContactIdentity[],
  channels: ContactChannel[] = [],
  currentEmployment?: ContactEmploymentWithOrg | null,
): number {
  let score = 0;

  // firstName + lastName present: 10 points
  if (contact.firstName && contact.lastName) {
    score += 10;
  }

  const emailChannels = channels.filter((c) => c.channelType === "email");
  const hasVerifiedEmail = emailChannels.some((c) => c.isVerified);
  const hasEmail = emailChannels.length > 0;
  if (hasEmail) {
    score += hasVerifiedEmail ? 15 : 10;
  }

  const hasPhone = channels.some((c) => c.channelType === "phone");
  if (hasPhone) {
    score += 10;
  }

  // Headline: 5 points
  if (contact.headline) {
    score += 5;
  }

  // Company: 5 points
  const company = currentEmployment?.orgName ?? contact.company;
  if (company) {
    score += 5;
  }

  // Title: 5 points
  const title = currentEmployment?.title ?? contact.title;
  if (title) {
    score += 5;
  }

  // Location: 5 points
  if (contact.location) {
    score += 5;
  }

  // Bio: 5 points
  if (contact.bio) {
    score += 5;
  }

  // Photo (photoUrl or legacy avatarUrl): 5 points
  if (contact.photoUrl || contact.avatarUrl) {
    score += 5;
  }

  // Website: 5 points
  if (contact.website) {
    score += 5;
  }

  // Active identities scoring
  const activeIdentities = identities.filter((i) => i.isActive);
  if (activeIdentities.length >= 2) {
    score += 10;
  }
  if (activeIdentities.length >= 3) {
    score += 5;
  }

  // Rich platformData (>3 fields in any identity): 10 points
  const hasRichData = identities.some((i) => {
    try {
      const data = typeof i.platformData === "string" ? JSON.parse(i.platformData) : i.platformData;
      return data && typeof data === "object" && Object.keys(data).length > 3;
    } catch {
      return false;
    }
  });
  if (hasRichData) {
    score += 10;
  }

  // Platform handles: up to 5 points (1 per handle with a max of 5)
  const handleCount = identities.filter((i) => i.platformHandle).length;
  score += Math.min(handleCount, 5);

  return Math.min(score, 100);
}
