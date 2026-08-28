import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contactEmployments, contacts, interactions, orgActivities, orgs } from "@/lib/db/schema";
import { assertOrgActivityType, orgActivityCategory, type OrgActivityCategory } from "@/lib/db/org-activity-types";
import type { OrgActivity } from "@/lib/db/types";

export type LogOrgActivityInput = {
  orgId: string;
  contactId?: string | null;
  activityType: string;
  title: string;
  summary?: string | null;
  whyItMatters?: string | null;
  recommendedAction?: Record<string, unknown>;
  url?: string | null;
  occurredAt?: number;
  source: string;
  workflowRunId?: string | null;
  dedupeKey?: string;
  scope?: "shared" | "local_only";
  metadata?: Record<string, unknown>;
};

function actorForSource(source: string): "user" | "agent" | "system" | "sync" {
  if (source.startsWith("manual")) return "user";
  if (source.startsWith("agent")) return "agent";
  if (source.startsWith("sync") || source.startsWith("import")) return "sync";
  return "system";
}

function defaultDedupeKey(input: LogOrgActivityInput, occurredAt: number): string {
  const category = orgActivityCategory(input.activityType);
  const subject = category === "signal"
    ? `${input.url?.trim().toLowerCase() || input.title.trim().toLowerCase()}|${Math.floor(occurredAt / 86_400)}`
    : `${input.contactId ?? input.workflowRunId ?? input.title.trim().toLowerCase()}`;
  return createHash("sha256")
    .update(`${input.orgId}|${input.activityType}|${subject}`)
    .digest("hex");
}

export function logOrgActivity(input: LogOrgActivityInput): { activity: OrgActivity; created: boolean } {
  const activityType = assertOrgActivityType(input.activityType);
  const occurredAt = input.occurredAt ?? Math.floor(Date.now() / 1000);
  const dedupeKey = input.dedupeKey ?? defaultDedupeKey(input, occurredAt);
  const existing = db.select().from(orgActivities).where(eq(orgActivities.dedupeKey, dedupeKey)).get();
  if (existing) return { activity: existing, created: false };
  const id = nanoid();
  db.insert(orgActivities).values({
    id,
    orgId: input.orgId,
    contactId: input.contactId ?? null,
    activityType,
    title: input.title,
    summary: input.summary ?? null,
    whyItMatters: input.whyItMatters ?? null,
    recommendedAction: JSON.stringify(input.recommendedAction ?? {}),
    url: input.url ?? null,
    occurredAt,
    actor: actorForSource(input.source),
    source: input.source,
    workflowRunId: input.workflowRunId ?? null,
    dedupeKey,
    scope: input.scope ?? "shared",
    metadata: JSON.stringify(input.metadata ?? {}),
  }).run();
  return { activity: db.select().from(orgActivities).where(eq(orgActivities.id, id)).get()!, created: true };
}

function sourceLabel(source: string): string {
  if (source.startsWith("agent:signal")) return "Agent scan";
  if (source.startsWith("agent")) return "Agent";
  if (source.startsWith("manual")) return "You";
  if (source.startsWith("sync") || source.startsWith("import")) return "Synced";
  return "System";
}

export function listOrgTimeline(
  orgId: string,
  options: {
    page?: number;
    pageSize?: number;
    category?: OrgActivityCategory | "all";
    types?: string[];
    since?: number;
    includeLocalOnly?: boolean;
  } = {},
) {
  const org = db.select().from(orgs).where(eq(orgs.id, orgId)).get();
  const employmentRows = db.select({ contactId: contactEmployments.contactId }).from(contactEmployments)
    .where(eq(contactEmployments.orgId, orgId)).all();
  const memberIds = [...new Set(employmentRows.map((row) => row.contactId))];
  const people = memberIds.length
    ? db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, memberIds)).all()
    : [];
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const activities = db.select().from(orgActivities).where(
    and(
      eq(orgActivities.orgId, orgId),
      options.includeLocalOnly ? undefined : eq(orgActivities.scope, "shared"),
    ),
  ).all().map((activity) => ({
    id: activity.id,
    kind: "org_activity" as const,
    type: activity.activityType,
    category: orgActivityCategory(activity.activityType),
    title: activity.title,
    summary: activity.summary,
    whyItMatters: activity.whyItMatters,
    recommendedAction: JSON.parse(activity.recommendedAction ?? "{}"),
    contact: activity.contactId ? peopleById.get(activity.contactId) ?? null : null,
    occurredAt: activity.occurredAt,
    ingestedAt: activity.createdAt,
    isNew: activity.createdAt > (org?.feedSeenAt ?? 0),
    actor: activity.actor,
    sourceLabel: sourceLabel(activity.source),
    sourceDetail: activity.source,
    url: activity.url,
    workflowRunId: activity.workflowRunId,
    attachments: [],
  }));
  const interactionRows = db.select().from(interactions).where(
    and(
      options.includeLocalOnly ? undefined : eq(interactions.scope, "shared"),
    ),
  ).all().filter((interaction) => interaction.orgId === orgId || memberIds.includes(interaction.contactId))
    .map((interaction) => ({
      id: interaction.id,
      kind: "interaction" as const,
      type: interaction.interactionType,
      category: "workspace" as const,
      title: interaction.interactionType === "note" ? "Note" : interaction.interactionType.replaceAll("_", " "),
      summary: interaction.summary,
      whyItMatters: null,
      recommendedAction: {},
      contact: peopleById.get(interaction.contactId) ?? null,
      occurredAt: interaction.occurredAt,
      ingestedAt: interaction.createdAt,
      isNew: interaction.createdAt > (org?.feedSeenAt ?? 0),
      actor: actorForSource(interaction.source),
      sourceLabel: sourceLabel(interaction.source),
      sourceDetail: interaction.source,
      url: null,
      workflowRunId: interaction.workflowRunId,
      attachments: [],
    }));
  let rows = [...activities, ...interactionRows];
  if (options.category && options.category !== "all") rows = rows.filter((row) => row.category === options.category);
  const types = options.types;
  if (types?.length) rows = rows.filter((row) => types.includes(row.type));
  const since = options.since;
  if (since) rows = rows.filter((row) => row.occurredAt >= since);
  rows.sort((a, b) => b.occurredAt - a.occurredAt || b.ingestedAt - a.ingestedAt || b.id.localeCompare(a.id));
  const total = rows.length;
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  return { data: rows.slice((page - 1) * pageSize, page * pageSize), total };
}
