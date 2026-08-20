import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mergeContacts, MergeContactsError } from "@/lib/contacts/dedupe/merge";

const mergeSchema = z.object({
  primaryContactId: z.string().min(1),
  secondaryContactIds: z.array(z.string().min(1)).min(1),
  dryRun: z.boolean().optional(),
});

/**
 * POST /api/contacts/dedupe/merge
 *
 * Merge one reviewed group. Idempotent — a group already merged reports `already_merged`
 * rather than failing, so a double-click costs nothing.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { primaryContactId, secondaryContactIds, dryRun } = mergeSchema.parse(body);

    const result = mergeContacts({
      primaryContactId,
      secondaryContactIds,
      options: { dryRun, reason: "Dedupe review panel" },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid merge request", errorCode: "validation_error", details: error.flatten() },
        { status: 400 },
      );
    }
    if (error instanceof MergeContactsError) {
      return NextResponse.json(
        { error: error.message, errorCode: error.code.toLowerCase() },
        { status: error.code === "NOT_FOUND" ? 404 : 400 },
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Merge failed",
        errorCode: "merge_failed",
      },
      { status: 500 },
    );
  }
}
