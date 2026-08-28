import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listTasks, createTask } from "@/lib/db/queries/tasks";

const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  taskType: z.enum(["manual", "agent_review", "follow_up", "content_review"]).optional(),
  status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assignee: z.enum(["user", "agent"]).optional(),
  relatedContactId: z.string().optional(),
  relatedOrgId: z.string().optional(),
  relatedTemplateId: z.string().optional(),
  dueAt: z.number().int().optional(),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const priority = searchParams.get("priority") ?? undefined;
  const assignee = searchParams.get("assignee") ?? undefined;
  const relatedOrgId = searchParams.get("relatedOrgId") ?? undefined;

  const results = listTasks({ status, priority, assignee, relatedOrgId });
  return NextResponse.json(results);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createTaskSchema.parse(body);
    const task = createTask(data);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
