import { NextResponse } from "next/server";
import { z } from "zod";
import { sendContentToAgent } from "@/lib/publish/send-to-agent";

const sendToAgentSchema = z.object({
  contentItemId: z.string(),
  platforms: z.array(z.enum(["x", "linkedin"])).min(1),
  text: z.string().min(1),
  mediaAssetIds: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = sendToAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await sendContentToAgent(parsed.data);
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          errorCode: result.errorCode,
        },
        { status: result.httpStatus }
      );
    }

    return NextResponse.json(result, { status: 202 });
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
