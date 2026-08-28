import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addOrgDomainAlias,
  getOrgById,
  removeOrgDomainAlias,
} from "@/lib/db/queries/orgs";
import { OrgDomainConflictError, OrgValidationError } from "@/lib/orgs/errors";

const schema = z.object({ domain: z.string().trim().min(1).max(255) });

function errorResponse(error: unknown) {
  if (error instanceof OrgValidationError) {
    return NextResponse.json(
      { error: error.message, code: "VALIDATION_ERROR", details: error.details },
      { status: 400 },
    );
  }
  if (error instanceof OrgDomainConflictError) {
    return NextResponse.json(
      { error: error.message, code: "CONFLICT", details: { domain: error.domain, orgId: error.orgId } },
      { status: 409 },
    );
  }
  throw error;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  try {
    const { domain } = schema.parse(await req.json());
    return NextResponse.json(addOrgDomainAlias(id, domain), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  try {
    const { domain } = schema.parse(await req.json());
    if (!removeOrgDomainAlias(id, domain)) {
      return NextResponse.json({ error: "Domain alias not found", code: "NOT_FOUND" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    return errorResponse(error);
  }
}
