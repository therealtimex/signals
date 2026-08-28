import { eq, and, desc, count, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import type { Task, NewTask } from "@/lib/db/types";
import { logOrgActivity } from "@/lib/db/queries/org-activities";

export function listTasks(opts?: {
  status?: string;
  priority?: string;
  assignee?: string;
  relatedOrgId?: string;
}): Task[] {
  const conditions: SQL[] = [];

  if (opts?.status) {
    conditions.push(eq(tasks.status, opts.status as Task["status"]));
  }
  if (opts?.priority) {
    conditions.push(eq(tasks.priority, opts.priority as Task["priority"]));
  }
  if (opts?.assignee) {
    conditions.push(eq(tasks.assignee, opts.assignee as Task["assignee"]));
  }
  if (opts?.relatedOrgId) conditions.push(eq(tasks.relatedOrgId, opts.relatedOrgId));

  const query = db.select().from(tasks);

  if (conditions.length > 0) {
    return query.where(and(...conditions)).orderBy(desc(tasks.createdAt)).all();
  }

  return query.orderBy(desc(tasks.createdAt)).all();
}

export function getTaskById(id: string): Task | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

export function getTasksByContact(contactId: string): Task[] {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.relatedContactId, contactId))
    .orderBy(desc(tasks.createdAt))
    .all();
}

export function createTask(data: Omit<NewTask, "id">): Task {
  const id = nanoid();
  db.insert(tasks).values({ ...data, id }).run();
  const task = getTaskById(id)!;
  if (task.relatedOrgId) {
    logOrgActivity({
      orgId: task.relatedOrgId,
      activityType: "task_created",
      title: task.title,
      summary: task.description,
      source: task.assignee === "agent" ? "agent:create_task" : "manual:create_task",
      dedupeKey: `task:${task.id}`,
      metadata: { taskId: task.id },
    });
  }
  return task;
}

export function updateTask(id: string, data: Partial<NewTask>): Task | undefined {
  const existing = getTaskById(id);
  if (!existing) return undefined;

  const updates: Partial<NewTask> & { updatedAt: number } = {
    ...data,
    updatedAt: Math.floor(Date.now() / 1000),
  };

  // Set completedAt when marking as done
  if (data.status === "done" && !existing.completedAt) {
    updates.completedAt = Math.floor(Date.now() / 1000);
  }
  // Clear completedAt when moving away from done
  if (data.status && data.status !== "done") {
    updates.completedAt = null as unknown as number;
  }

  db.update(tasks).set(updates).where(eq(tasks.id, id)).run();
  return getTaskById(id);
}

export function deleteTask(id: string): boolean {
  const existing = getTaskById(id);
  if (!existing) return false;

  db.delete(tasks).where(eq(tasks.id, id)).run();
  return true;
}

export function countTasks(status?: string): number {
  const query = db.select({ value: count() }).from(tasks);
  if (status) {
    return query.where(eq(tasks.status, status as Task["status"])).get()?.value ?? 0;
  }
  return query.get()?.value ?? 0;
}
