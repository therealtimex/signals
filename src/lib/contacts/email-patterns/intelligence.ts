import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  contactChannels,
  contactEmailCandidates,
  contactEmployments,
  orgDomains,
  orgEmailPatterns,
} from "@/lib/db/schema";
import { getContactsByIds } from "@/lib/db/queries/contacts";
import { getOrgById } from "@/lib/db/queries/orgs";
import { logOrgActivity } from "@/lib/db/queries/org-activities";
import { normalizeChannelValue } from "@/lib/db/channel-types";
import { deriveNameParts } from "./name-parts";
import { EMAIL_PATTERNS, isValidEmailPattern, matchPattern, renderPattern } from "./patterns";

const ROLE_ACCOUNTS = new Set([
  "admin", "billing", "contact", "hello", "hr", "info", "jobs", "sales", "support", "team",
]);

function emailDomain(address: string): string {
  return address.toLowerCase().split("@").at(-1) ?? "";
}

function emailLocal(address: string): string {
  return address.toLowerCase().split("@")[0] ?? "";
}

function confidence(matchCount: number, score: number): "high" | "medium" | "low" {
  if (matchCount >= 3 && score >= 0.6) return "high";
  if (matchCount >= 2 && score >= 0.4) return "medium";
  return "low";
}

function orgDomainRows(orgId: string) {
  const org = getOrgById(orgId);
  const rows = db.select().from(orgDomains).where(eq(orgDomains.orgId, orgId)).all();
  if (rows.length || !org?.domain) return rows;
  return [{
    id: "legacy",
    orgId,
    domain: org.domain,
    kind: "primary" as const,
    source: "legacy",
    mxStatus: "unknown" as const,
    catchAll: "unknown" as const,
    mailCheckedAt: null,
    mailEvidence: "{}",
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  }];
}

export function inferOrgEmailPatterns(orgId: string) {
  const org = getOrgById(orgId);
  if (!org?.domain) return { canInfer: false as const, reason: "missing_domain" as const, patterns: [] };
  const domains = new Set(orgDomainRows(orgId).map((row) => row.domain));
  const employments = db.select().from(contactEmployments).where(eq(contactEmployments.orgId, orgId)).all();
  const ids = [...new Set(employments.map((row) => row.contactId))];
  const contacts = getContactsByIds(ids);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const channels = ids.length
    ? db.select().from(contactChannels).where(and(inArray(contactChannels.contactId, ids), eq(contactChannels.channelType, "email"))).all()
    : [];
  const evidence = channels.filter((channel) => {
    const local = emailLocal(channel.valueNormalized);
    return (
      domains.has(emailDomain(channel.valueNormalized)) &&
      !ROLE_ACCOUNTS.has(local) &&
      (channel.isVerified || channel.source.startsWith("sync:") || channel.source.startsWith("import:"))
    );
  });

  const counts = new Map<string, { matchCount: number; evidence: { contactId: string; address: string }[] }>();
  for (const pattern of EMAIL_PATTERNS) counts.set(pattern, { matchCount: 0, evidence: [] });
  for (const channel of evidence) {
    const contact = contactById.get(channel.contactId);
    if (!contact) continue;
    const parts = deriveNameParts(contact);
    if (!parts.ok) continue;
    for (const pattern of matchPattern(emailLocal(channel.valueNormalized), parts)) {
      const row = counts.get(pattern)!;
      row.matchCount++;
      row.evidence.push({ contactId: contact.id, address: channel.valueNormalized });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const ranked = EMAIL_PATTERNS.map((pattern, order) => {
    const row = counts.get(pattern)!;
    const score = evidence.length ? row.matchCount / evidence.length : 0;
    return { pattern, order, matchCount: row.matchCount, sampleCount: evidence.length, score, evidence: row.evidence };
  })
    .filter((row) => row.matchCount > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const override = db.select().from(orgEmailPatterns).where(
    and(eq(orgEmailPatterns.orgId, orgId), eq(orgEmailPatterns.isSelected, true)),
  ).all().find((row) => row.source !== "inferred");

  db.transaction((tx) => {
    tx.delete(orgEmailPatterns).where(
      and(eq(orgEmailPatterns.orgId, orgId), eq(orgEmailPatterns.source, "inferred")),
    ).run();
    ranked.forEach((row, index) => {
      tx.insert(orgEmailPatterns).values({
        id: nanoid(),
        orgId,
        pattern: row.pattern,
        rank: index + 1,
        confidence: confidence(row.matchCount, row.score),
        score: row.score,
        matchCount: row.matchCount,
        sampleCount: row.sampleCount,
        evidence: JSON.stringify(row.evidence),
        isSelected: !override && index === 0,
        source: "inferred",
        evaluatedAt: now,
      }).run();
    });
  });

  logOrgActivity({
    orgId,
    activityType: "email_pattern_inferred",
    title: ranked.length ? "Company email pattern inferred" : "Email pattern inference completed",
    summary: ranked[0]
      ? `${ranked[0].pattern} matched ${ranked[0].matchCount} of ${ranked[0].sampleCount} samples.`
      : "No usable company email samples were found.",
    source: "agent:infer_org_email_pattern",
    dedupeKey: `email_pattern_inferred:${orgId}:${now}:${ranked[0]?.pattern ?? "none"}`,
  });

  return {
    canInfer: true as const,
    patterns: db.select().from(orgEmailPatterns).where(eq(orgEmailPatterns.orgId, orgId)).all(),
    ...(evidence.length === 0 ? { reason: "no_samples" as const } : {}),
  };
}

export function setOrgEmailPattern(
  orgId: string,
  input: { pattern?: string; clear?: boolean; source?: string; evidenceUrl?: string },
) {
  if (!getOrgById(orgId)) return undefined;
  if (input.clear) {
    const overrides = db.select().from(orgEmailPatterns).where(eq(orgEmailPatterns.orgId, orgId)).all()
      .filter((row) => row.source !== "inferred");
    for (const override of overrides) {
      db.delete(orgEmailPatterns).where(eq(orgEmailPatterns.id, override.id)).run();
    }
    const inferred = db.select().from(orgEmailPatterns).where(eq(orgEmailPatterns.orgId, orgId)).all()
      .filter((row) => row.source === "inferred")
      .sort((a, b) => a.rank - b.rank)[0];
    if (inferred) {
      db.update(orgEmailPatterns).set({ isSelected: true }).where(eq(orgEmailPatterns.id, inferred.id)).run();
    }
    return getOrgEmailIntelligence(orgId);
  }
  if (!input.pattern || !isValidEmailPattern(input.pattern)) {
    throw new Error("Invalid email pattern");
  }
  const now = Math.floor(Date.now() / 1000);
  const source = input.source ?? "manual:override";
  db.transaction((tx) => {
    tx.update(orgEmailPatterns).set({ isSelected: false }).where(eq(orgEmailPatterns.orgId, orgId)).run();
    const existing = tx.select().from(orgEmailPatterns).where(
      and(eq(orgEmailPatterns.orgId, orgId), eq(orgEmailPatterns.pattern, input.pattern!)),
    ).get();
    const evidence = input.evidenceUrl ? JSON.stringify({ evidenceUrl: input.evidenceUrl }) : undefined;
    if (existing) {
      tx.update(orgEmailPatterns).set({
        isSelected: true,
        source,
        ...(evidence ? { evidence } : {}),
        evaluatedAt: now,
        updatedAt: now,
      }).where(eq(orgEmailPatterns.id, existing.id)).run();
    } else {
      tx.insert(orgEmailPatterns).values({
        id: nanoid(), orgId, pattern: input.pattern!, rank: 1, confidence: "low", score: 0,
        isSelected: true, source, evidence: evidence ?? "[]", evaluatedAt: now,
      }).run();
    }
  });
  return getOrgEmailIntelligence(orgId);
}

function downgrade(value: "high" | "medium" | "low") {
  return value === "high" ? "medium" : "low";
}

export function generateOrgEmailCandidates(orgId: string, options?: { contactIds?: string[] }) {
  const org = getOrgById(orgId);
  if (!org?.domain) return { created: 0, updated: 0, skipped: [{ contactId: "", reason: "missing_domain" }] };
  const selected = db.select().from(orgEmailPatterns).where(
    and(eq(orgEmailPatterns.orgId, orgId), eq(orgEmailPatterns.isSelected, true)),
  ).get();
  const employments = db.select().from(contactEmployments).where(
    and(eq(contactEmployments.orgId, orgId), eq(contactEmployments.isCurrent, true)),
  ).all().filter((row) => !options?.contactIds || options.contactIds.includes(row.contactId));
  const contacts = getContactsByIds([...new Set(employments.map((row) => row.contactId))]);
  const domains = new Set(orgDomainRows(orgId).map((row) => row.domain));
  let created = 0;
  let updated = 0;
  const skipped: { contactId: string; reason: string }[] = [];

  for (const contact of contacts) {
    const channels = contact.channels.filter((channel) => channel.channelType === "email");
    if (channels.some((channel) => channel.isVerified && domains.has(emailDomain(channel.valueNormalized)))) {
      skipped.push({ contactId: contact.id, reason: "verified_email_exists" });
      continue;
    }
    const parts = deriveNameParts(contact);
    if (!parts.ok) {
      skipped.push({ contactId: contact.id, reason: `name_unusable:${parts.reason}` });
      continue;
    }
    if (!selected) {
      skipped.push({ contactId: contact.id, reason: "no_pattern" });
      continue;
    }
    if (parts.firstIsInitial && selected.pattern.includes("{first}")) {
      skipped.push({ contactId: contact.id, reason: "name_unusable:first_initial" });
      continue;
    }
    const address = `${renderPattern(selected.pattern, parts)}@${org.domain}`;
    const normalized = normalizeChannelValue("email", address);
    if (channels.some((channel) => channel.valueNormalized === normalized)) {
      skipped.push({ contactId: contact.id, reason: "already_on_record" });
      continue;
    }
    const confidenceValue = parts.firstIsInitial || parts.particlesJoined || parts.ambiguous.length
      ? downgrade(selected.confidence)
      : selected.confidence;
    const evidence = JSON.stringify({
      pattern: selected.pattern,
      parts,
      patternConfidence: selected.confidence,
      sampleCount: selected.sampleCount,
      generatedAt: Math.floor(Date.now() / 1000),
    });
    const existing = db.select().from(contactEmailCandidates).where(
      and(eq(contactEmailCandidates.contactId, contact.id), eq(contactEmailCandidates.addressNormalized, normalized)),
    ).get();
    if (!existing) {
      db.insert(contactEmailCandidates).values({
        id: nanoid(), contactId: contact.id, orgId, address, addressNormalized: normalized,
        pattern: selected.pattern, confidence: confidenceValue, evidence,
        source: "enrich:email_pattern",
      }).run();
      created++;
    } else if (existing.status === "predicted") {
      db.update(contactEmailCandidates).set({
        pattern: selected.pattern,
        confidence: confidenceValue,
        evidence,
        updatedAt: Math.floor(Date.now() / 1000),
      }).where(eq(contactEmailCandidates.id, existing.id)).run();
      updated++;
    }
  }
  return { created, updated, skipped };
}

export function getOrgEmailIntelligence(orgId: string) {
  const org = getOrgById(orgId);
  const domains = orgDomainRows(orgId);
  const patterns = db.select().from(orgEmailPatterns).where(eq(orgEmailPatterns.orgId, orgId)).all();
  const candidates = db.select().from(contactEmailCandidates).where(eq(contactEmailCandidates.orgId, orgId)).all();
  const candidateCounts = { predicted: 0, uncertain: 0, verified: 0, invalid: 0 };
  for (const candidate of candidates) candidateCounts[candidate.status]++;
  return {
    canInfer: Boolean(org?.domain),
    ...(!org?.domain ? { reason: "missing_domain" as const } : {}),
    domain: org?.domain ?? null,
    domains,
    patterns,
    selected: patterns.find((pattern) => pattern.isSelected) ?? null,
    candidateCounts,
    evaluatedAt: patterns.length ? Math.max(...patterns.map((pattern) => pattern.evaluatedAt)) : null,
  };
}
