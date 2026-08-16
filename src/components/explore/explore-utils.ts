import type { ContactExploreIdentity } from "@/lib/db/queries/contact-explore";

export function selectPrimaryIdentity(
  identities: ContactExploreIdentity[],
): ContactExploreIdentity | null {
  if (identities.length === 0) return null;
  const sorted = [...identities].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const aFollowers = a.followersCount ?? -1;
    const bFollowers = b.followersCount ?? -1;
    if (bFollowers !== aFollowers) return bFollowers - aFollowers;
    return a.createdAt - b.createdAt;
  });
  return sorted[0] ?? null;
}
