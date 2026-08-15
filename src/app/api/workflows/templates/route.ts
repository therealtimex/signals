import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PLATFORM_ENUM } from "@/lib/db/platforms";
import { listTemplates, createTemplate } from "@/lib/db/queries/workflow-templates";

const createTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  platform: z.enum(PLATFORM_ENUM).optional(),
  templateType: z.enum([
    "outreach", "engagement", "content", "nurture", "prospecting", "enrichment", "pruning",
  ]),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  config: z.string().optional(),
  goalMetrics: z.string().optional(),
  startsAt: z.number().int().optional(),
  endsAt: z.number().int().optional(),
  systemPrompt: z.string().optional(),
  targetPersona: z.string().optional(),
  estimatedCost: z.number().optional(),
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

  return NextResponse.json(result);
}

/**
 * POST /api/workflows/templates
 * Create a new workflow template (always user-created, isSystem=0).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createTemplateSchema.parse(body);
    const template = createTemplate({
      ...data,
      isSystem: 0,
    });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
