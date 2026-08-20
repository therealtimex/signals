import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildDedupeReview } from "@/lib/contacts/dedupe/review";
import type { DuplicateTier } from "@/lib/contacts/dedupe/detect";

const tierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const scanSchema = z.object({
  tiers: z.array(tierSchema).min(1).max(3).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

/**
 * POST /api/contacts/dedupe/scan
 *
 * Deterministic duplicate detection for the review panel — the same engine the
 * `find_duplicate_contacts` agent tool uses, with no agent in the loop. Read-only.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tiers, minConfidence, limit } = scanSchema.parse(body);

    const groups = buildDedupeReview({
      tiers: tiers as DuplicateTier[] | undefined,
      minConfidence,
      limit,
    });

    return NextResponse.json({ groups });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid scan options", errorCode: "validation_error", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Duplicate scan failed",
        errorCode: "scan_failed",
      },
      { status: 500 },
    );
  }
}
