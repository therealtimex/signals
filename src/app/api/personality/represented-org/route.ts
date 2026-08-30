import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnerContactId } from "@/lib/db/queries/contacts";
import { getOrgById, listOrgs } from "@/lib/db/queries/orgs";
import {
  getRepresentedOrgId,
  setRepresentedOrgId,
} from "@/lib/settings/signals-config";

const putSchema = z.object({
  orgId: z.string().min(1).nullable(),
}).strict();

function orgView(org: ReturnType<typeof getOrgById>) {
  return org
    ? { id: org.id, name: org.name, website: org.website, industry: org.industry }
    : null;
}

export async function GET() {
  const selfContactId = getOwnerContactId();
  if (!selfContactId) {
    return NextResponse.json(
      { error: "Self contact is missing", code: "NOT_FOUND", reason: "self_contact_missing" },
      { status: 404 },
    );
  }
  const candidates = listOrgs({
    owner: selfContactId,
    includeLocalOnly: true,
    pageSize: 10_000,
  }).data;
  const selectedId = getRepresentedOrgId();
  const selected = candidates.find((org) => org.id === selectedId);
  return NextResponse.json({
    selected: orgView(selected),
    candidates: candidates.map((org) => orgView(org)),
  });
}

export async function PUT(request: Request) {
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (parsed.data.orgId) {
    const selfContactId = getOwnerContactId();
    const org = getOrgById(parsed.data.orgId);
    if (!selfContactId || !org || org.ownerContactId !== selfContactId) {
      return NextResponse.json(
        {
          error: "Organization is not represented by the self contact",
          code: "CONFLICT",
          reason: "org_not_represented",
        },
        { status: 409 },
      );
    }
  }
  setRepresentedOrgId(parsed.data.orgId);
  return GET();
}
