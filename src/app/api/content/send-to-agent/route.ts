import { NextResponse } from "next/server";
import { z } from "zod";
import { sendContentToAgent } from "@/lib/publish/send-to-agent";
import { PUBLISH_JOB_KINDS, PUBLISH_PLATFORM_TARGETS } from "@/lib/publish/payload";
import { resolveSignalsBaseUrlFromRequest } from "@/lib/rtx/resolve-signals-base-url";

const sendToAgentSchema = z
  .object({
    contentItemId: z.string(),
    platforms: z.array(z.enum(PUBLISH_PLATFORM_TARGETS)).default([]),
    targets: z.array(z.object({ targetId: z.string().min(1) })).optional(),
    text: z.string().default(""),
    mediaAssetIds: z.array(z.string()).optional(),
    kind: z.enum(PUBLISH_JOB_KINDS).optional(),
    sourcePostUrl: z.string().min(1).optional(),
    sourcePostId: z.string().min(1).optional(),
  })
  .refine((input) => input.platforms.length > 0 || (input.targets?.length ?? 0) > 0, {
    message: "At least one platform or target is required",
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

    const result = await sendContentToAgent({
      ...parsed.data,
      signalsBaseUrl: resolveSignalsBaseUrlFromRequest(req),
    });
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
