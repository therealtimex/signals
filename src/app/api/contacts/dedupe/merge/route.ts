import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runDedupeMerge } from "@/lib/contacts/dedupe/run-merge";

const mergeSchema = z.object({
  groups: z
    .array(
      z.object({
        primaryContactId: z.string().min(1),
        secondaryContactIds: z.array(z.string().min(1)).min(1),
      })
    )
    .min(1)
    .max(100),
  dryRun: z.boolean().optional(),
  /** Attaches the run and its thread message to the dedupe template. */
  templateId: z.string().min(1).optional(),
});

/**
 * POST /api/contacts/dedupe/merge
 *
 * Merge reviewed groups in one batch. Idempotent — a group already merged reports
 * `already_merged` rather than failing, so a double-click costs nothing.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { groups, dryRun, templateId } = mergeSchema.parse(body);

    const result = await runDedupeMerge({ groups, dryRun, templateId });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid merge request", errorCode: "validation_error", details: error.flatten() },
        { status: 400 },
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
