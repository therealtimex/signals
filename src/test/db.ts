import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contacts,
  goalProgress,
  goalWorkflows,
  goals,
  workflowRuns,
  workflowSteps,
  workflowTemplates,
} from "@/lib/db/schema";

/** Clear core tables used by unit tests (child rows first). */
export function resetCoreTables(): void {
  db.delete(workflowSteps).run();
  db.delete(workflowRuns).run();
  db.delete(goalProgress).run();
  db.delete(goalWorkflows).run();
  db.delete(goals).run();
  db.delete(contactIdentities).run();
  db.delete(contacts).run();
  db.delete(workflowTemplates).run();
}
