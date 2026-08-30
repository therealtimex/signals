import type { ArppPersonDocument } from "@/lib/arpp/types";
import type { ContactWithIdentities } from "@/lib/db/types";

export function shouldRunWebResearch(
  contact: ContactWithIdentities,
  arpp?: ArppPersonDocument,
): boolean {
  const activeIdentities = contact.identities.filter((identity) => identity.isActive);
  if (activeIdentities.length === 0 || contact.enrichmentScore < 40) return true;

  const hasSameAs = arpp
    ? arpp.sameAs.length > 0
    : Boolean(
        contact.profileUrl ||
          contact.website ||
          activeIdentities.some((identity) => identity.platformUrl || identity.websiteUrl),
      );
  return !hasSameAs;
}
