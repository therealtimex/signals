import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveSnowballSeedScoutSettings } from "@/lib/rtx/deploy-snowball-seed-scout";
import {
  buildSnowballSeedScoutDeployConfig,
  readSnowballSeedScoutConfig,
} from "@/lib/workflows/snowball-seed-scout";

/** Sentinel distinguishing an unparseable body from a legitimately null one. */
const NOT_JSON = Symbol("not-json");

const settingsSchema = z.object({
  templateId: z.string().min(1),
  config: z.record(z.unknown()),
});

/**
 * PUT /api/snowball-seed-scout/settings
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => NOT_JSON);
    if (body === NOT_JSON) {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 },
      );
    }
    const data = settingsSchema.parse(body);
    const scoutConfig = readSnowballSeedScoutConfig(data.config);
    const deployConfig = buildSnowballSeedScoutDeployConfig(scoutConfig);

    const result = await saveSnowballSeedScoutSettings({
      templateId: data.templateId,
      config: deployConfig,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, errorCode: result.errorCode },
        { status: result.errorCode === "not_deployed" ? 409 : 500 },
      );
    }

    return NextResponse.json({
      deployment: result.deployment,
      workspaceSlug: result.workspaceSlug,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
