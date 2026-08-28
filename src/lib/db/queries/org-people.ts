import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactChannels,
  contactEmailCandidates,
  contactEmployments,
  graphEdges,
  interactions,
} from "@/lib/db/schema";
import { getContactsByIds } from "@/lib/db/queries/contacts";
import { getContactRelationshipStrength } from "@/lib/db/queries/org-relationships";
import type { ContactEmployment } from "@/lib/db/types";
import type { RelationshipStrength, RelationshipStrengthBand } from "@/lib/graph/relationship-strength";

export type OrgPersonRow = {
  id: string;
  name: string;
  worksAtTitle: string | null;
  funnelStage: string | null;
  identities: { id: string; platform: string; platformHandle: string | null }[];
  contact: {
    id: string;
    name: string;
    avatarUrl: string | null;
    funnelStage: string | null;
    identities: { id: string; platform: string; platformHandle: string | null }[];
  };
  employment: Pick<ContactEmployment, "id" | "title" | "isCurrent" | "startedAt" | "endedAt" | "source">;
  strength: RelationshipStrength;
  lastInteractionAt: number | null;
  emailStatus: {
    status: "verified" | "predicted" | "uncertain" | "invalid" | "unverified" | "none";
    address: string | null;
  };
  nextAction: { kind: "reach_out" | "re_engage" | "enrich"; label: string };
};

export type ListOrgPeopleOptions = {
  q?: string;
  employment?: "current" | "former" | "all";
  band?: RelationshipStrengthBand;
  sort?: "name" | "strength" | "lastInteraction" | "title";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeLocalOnly?: boolean;
};

function emailStatus(contactId: string): OrgPersonRow["emailStatus"] {
  const channels = db
    .select()
    .from(contactChannels)
    .where(and(eq(contactChannels.contactId, contactId), eq(contactChannels.channelType, "email")))
    .all();
  const verified = channels.find((channel) => channel.isVerified);
  if (verified) return { status: "verified", address: verified.value };
  if (channels[0]) return { status: "unverified", address: channels[0].value };
  const candidate = db
    .select()
    .from(contactEmailCandidates)
    .where(eq(contactEmailCandidates.contactId, contactId))
    .get();
  return candidate
    ? { status: candidate.status, address: candidate.address }
    : { status: "none", address: null };
}

export function listOrgPeople(orgId: string, options: ListOrgPeopleOptions = {}) {
  const employment = options.employment ?? "current";
  const structuredEmployments = db
    .select()
    .from(contactEmployments)
    .where(
      and(
        eq(contactEmployments.orgId, orgId),
        options.includeLocalOnly ? undefined : eq(contactEmployments.scope, "shared"),
      ),
    )
    .all();
  const structuredContactIds = new Set(structuredEmployments.map((row) => row.contactId));
  const legacyEdges = db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.dstType, "org"),
        eq(graphEdges.dstId, orgId),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.edgeType, "works_at"),
        options.includeLocalOnly ? undefined : eq(graphEdges.scope, "shared"),
      ),
    )
    .all();
  const legacyEmployments: ContactEmployment[] = [];
  for (const edge of legacyEdges) {
      if (structuredContactIds.has(edge.srcId)) continue;
      let title: string | null = null;
      try {
        const properties = JSON.parse(edge.properties ?? "{}") as { title?: string | null };
        title = properties.title ?? null;
      } catch {
        title = null;
      }
      legacyEmployments.push({
        id: `legacy-edge:${edge.id}`,
        contactId: edge.srcId,
        orgId,
        title,
        startedAt: null,
        endedAt: null,
        isCurrent: true,
        scope: edge.scope,
        source: edge.source ?? "legacy:works_at",
        metadata: edge.properties ?? "{}",
        createdAt: edge.createdAt,
        updatedAt: edge.updatedAt,
      });
  }
  const employments = [...structuredEmployments, ...legacyEmployments]
    .filter((row) => employment === "all" || row.isCurrent === (employment === "current"));
  const contactRows = getContactsByIds([...new Set(employments.map((row) => row.contactId))]);
  const contactsById = new Map(contactRows.map((contact) => [contact.id, contact]));

  let rows: OrgPersonRow[] = employments.flatMap((row) => {
    const contact = contactsById.get(row.contactId);
    if (!contact) return [];
    const strength = getContactRelationshipStrength(contact.id, options);
    const lastInteraction = db
      .select({ occurredAt: interactions.occurredAt })
      .from(interactions)
      .where(
        and(
          eq(interactions.contactId, contact.id),
          options.includeLocalOnly ? undefined : eq(interactions.scope, "shared"),
        ),
      )
      .all()
      .sort((a, b) => b.occurredAt - a.occurredAt)[0]?.occurredAt ?? null;
    return [{
      id: contact.id,
      name: contact.name,
      worksAtTitle: row.title,
      funnelStage: contact.funnelStage,
      identities: contact.identities.map((identity) => ({
        id: identity.id,
        platform: identity.platform,
        platformHandle: identity.platformHandle,
      })),
      contact: {
        id: contact.id,
        name: contact.name,
        avatarUrl: contact.resolvedAvatarUrl,
        funnelStage: contact.funnelStage,
        identities: contact.identities.map((identity) => ({
          id: identity.id,
          platform: identity.platform,
          platformHandle: identity.platformHandle,
        })),
      },
      employment: {
        id: row.id,
        title: row.title,
        isCurrent: row.isCurrent,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        source: row.source,
      },
      strength,
      lastInteractionAt: lastInteraction,
      emailStatus: emailStatus(contact.id),
      nextAction: strength.band === "strong"
        ? { kind: "reach_out" as const, label: "Reach out" }
        : strength.band === "unknown"
          ? { kind: "enrich" as const, label: "Enrich relationship" }
          : { kind: "re_engage" as const, label: "Re-engage" },
    }];
  });

  const q = options.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (row) =>
        row.contact.name.toLowerCase().includes(q) ||
        row.employment.title?.toLowerCase().includes(q),
    );
  }
  if (options.band) rows = rows.filter((row) => row.strength.band === options.band);

  const direction = options.dir === "asc" ? 1 : -1;
  const sort = options.sort ?? "strength";
  rows.sort((a, b) => {
    const left = sort === "name" ? a.contact.name : sort === "title" ? a.employment.title ?? "" : sort === "lastInteraction" ? a.lastInteractionAt ?? -1 : a.strength.score ?? -1;
    const right = sort === "name" ? b.contact.name : sort === "title" ? b.employment.title ?? "" : sort === "lastInteraction" ? b.lastInteractionAt ?? -1 : b.strength.score ?? -1;
    const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return compared * direction || a.contact.name.localeCompare(b.contact.name);
  });

  const total = rows.length;
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  return { data: rows.slice((page - 1) * pageSize, page * pageSize), total };
}
