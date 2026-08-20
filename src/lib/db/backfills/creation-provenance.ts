import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactChannels,
  contactEmployments,
  contactIdentities,
  contacts,
  graphEdges,
  orgs,
  workflowRuns,
  workflowSteps,
} from "@/lib/db/schema";
import {
  CREATION_TAGS,
  createdSourceFromTag,
  isCreationTag,
  type CreatedSource,
  type CreationTag,
} from "@/lib/db/creation-sources";
import type { Contact, Org, WorkflowRun } from "@/lib/db/types";

const BIRTH_WINDOW_SEC = 60;

type BirthWrite = {
  createdSource: CreatedSource;
  createdSourceDetail: CreationTag;
  createdWorkflowRunId: string | null;
  createdTemplateId: string | null;
};

export type CreationProvenanceBackfillResult = {
  byRule: Record<string, number>;
  skipped: number;
};

function contactsMissingProvenance(): Contact[] {
  return db.select().from(contacts).where(isNull(contacts.createdSource)).all();
}

function orgsMissingProvenance(): Org[] {
  return db.select().from(orgs).where(isNull(orgs.createdSource)).all();
}

function stampContact(contactId: string, birth: BirthWrite): void {
  db.update(contacts)
    .set({
      createdSource: birth.createdSource,
      createdSourceDetail: birth.createdSourceDetail,
      createdWorkflowRunId: birth.createdWorkflowRunId,
      createdTemplateId: birth.createdTemplateId,
    })
    .where(and(eq(contacts.id, contactId), isNull(contacts.createdSource)))
    .run();
}

function stampOrg(orgId: string, birth: BirthWrite): void {
  db.update(orgs)
    .set({
      createdSource: birth.createdSource,
      createdSourceDetail: birth.createdSourceDetail,
      createdWorkflowRunId: birth.createdWorkflowRunId,
      createdTemplateId: birth.createdTemplateId,
    })
    .where(and(eq(orgs.id, orgId), isNull(orgs.createdSource)))
    .run();
}

function birthFromTag(
  tag: CreationTag,
  runId: string | null = null,
  templateId: string | null = null,
): BirthWrite {
  return {
    createdSource: createdSourceFromTag(tag),
    createdSourceDetail: tag,
    createdWorkflowRunId: runId,
    createdTemplateId: templateId,
  };
}

function parseImportSubType(run: WorkflowRun): string | null {
  try {
    const config = JSON.parse(run.config ?? "{}") as { importSubType?: string };
    return config.importSubType ?? null;
  } catch {
    return null;
  }
}

function matchImportRunId(contactCreatedAt: number, importSubType: string): string | null {
  const candidates = db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowType, "import"))
    .all()
    .filter((run) => parseImportSubType(run) === importSubType)
    .filter((run) => {
      const anchor = run.startedAt ?? run.createdAt;
      const end = (run.completedAt ?? run.startedAt ?? run.createdAt) + BIRTH_WINDOW_SEC;
      const start = anchor - BIRTH_WINDOW_SEC;
      return contactCreatedAt >= start && contactCreatedAt <= end;
    });

  return candidates.length === 1 ? candidates[0]!.id : null;
}

function childSourceNearBirth(
  contactId: string,
  contactCreatedAt: number,
  source: string | string[],
): boolean {
  const sources = Array.isArray(source) ? source : [source];
  const windowStart = contactCreatedAt - BIRTH_WINDOW_SEC;
  const windowEnd = contactCreatedAt + BIRTH_WINDOW_SEC;

  const channelHit = db
    .select({ id: contactChannels.id })
    .from(contactChannels)
    .where(
      and(
        eq(contactChannels.contactId, contactId),
        inArray(contactChannels.source, sources),
        sql`${contactChannels.createdAt} BETWEEN ${windowStart} AND ${windowEnd}`,
      ),
    )
    .get();

  if (channelHit) return true;

  return Boolean(
    db
      .select({ id: contactEmployments.id })
      .from(contactEmployments)
      .where(
        and(
          eq(contactEmployments.contactId, contactId),
          inArray(contactEmployments.source, sources),
          sql`${contactEmployments.createdAt} BETWEEN ${windowStart} AND ${windowEnd}`,
        ),
      )
      .get(),
  );
}

function earliestChildSourceNearBirth(
  contactId: string,
  contactCreatedAt: number,
): string | null {
  const windowStart = contactCreatedAt - BIRTH_WINDOW_SEC;
  const windowEnd = contactCreatedAt + BIRTH_WINDOW_SEC;

  const channel = db
    .select({ source: contactChannels.source, createdAt: contactChannels.createdAt })
    .from(contactChannels)
    .where(
      and(
        eq(contactChannels.contactId, contactId),
        sql`${contactChannels.createdAt} BETWEEN ${windowStart} AND ${windowEnd}`,
      ),
    )
    .orderBy(contactChannels.createdAt)
    .get();

  const employment = db
    .select({ source: contactEmployments.source, createdAt: contactEmployments.createdAt })
    .from(contactEmployments)
    .where(
      and(
        eq(contactEmployments.contactId, contactId),
        sql`${contactEmployments.createdAt} BETWEEN ${windowStart} AND ${windowEnd}`,
      ),
    )
    .orderBy(contactEmployments.createdAt)
    .get();

  const candidates = [channel, employment].filter(
    (row): row is { source: string; createdAt: number } => Boolean(row),
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.createdAt - b.createdAt);
  return candidates[0]!.source;
}

function hasArchiveImportEdge(contactId: string): boolean {
  return Boolean(
    db
      .select({ id: graphEdges.id })
      .from(graphEdges)
      .where(
        and(
          inArray(graphEdges.edgeType, ["follows", "followed_by"]),
          eq(graphEdges.source, "import:x_archive"),
          or(
            and(eq(graphEdges.srcType, "contact"), eq(graphEdges.srcId, contactId)),
            and(eq(graphEdges.dstType, "contact"), eq(graphEdges.dstId, contactId)),
          ),
        ),
      )
      .get(),
  );
}

function syncEdgeNearBirth(
  contactId: string,
  contactCreatedAt: number,
): BirthWrite | null {
  const windowStart = contactCreatedAt - BIRTH_WINDOW_SEC;
  const windowEnd = contactCreatedAt + BIRTH_WINDOW_SEC;

  const xEdge = db
    .select({ id: graphEdges.id })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "follows"),
        eq(graphEdges.source, "sync:x"),
        or(
          and(eq(graphEdges.srcType, "contact"), eq(graphEdges.srcId, contactId)),
          and(eq(graphEdges.dstType, "contact"), eq(graphEdges.dstId, contactId)),
        ),
        sql`${graphEdges.firstSeenAt} BETWEEN ${windowStart} AND ${windowEnd}`,
      ),
    )
    .get();
  if (xEdge) return birthFromTag("sync:x_contacts");

  const linkedInEdge = db
    .select({ id: graphEdges.id })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "connected_to"),
        eq(graphEdges.source, "sync:linkedin"),
        or(
          and(eq(graphEdges.srcType, "contact"), eq(graphEdges.srcId, contactId)),
          and(eq(graphEdges.dstType, "contact"), eq(graphEdges.dstId, contactId)),
        ),
        sql`${graphEdges.firstSeenAt} BETWEEN ${windowStart} AND ${windowEnd}`,
      ),
    )
    .get();
  if (linkedInEdge) return birthFromTag("sync:linkedin_contacts");

  return null;
}

function applyContactRule(
  ruleId: string,
  matcher: (contact: Contact) => BirthWrite | null,
  byRule: Record<string, number>,
): void {
  let applied = 0;
  for (const contact of contactsMissingProvenance()) {
    const birth = matcher(contact);
    if (!birth) continue;
    stampContact(contact.id, birth);
    applied++;
  }
  if (applied > 0) {
    byRule[ruleId] = applied;
  }
}

function applyOrgRule(
  ruleId: string,
  matcher: (org: Org) => BirthWrite | null,
  byRule: Record<string, number>,
): void {
  let applied = 0;
  for (const org of orgsMissingProvenance()) {
    const birth = matcher(org);
    if (!birth) continue;
    stampOrg(org.id, birth);
    applied++;
  }
  if (applied > 0) {
    byRule[ruleId] = applied;
  }
}

/** Idempotent backfill for contact/org birth provenance (rules C1–C8, O1–O5). */
export function backfillCreationProvenance(): CreationProvenanceBackfillResult {
  const byRule: Record<string, number> = {};
  const initialContactSkips = contactsMissingProvenance().length;
  const initialOrgSkips = orgsMissingProvenance().length;

  applyContactRule("C1", (contact) => {
    const step = db
      .select({
        workflowRunId: workflowSteps.workflowRunId,
      })
      .from(workflowSteps)
      .where(
        and(
          eq(workflowSteps.contactId, contact.id),
          eq(workflowSteps.stepType, "contact_create"),
        ),
      )
      .get();
    if (!step) return null;

    const run = db
      .select({ templateId: workflowRuns.templateId })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, step.workflowRunId))
      .get();

    return birthFromTag(
      "agent:create_contact",
      step.workflowRunId,
      run?.templateId ?? null,
    );
  }, byRule);

  applyContactRule("C2", (contact) => {
    const identity = db
      .select({ id: contactIdentities.id })
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.contactId, contact.id),
          eq(contactIdentities.platform, "x"),
          sql`json_extract(${contactIdentities.platformData}, '$.source') = 'x_archive_import'`,
        ),
      )
      .get();
    if (!identity) return null;
    return birthFromTag(
      "import:x_archive",
      matchImportRunId(contact.createdAt, "x_archive_contacts"),
    );
  }, byRule);

  applyContactRule("C3", (contact) => {
    if (!hasArchiveImportEdge(contact.id)) return null;
    return birthFromTag(
      "import:x_archive",
      matchImportRunId(contact.createdAt, "x_archive_contacts"),
    );
  }, byRule);

  applyContactRule("C4", (contact) => {
    const linkedInIdentity = db
      .select({ id: contactIdentities.id })
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.contactId, contact.id),
          eq(contactIdentities.platform, "linkedin"),
          sql`json_extract(${contactIdentities.platformData}, '$.source') = 'csv_import'`,
        ),
      )
      .get();
    const childHit = childSourceNearBirth(contact.id, contact.createdAt, "import:linkedin_csv");
    if (!linkedInIdentity && !childHit) return null;
    return birthFromTag(
      "import:linkedin_csv",
      matchImportRunId(contact.createdAt, "linkedin_connections"),
    );
  }, byRule);

  applyContactRule("C5", (contact) => {
    if (!childSourceNearBirth(contact.id, contact.createdAt, "import:gmail_takeout")) {
      return null;
    }
    return birthFromTag(
      "import:gmail_takeout",
      matchImportRunId(contact.createdAt, "gmail_takeout_contacts"),
    );
  }, byRule);

  applyContactRule("C6", (contact) => {
    const earliest = earliestChildSourceNearBirth(contact.id, contact.createdAt);
    if (earliest !== "agent:create_contact") return null;
    return birthFromTag("agent:create_contact");
  }, byRule);

  applyContactRule("C7", (contact) => {
    const sources: CreationTag[] = ["sync:gmail_contacts", "sync:himalaya_correspondents"];
    for (const tag of sources) {
      if (childSourceNearBirth(contact.id, contact.createdAt, tag)) {
        return birthFromTag(tag);
      }
    }
    return null;
  }, byRule);

  applyContactRule("C8", (contact) => syncEdgeNearBirth(contact.id, contact.createdAt), byRule);

  applyOrgRule("O1", (org) => {
    if (!org.source || !isCreationTag(org.source)) return null;
    return birthFromTag(org.source);
  }, byRule);

  applyOrgRule("O2", (org) => {
    if (org.source !== "ui") return null;
    return birthFromTag("manual:create_org");
  }, byRule);

  applyOrgRule("O3", (org) => {
    if (org.source !== "agent") return null;
    return birthFromTag("agent:create_contact");
  }, byRule);

  applyOrgRule("O4", (org) => {
    if (org.source !== "email_domain") return null;
    return birthFromTag("sync:himalaya_correspondents");
  }, byRule);

  const remainingContacts = contactsMissingProvenance().length;
  const remainingOrgs = orgsMissingProvenance().length;
  const skipped = remainingContacts + remainingOrgs;

  if (Object.keys(byRule).length > 0 || skipped > 0) {
    const tagged = Object.values(byRule).reduce((sum, count) => sum + count, 0);
    console.log(
      `[creation-provenance backfill] tagged=${tagged} skipped=${skipped} (contacts ${initialContactSkips}→${remainingContacts}, orgs ${initialOrgSkips}→${remainingOrgs})`,
      byRule,
    );
  }

  return { byRule, skipped };
}

export { CREATION_TAGS };
