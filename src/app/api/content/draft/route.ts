import { NextResponse } from "next/server";
import { z } from "zod";
import { saveComposeDraft } from "@/lib/publish/save-compose-draft";

const draftSchema = z.object({
  body: z.string().min(1),
  platforms: z.array(z.enum(["x", "linkedin"])).min(1),
  draftId: z.string().optional(),
  mediaAssetIds: z.array(z.string()).optional(),
  title: z.string().optional(),
});

/** CRM-only compose draft upsert (no platform char limits or OAuth accounts). */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = draftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = saveComposeDraft(parsed.data);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.httpStatus }
      );
    }

    return NextResponse.json({
      success: true,
      contentItemId: result.contentItemId,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
