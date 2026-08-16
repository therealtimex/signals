import { desc, eq, count } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, tasks, workflowRuns, contentItems } from "@/lib/db/schema";
import { attachContactDtos } from "@/lib/db/queries/contact-read-model";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";
import type { Task } from "@/lib/db/types";

export interface FunnelDistribution {
  stage: string;
  count: number;
}

const FUNNEL_STAGES = ["prospect", "engaged", "qualified", "opportunity", "customer", "advocate"] as const;

export function getFunnelDistribution(): FunnelDistribution[] {
  const rows = db
    .select({
      stage: contacts.funnelStage,
      count: count(),
    })
    .from(contacts)
    .groupBy(contacts.funnelStage)
    .all();

  const countMap = new Map<string, number>(rows.map((r) => [r.stage, r.count]));
  return FUNNEL_STAGES.map((stage) => ({
    stage,
    count: countMap.get(stage) ?? 0,
  }));
}

export interface DashboardMetrics {
  totalContacts: number;
  activeWorkflows: number;
  pendingTasks: number;
  contentItems: number;
  recentContacts: ContactDTO[];
  pendingTasksList: Task[];
}

export function getDashboardMetrics(): DashboardMetrics {
  const totalContacts = db.select({ value: count() }).from(contacts).get()?.value ?? 0;

  const activeWorkflows = db
    .select({ value: count() })
    .from(workflowRuns)
    .where(eq(workflowRuns.status, "running"))
    .get()?.value ?? 0;

  const pendingTasks = db
    .select({ value: count() })
    .from(tasks)
    .where(eq(tasks.status, "todo"))
    .get()?.value ?? 0;

  const totalContent = db.select({ value: count() }).from(contentItems).get()?.value ?? 0;

  const recentContactRows = db
    .select()
    .from(contacts)
    .orderBy(desc(contacts.createdAt))
    .limit(5)
    .all();
  const recentContacts = attachContactDtos(recentContactRows);

  const pendingTasksList = db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "todo"))
    .orderBy(desc(tasks.createdAt))
    .limit(5)
    .all();

  return {
    totalContacts,
    activeWorkflows,
    pendingTasks,
    contentItems: totalContent,
    recentContacts,
    pendingTasksList,
  };
}
