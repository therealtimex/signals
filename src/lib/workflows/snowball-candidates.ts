import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { snowballCandidates } from "@/lib/db/schema";
import type { SnowballCandidate } from "@/lib/db/types";
import { readNetworkSnowballConfig } from "@/lib/workflows/network-snowball";

export type SnowballCandidateStatus = SnowballCandidate["status"];

export type SnowballCandidateStats = Record<SnowballCandidateStatus, number>;

export type SnowballCandidateView = Omit<
  SnowballCandidate,
  "failureDetails" | "failureHistory"
> & {
  failureDetails: Record<string, unknown>;
  failureHistory: SnowballCandidateFailureEvent[];
};

type SnowballCandidateFailureEvent = {
  reason: string;
  message: string;
  details: Record<string, unknown>;
  at: number;
};

type SnowballRunContext = {
  id: string;
  templateId: string | null;
  config: string | null;
};

const MAX_FAILURE_HISTORY = 20;

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseFailureHistory(value: string | null | undefined): SnowballCandidateFailureEvent[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((event): event is SnowballCandidateFailureEvent =>
      Boolean(
        event &&
        typeof event === "object" &&
        typeof event.reason === "string" &&
        typeof event.message === "string" &&
        typeof event.at === "number",
      ),
    );
  } catch {
    return [];
  }
}

export function normalizeSnowballCandidateText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSnowballCandidateProfile(rawUrl: string): {
  profileUrl: string;
  profileKey: string;
} | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
    const linkedInProfile = hostname === "linkedin.com" && /^\/in\/[^/]+\/?$/i.test(url.pathname);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (linkedInProfile) {
      const slug = pathname.split("/")[2];
      return {
        profileUrl: `https://www.linkedin.com/in/${slug}/`,
        profileKey: `linkedin.com/in/${slug.toLocaleLowerCase("en-US")}`,
      };
    }
    url.hash = "";
    url.search = "";
    url.hostname = hostname;
    url.pathname = pathname;
    return {
      profileUrl: url.toString(),
      profileKey: `${hostname}${pathname}`.toLocaleLowerCase("en-US"),
    };
  } catch {
    return null;
  }
}

export function serializeSnowballCandidate(candidate: SnowballCandidate): SnowballCandidateView {
  return {
    ...candidate,
    failureDetails: parseJsonObject(candidate.failureDetails),
    failureHistory: parseFailureHistory(candidate.failureHistory),
  };
}

export function recordSnowballCandidateFailure(input: {
  run: SnowballRunContext;
  candidateName: string;
  candidateCompany?: string | null;
  candidateTitle?: string | null;
  profileUrl: string;
  reason: string;
  message: string;
  details?: Record<string, unknown>;
  now?: number;
}): SnowballCandidateView | null {
  const profile = normalizeSnowballCandidateProfile(input.profileUrl);
  const proposedName = input.candidateName.trim();
  if (!profile || !proposedName) return null;

  const now = input.now ?? Math.floor(Date.now() / 1_000);
  const runConfig = readNetworkSnowballConfig(parseJsonObject(input.run.config));
  const details = input.details ?? {};
  const failure: SnowballCandidateFailureEvent = {
    reason: input.reason,
    message: input.message,
    details,
    at: now,
  };
  const existing = db.select().from(snowballCandidates).where(and(
    eq(snowballCandidates.workflowRunId, input.run.id),
    eq(snowballCandidates.platform, "linkedin"),
    eq(snowballCandidates.profileKey, profile.profileKey),
  )).get();

  if (existing) {
    const history = [...parseFailureHistory(existing.failureHistory), failure]
      .slice(-MAX_FAILURE_HISTORY);
    db.update(snowballCandidates).set({
      profileUrl: profile.profileUrl,
      proposedName,
      proposedNameKey: normalizeSnowballCandidateText(proposedName),
      proposedCompany: input.candidateCompany?.trim() || null,
      proposedTitle: input.candidateTitle?.trim() || null,
      failureReason: input.reason,
      failureMessage: input.message,
      failureDetails: JSON.stringify(details),
      failureHistory: JSON.stringify(history),
      attemptCount: existing.attemptCount + 1,
      lastAttemptAt: now,
      ...(existing.status === "promoted" ? {} : { status: "identity_unverified" as const }),
      updatedAt: now,
    }).where(eq(snowballCandidates.id, existing.id)).run();
    return serializeSnowballCandidate(
      db.select().from(snowballCandidates).where(eq(snowballCandidates.id, existing.id)).get()!,
    );
  }

  const id = nanoid();
  db.insert(snowballCandidates).values({
    id,
    workflowRunId: input.run.id,
    templateId: input.run.templateId,
    platform: "linkedin",
    ...profile,
    proposedName,
    proposedNameKey: normalizeSnowballCandidateText(proposedName),
    proposedCompany: input.candidateCompany?.trim() || null,
    proposedTitle: input.candidateTitle?.trim() || null,
    seedType: runConfig.seedType,
    seedValue: runConfig.seedValue || null,
    status: "identity_unverified",
    failureReason: input.reason,
    failureMessage: input.message,
    failureDetails: JSON.stringify(details),
    failureHistory: JSON.stringify([failure]),
    attemptCount: 1,
    lastAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  }).run();
  return serializeSnowballCandidate(
    db.select().from(snowballCandidates).where(eq(snowballCandidates.id, id)).get()!,
  );
}

export function listSnowballCandidates(options: {
  workflowRunId?: string;
  status?: SnowballCandidateStatus;
  failureReason?: string;
  search?: string;
  page?: number;
  pageSize?: number;
} = {}): { data: SnowballCandidateView[]; total: number } {
  const search = options.search?.trim();
  const conditions = [
    options.workflowRunId
      ? eq(snowballCandidates.workflowRunId, options.workflowRunId)
      : undefined,
    options.status ? eq(snowballCandidates.status, options.status) : undefined,
    options.failureReason
      ? eq(snowballCandidates.failureReason, options.failureReason)
      : undefined,
    search
      ? or(
          sql`instr(lower(${snowballCandidates.proposedName}), lower(${search})) > 0`,
          sql`instr(lower(coalesce(${snowballCandidates.proposedCompany}, '')), lower(${search})) > 0`,
          sql`instr(lower(coalesce(${snowballCandidates.proposedTitle}, '')), lower(${search})) > 0`,
          sql`instr(lower(coalesce(${snowballCandidates.seedValue}, '')), lower(${search})) > 0`,
        )
      : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 50;
  const total = db.select({ value: count() }).from(snowballCandidates).where(where).get()?.value ?? 0;
  const data = db.select().from(snowballCandidates)
    .where(where)
    .orderBy(desc(snowballCandidates.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()
    .map(serializeSnowballCandidate);
  return { data, total };
}

export function getSnowballCandidate(id: string): SnowballCandidateView | undefined {
  const candidate = db.select().from(snowballCandidates)
    .where(eq(snowballCandidates.id, id))
    .get();
  return candidate ? serializeSnowballCandidate(candidate) : undefined;
}

export function getSnowballCandidateStats(): SnowballCandidateStats {
  const stats: SnowballCandidateStats = {
    identity_unverified: 0,
    promoted: 0,
    dismissed: 0,
  };
  for (const row of db.select({
    status: snowballCandidates.status,
    value: count(),
  }).from(snowballCandidates).groupBy(snowballCandidates.status).all()) {
    stats[row.status] = row.value;
  }
  return stats;
}

export function listSnowballCandidateFailureReasons(): string[] {
  return db.selectDistinct({ reason: snowballCandidates.failureReason })
    .from(snowballCandidates)
    .orderBy(snowballCandidates.failureReason)
    .all()
    .map(({ reason }) => reason);
}

export class SnowballCandidateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnowballCandidateTransitionError";
  }
}

export function updateSnowballCandidateReviewStatus(
  id: string,
  status: Extract<SnowballCandidateStatus, "identity_unverified" | "dismissed">,
  now = Math.floor(Date.now() / 1_000),
): SnowballCandidateView | undefined {
  const candidate = db.select().from(snowballCandidates)
    .where(eq(snowballCandidates.id, id))
    .get();
  if (!candidate) return undefined;
  if (candidate.status === "promoted") {
    throw new SnowballCandidateTransitionError(
      "Promoted candidates are canonical CRM records and cannot be dismissed from quarantine.",
    );
  }
  db.update(snowballCandidates).set({ status, updatedAt: now })
    .where(eq(snowballCandidates.id, id))
    .run();
  return getSnowballCandidate(id);
}

export function summarizeSnowballCandidates(workflowRunId: string): {
  total: number;
  awaitingVerification: number;
  promoted: number;
  dismissed: number;
} {
  const candidates = listSnowballCandidates({ workflowRunId, pageSize: 500 }).data;
  return {
    total: candidates.length,
    awaitingVerification: candidates.filter((candidate) =>
      candidate.status === "identity_unverified"
    ).length,
    promoted: candidates.filter((candidate) => candidate.status === "promoted").length,
    dismissed: candidates.filter((candidate) => candidate.status === "dismissed").length,
  };
}

export function markMatchingSnowballCandidatesPromoted(input: {
  profileUrl: string;
  candidateName: string;
  candidateCompany?: string | null;
  candidateTitle?: string | null;
  contactId: string;
  identityId: string;
  orgId?: string | null;
  now?: number;
}): string[] {
  const profile = normalizeSnowballCandidateProfile(input.profileUrl);
  if (!profile) return [];
  const nameKey = normalizeSnowballCandidateText(input.candidateName);
  const companyKey = normalizeSnowballCandidateText(input.candidateCompany ?? "");
  const titleKey = normalizeSnowballCandidateText(input.candidateTitle ?? "");
  const matches = db.select().from(snowballCandidates).where(and(
    eq(snowballCandidates.platform, "linkedin"),
    eq(snowballCandidates.profileKey, profile.profileKey),
    eq(snowballCandidates.proposedNameKey, nameKey),
    eq(snowballCandidates.status, "identity_unverified"),
  )).all().filter((candidate) => {
    const candidateCompanyKey = normalizeSnowballCandidateText(candidate.proposedCompany ?? "");
    const candidateTitleKey = normalizeSnowballCandidateText(candidate.proposedTitle ?? "");
    return (!candidateCompanyKey || candidateCompanyKey === companyKey) &&
      (!candidateTitleKey || candidateTitleKey === titleKey);
  });
  if (matches.length === 0) return [];
  const now = input.now ?? Math.floor(Date.now() / 1_000);
  for (const candidate of matches) {
    db.update(snowballCandidates).set({
      status: "promoted",
      promotedContactId: input.contactId,
      promotedIdentityId: input.identityId,
      promotedOrgId: input.orgId ?? null,
      promotedAt: now,
      updatedAt: now,
    }).where(eq(snowballCandidates.id, candidate.id)).run();
  }
  return matches.map((candidate) => candidate.id);
}
