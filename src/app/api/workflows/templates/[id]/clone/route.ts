import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cloneTemplate } from "@/lib/db/queries/workflow-templates";
import { serializeTemplateForUi } from "@/lib/workflows/template-serializer";

const cloneSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  targetPersona: z.string().optional(),
  config: z.string().optional(),
});

/**
 * POST /api/workflows/templates/[id]/clone
 * Clone a template, creating a new user template from the source.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const overrides = cloneSchema.parse(body);
    const template = cloneTemplate(id, overrides);
    if (!template) {
      return NextResponse.json({ error: "Source template not found" }, { status: 404 });
    }
    return NextResponse.json(serializeTemplateForUi(template), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
