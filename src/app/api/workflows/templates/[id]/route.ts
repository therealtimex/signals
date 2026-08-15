import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PLATFORM_ENUM } from "@/lib/db/platforms";
import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from "@/lib/db/queries/workflow-templates";

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  platform: z.enum(PLATFORM_ENUM).nullable().optional(),
  templateType: z.enum([
    "outreach", "engagement", "content", "nurture", "prospecting", "enrichment", "pruning",
  ]).optional(),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  config: z.string().optional(),
  goalMetrics: z.string().optional(),
  startsAt: z.number().int().nullable().optional(),
  endsAt: z.number().int().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  targetPersona: z.string().nullable().optional(),
  estimatedCost: z.number().optional(),
});

/**
 * GET /api/workflows/templates/[id]
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = getTemplate(id);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  return NextResponse.json(template);
}

/**
 * PATCH /api/workflows/templates/[id]
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const data = updateTemplateSchema.parse(body);
    const template = updateTemplate(id, data);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    return NextResponse.json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/workflows/templates/[id]
 * Rejects deletion of system templates (403).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = getTemplate(id);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  if (template.isSystem === 1) {
    return NextResponse.json(
      { error: "Cannot delete system templates" },
      { status: 403 }
    );
  }
  const deleted = deleteTemplate(id);
  if (!deleted) {
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
