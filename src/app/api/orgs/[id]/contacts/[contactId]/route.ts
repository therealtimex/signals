import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { contactEmployments } from "@/lib/db/schema";
import {
  deleteContactEmployment,
  updateContactEmployment,
} from "@/lib/db/queries/contact-employments";
import { getOrgById, recalcOrgEnrichment } from "@/lib/db/queries/orgs";
import { listOrgPeople } from "@/lib/db/queries/org-people";
import { logOrgActivity } from "@/lib/db/queries/org-activities";

const updateSchema = z.object({
  title: z.string().trim().max(500).nullable().optional(),
  isCurrent: z.boolean().optional(),
  endedAt: z.number().int().nullable().optional(),
});

function employments(orgId: string, contactId: string) {
  return db
    .select()
    .from(contactEmployments)
    .where(
      and(
        eq(contactEmployments.orgId, orgId),
        eq(contactEmployments.contactId, contactId),
      ),
    )
    .all();
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const { id, contactId } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const existing = employments(id, contactId).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))[0];
  if (!existing) return NextResponse.json({ error: "Employment not found" }, { status: 404 });
  updateContactEmployment(existing.id, updateSchema.parse(await req.json()));
  recalcOrgEnrichment(id);
  const person = listOrgPeople(id, { employment: "all" }).data.find(
    (row) => row.contact.id === contactId,
  );
  return NextResponse.json(person);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const { id, contactId } = await params;
  const rows = employments(id, contactId);
  if (rows.length === 0) return NextResponse.json({ error: "Employment not found" }, { status: 404 });
  for (const row of rows) deleteContactEmployment(row.id);
  recalcOrgEnrichment(id);
  logOrgActivity({
    orgId: id,
    contactId,
    activityType: "contact_unlinked",
    title: "Person unlinked from company",
    source: "manual:unlink_contact_from_org",
    dedupeKey: `contact_unlinked:${id}:${contactId}:${Date.now()}`,
  });
  return new NextResponse(null, { status: 204 });
}
