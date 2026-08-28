import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrgById, recalcOrgEnrichment } from "@/lib/db/queries/orgs";
import { getContactById } from "@/lib/db/queries/contacts";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { listOrgPeople } from "@/lib/db/queries/org-people";
import { db } from "@/lib/db/client";
import { contactEmployments } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { logOrgActivity } from "@/lib/db/queries/org-activities";

const linkSchema = z.object({
  contactId: z.string().min(1),
  title: z.string().trim().max(500).nullable().optional(),
  isCurrent: z.boolean().optional(),
  startedAt: z.number().int().nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const org = getOrgById(id);
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const search = new URL(req.url).searchParams;
  const result = listOrgPeople(id, {
    q: search.get("q") ?? undefined,
    employment: (search.get("employment") as "current" | "former" | "all") ?? undefined,
    band: (search.get("band") as "unknown" | "weak" | "moderate" | "strong") ?? undefined,
    sort: (search.get("sort") as "name" | "strength" | "lastInteraction" | "title") ?? undefined,
    dir: (search.get("dir") as "asc" | "desc") ?? undefined,
    page: Number(search.get("page") ?? 1),
    pageSize: Number(search.get("pageSize") ?? 25),
    includeLocalOnly: search.get("includeLocalOnly") === "true",
  });
  return NextResponse.json(result);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const body = linkSchema.parse(await req.json());
  if (!getContactById(body.contactId)) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  const current = db
    .select()
    .from(contactEmployments)
    .where(
      and(
        eq(contactEmployments.orgId, id),
        eq(contactEmployments.contactId, body.contactId),
        eq(contactEmployments.isCurrent, true),
      ),
    )
    .get();
  if (current && (body.isCurrent ?? true)) {
    return NextResponse.json(
      { error: "A current employment already exists", code: "CONFLICT" },
      { status: 409 },
    );
  }
  createContactEmployment({
    contactId: body.contactId,
    orgId: id,
    title: body.title,
    startedAt: body.startedAt,
    isCurrent: body.isCurrent ?? true,
    source: "manual:link_contact_to_org",
  });
  recalcOrgEnrichment(id);
  logOrgActivity({
    orgId: id,
    contactId: body.contactId,
    activityType: "contact_linked",
    title: "Person linked to company",
    source: "manual:link_contact_to_org",
    dedupeKey: `contact_linked:${id}:${body.contactId}:${Date.now()}`,
  });
  const person = listOrgPeople(id, { employment: "all" }).data.find(
    (row) => row.contact.id === body.contactId,
  );
  return NextResponse.json(person, { status: 201 });
}
