import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import {
  deploySnowballSeedScout,
  undeploySnowballSeedScout,
} from "@/lib/rtx/deploy-snowball-seed-scout";
import { parseTemplateConfig } from "@/lib/workflows/template-config";
import {
  buildSnowballSeedScoutDeployConfig,
  isSnowballSeedScoutTemplateConfig,
  readSnowballSeedScoutConfig,
} from "@/lib/workflows/snowball-seed-scout";

const deploySchema = z.object({
  action: z.enum(["deploy", "undeploy"]).default("deploy"),
  config: z.record(z.unknown()).optional(),
});

/**
 * POST /api/workflows/templates/[id]/deploy
 * Deploy heartbeat shell automation for Snowball Seed Scout.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const template = getTemplate(id);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const templateConfig = parseTemplateConfig(template.config);
  if (!isSnowballSeedScoutTemplateConfig(templateConfig)) {
    return NextResponse.json(
      { error: "Template does not support heartbeat deploy" },
      { status: 400 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const data = deploySchema.parse(body);
    const mergedConfig = {
      ...templateConfig,
      ...(data.config ?? {}),
    };
    const scoutConfig = readSnowballSeedScoutConfig(mergedConfig);
    const deployConfig = buildSnowballSeedScoutDeployConfig(scoutConfig);

    const result =
      data.action === "undeploy"
        ? await undeploySnowballSeedScout({
            config: { ...deployConfig, templateId: id },
          })
        : await deploySnowballSeedScout({
            templateId: id,
            config: deployConfig,
          });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json(
      {
        action: data.action,
        workspaceSlug: result.workspaceSlug,
        heartbeatPath: result.heartbeatPath,
        scoutConfigPath: result.scoutConfigPath,
        deployment: result.deployment,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
