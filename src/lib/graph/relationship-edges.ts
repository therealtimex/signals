import { getOwnerContactId } from "@/lib/db/queries/contacts";
import { upsertGraphEdge } from "@/lib/db/queries/graph";

/** Pipeline source tags for audience graph edges (surgical delete / re-sync). */
export type AudienceEdgeSource =
  | "sync:x"
  | "import:x_archive"
  | "sync:linkedin"
  | "import:linkedin_csv";

function shouldSkipEdge(ownerId: string, contactId: string): boolean {
  return ownerId === contactId;
}

/** Owner follows contact (`follows`, owner → contact). */
export function projectOwnerFollowsContact(
  contactId: string,
  source: AudienceEdgeSource,
): void {
  const ownerId = getOwnerContactId();
  if (!ownerId || shouldSkipEdge(ownerId, contactId)) return;

  upsertGraphEdge({
    srcType: "contact",
    srcId: ownerId,
    dstType: "contact",
    dstId: contactId,
    edgeType: "follows",
    scope: "shared",
    source,
  });
}

/** Contact follows owner (`follows`, contact → owner). */
export function projectContactFollowsOwner(
  contactId: string,
  source: AudienceEdgeSource,
): void {
  const ownerId = getOwnerContactId();
  if (!ownerId || shouldSkipEdge(ownerId, contactId)) return;

  upsertGraphEdge({
    srcType: "contact",
    srcId: contactId,
    dstType: "contact",
    dstId: ownerId,
    edgeType: "follows",
    scope: "shared",
    source,
  });
}

/** First-degree connection (`connected_to`, canonical min-id → max-id). */
export function projectOwnerConnectedTo(
  contactId: string,
  source: AudienceEdgeSource,
): void {
  const ownerId = getOwnerContactId();
  if (!ownerId || shouldSkipEdge(ownerId, contactId)) return;

  const [srcId, dstId] =
    ownerId < contactId ? [ownerId, contactId] : [contactId, ownerId];

  upsertGraphEdge({
    srcType: "contact",
    srcId,
    dstType: "contact",
    dstId,
    edgeType: "connected_to",
    scope: "shared",
    source,
  });
}

/** X archive follower / following flags → owner-adjacent `follows` edges. */
export function projectXArchiveRelationships(
  contactId: string,
  flags: { follower: boolean; following: boolean },
): void {
  if (flags.following) {
    projectOwnerFollowsContact(contactId, "import:x_archive");
  }
  if (flags.follower) {
    projectContactFollowsOwner(contactId, "import:x_archive");
  }
}
