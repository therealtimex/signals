import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { previewSnowballSource } from "@/lib/workflows/snowball-sources/service";

const previewSchema = z.object({
  sourceUrl: z.string().min(1).max(2_048),
  signedInRequested: z.boolean().optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const input = previewSchema.parse(await request.json());
    const preview = await previewSnowballSource({
      seedUrl: input.sourceUrl,
      signedInRequested: input.signedInRequested,
    });
    return NextResponse.json({ success: true, preview });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Invalid source preview request" }, { status: 400 });
    }
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Source preview failed",
    }, { status: 422 });
  }
}
