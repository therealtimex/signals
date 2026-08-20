import { NextResponse } from "next/server";
import { z } from "zod";
import { discoverAndRegisterPlatformTargets } from "@/lib/platforms/platform-target-service";
import { platformTargetErrorResult } from "@/lib/platforms/target-errors";

const schema = z.object({
  platform: z.enum(["x", "linkedin", "facebook"]),
  connectionId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    return NextResponse.json(await discoverAndRegisterPlatformTargets(
      parsed.data.platform,
      parsed.data.connectionId
    ));
  } catch (error) {
    const result = platformTargetErrorResult(error);
    return NextResponse.json(result ?? { error: "Failed to discover targets" }, { status: 409 });
  }
}
