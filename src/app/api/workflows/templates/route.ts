import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PLATFORM_ENUM } from "@/lib/db/platforms";
import { getTemplate, listTemplates, createTemplate } from "@/lib/db/queries/workflow-templates";
import { buildTemplateConfig } from "@/lib/workflows/template-config";
import { serializeTemplatesForUi } from "@/lib/workflows/template-serializer";

const limitsSchema = z.object({
  maxResults: z.number().int().positive().optional(),
  maxContacts: z.number().int().positive().optional(),
  maxEnrichmentScore: z.number().int().optional(),
  companyName: z.string().optional(),
  inactivityDays: z.number().int().positive().optional(),
  topics: z.array(z.string()).optional(),
  tone: z.string().optional(),
  maxEngagements: z.number().int().positive().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  platform: z.enum(PLATFORM_ENUM).optional(),
  templateType: z.enum([
    "outreach", "engagement", "content", "nurture", "prospecting", "enrichment", "pruning",
  ]),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  config: z.string().optional(),
  limits: limitsSchema.optional(),
  goalMetrics: z.string().optional(),
  startsAt: z.number().int().optional(),
  endsAt: z.number().int().optional(),
  systemPrompt: z.string().optional(),
  targetPersona: z.string().optional(),
  sourceTemplateId: z.string().optional(),
});

/**
 * GET /api/workflows/templates
 * List workflow templates with optional filtering.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const status = url.searchParams.get("status") as
    | "draft" | "active" | "paused" | "completed"
    | null;
  const templateType = url.searchParams.get("templateType") as
    | "outreach" | "engagement" | "content" | "nurture" | "prospecting" | "enrichment" | "pruning"
    | null;
  const isSystemParam = url.searchParams.get("isSystem");
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") ?? "25", 10);

  const result = listTemplates({
    status: status ?? undefined,
    templateType: templateType ?? undefined,
    isSystem: isSystemParam !== null ? isSystemParam === "true" : undefined,
    page,
    pageSize,
  });

  return NextResponse.json({
    ...result,
    data: serializeTemplatesForUi(result.data),
  });
}

/**
 * POST /api/workflows/templates
 * Create a new workflow template (always user-created, isSystem=0).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createTemplateSchema.parse(body);

    let config = data.config;
    let systemPrompt = data.systemPrompt;
    let targetPersona = data.targetPersona;
    let description = data.description;
    let platform = data.platform;

    if (data.sourceTemplateId) {
      const source = getTemplate(data.sourceTemplateId);
      if (!source) {
        return NextResponse.json({ error: "Source template not found" }, { status: 404 });
      }
      systemPrompt = systemPrompt ?? source.systemPrompt ?? undefined;
      targetPersona = targetPersona ?? source.targetPersona ?? undefined;
      description = description ?? source.description ?? undefined;
      platform = platform ?? source.platform ?? undefined;
      config = config ?? source.config ?? undefined;
    }

    const builtConfig =
      data.limits !== undefined
        ? buildTemplateConfig(data.templateType, data.limits, config)
        : config ?? buildTemplateConfig(data.templateType, {}, config);

    const template = createTemplate({
      name: data.name,
      description: description ?? undefined,
      platform: platform ?? undefined,
      templateType: data.templateType,
      status: data.status,
      config: builtConfig,
      goalMetrics: data.goalMetrics,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      systemPrompt,
      targetPersona,
      sourceTemplateId: data.sourceTemplateId,
      isSystem: 0,
    });
    return NextResponse.json(serializeTemplatesForUi([template])[0], { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
