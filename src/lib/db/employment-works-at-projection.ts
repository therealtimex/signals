import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { graphEdges } from "@/lib/db/schema";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import {
  listContactEmployments,
  type ContactEmploymentWithOrg,
} from "@/lib/db/queries/contact-employments";
import type { ContactEmployment } from "@/lib/db/types";

function pickLatestStint(stints: ContactEmployment[]): ContactEmployment | undefined {
  if (stints.length === 0) return undefined;
  return [...stints].sort((a, b) => {
    const aStart = a.startedAt ?? -1;
    const bStart = b.startedAt ?? -1;
    if (bStart !== aStart) return bStart - aStart;
    return b.createdAt - a.createdAt;
  })[0];
}

function aggregateOrgEdgeProperties(stints: ContactEmployment[]) {
  const isCurrent = stints.some((stint) => stint.isCurrent);
  const currentStints = stints.filter((stint) => stint.isCurrent);
  const titleSource =
    currentStints.length > 0 ? pickLatestStint(currentStints) : pickLatestStint(stints);
  const startDates = stints
    .map((stint) => stint.startedAt)
    .filter((value): value is number => value != null);
  const startDate = startDates.length > 0 ? Math.min(...startDates) : null;

  return {
    title: titleSource?.title ?? null,
    is_current: isCurrent,
    start_date: startDate,
  };
}

function resolveEdgeScope(stints: ContactEmployment[]): "shared" | "local_only" {
  return stints.some((stint) => stint.scope === "shared") ? "shared" : "local_only";
}

function stintsForEdgeScope(
  stints: ContactEmployment[],
  scope: "shared" | "local_only",
): ContactEmployment[] {
  return stints.filter((stint) => stint.scope === scope);
}

/** Project `works_at` edges from employment rows — employments are the source of truth (ADR-092-2). */
export function projectWorksAtFromEmployments(
  contactId: string,
  source = "projection:employments",
): void {
  const employments = listContactEmployments(contactId);
  const byOrg = new Map<string, ContactEmployment[]>();

  for (const employment of employments) {
    const list = byOrg.get(employment.orgId) ?? [];
    list.push(employment);
    byOrg.set(employment.orgId, list);
  }

  const existingEdges = db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.edgeType, "works_at"),
      ),
    )
    .all();

  const activeOrgIds = new Set(byOrg.keys());

  for (const edge of existingEdges) {
    if (!activeOrgIds.has(edge.dstId)) {
      db.delete(graphEdges).where(eq(graphEdges.id, edge.id)).run();
    }
  }

  for (const [orgId, allStints] of byOrg) {
    const scope = resolveEdgeScope(allStints);
    const scopedStints = stintsForEdgeScope(allStints, scope);
    const properties = aggregateOrgEdgeProperties(scopedStints);
    upsertGraphEdge({
      srcType: "contact",
      srcId: contactId,
      dstType: "org",
      dstId: orgId,
      edgeType: "works_at",
      properties: JSON.stringify(properties),
      scope,
      source,
    });
  }
}

/** Convenience for DTO assembly — not used for writes. */
export type ResolvedCurrentEmployment = Pick<
  ContactEmploymentWithOrg,
  "orgId" | "orgName" | "title"
>;
