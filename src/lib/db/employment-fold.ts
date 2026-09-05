/**
 * Shared employment-collision rule for contact and org merges (ADR-445-2).
 *
 * Both merges hit the same question: two `contact_employments` rows describe one person at one
 * org — are they one job recorded twice, or two stints? `mergeContacts` answered it first; keeping
 * the rule in one place stops the two merges drifting apart.
 */

export type FoldableEmployment = {
  id: string;
  title: string | null;
  startedAt: number | null;
  endedAt: number | null;
  isCurrent: boolean;
};

export function normalizeEmploymentTitle(title: string | null | undefined): string {
  return (title ?? "").trim().toLowerCase();
}

/**
 * Two rows that both carry a start date, and disagree about it, are two stints.
 *
 * This is the only evidence the data can carry that a person left and returned, or was promoted
 * into a new row. It is deliberately strictly more conservative than the rule it guards — it can
 * only ever prevent a fold, never cause one — which is what makes it safe to apply to the existing
 * contact merge as well.
 */
function datesProveDistinctStints(a: FoldableEmployment, b: FoldableEmployment): boolean {
  return a.startedAt !== null && b.startedAt !== null && a.startedAt !== b.startedAt;
}

/**
 * The row `incoming` should fold into, or `undefined` when it is a separate stint.
 *
 * Folds on an exact title match, or when either side is blank — a blank title means "same job,
 * less detail", not a second job. Two distinct non-blank titles are two jobs.
 */
export function pickEmploymentFoldTarget<T extends FoldableEmployment>(
  incoming: T,
  candidates: T[],
): T | undefined {
  const eligible = candidates.filter((candidate) => !datesProveDistinctStints(candidate, incoming));
  if (eligible.length === 0) return undefined;

  const incomingTitle = normalizeEmploymentTitle(incoming.title);
  const exact = eligible.find(
    (candidate) => normalizeEmploymentTitle(candidate.title) === incomingTitle,
  );
  if (exact) return exact;

  if (incomingTitle === "") return eligible[0];
  return eligible.find((candidate) => normalizeEmploymentTitle(candidate.title) === "");
}

/**
 * Field-level fill for a fold: the kept row gains anything it was missing, and never loses what it
 * had. Returns an empty object when the kept row already covers the incoming one.
 */
export function employmentFoldUpdates(
  target: FoldableEmployment,
  incoming: FoldableEmployment,
): Partial<Pick<FoldableEmployment, "title" | "startedAt" | "endedAt" | "isCurrent">> {
  const updates: Partial<Pick<FoldableEmployment, "title" | "startedAt" | "endedAt" | "isCurrent">> = {};
  if (!target.title && incoming.title) updates.title = incoming.title;
  if (target.startedAt === null && incoming.startedAt !== null) updates.startedAt = incoming.startedAt;
  if (target.endedAt === null && incoming.endedAt !== null) updates.endedAt = incoming.endedAt;
  if (!target.isCurrent && incoming.isCurrent) updates.isCurrent = true;
  return updates;
}
