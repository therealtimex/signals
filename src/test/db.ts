import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contacts,
  contentItems,
  contentPosts,
  engagements,
  goalProgress,
  goalWorkflows,
  goals,
  graphEdges,
  interactions,
  contentActivities,
  identityMetrics,
  contactPersonas,
  niches,
  launches,
  variants,
  embeddings,
  orgs,
  workflowRuns,
  workflowSteps,
  workflowTemplates,
} from "@/lib/db/schema";

/** Clear core tables used by unit tests (child rows first). */
export function resetCoreTables(): void {
  db.delete(workflowSteps).run();
  db.delete(interactions).run();
  db.delete(contentActivities).run();
  db.delete(engagements).run();
  db.delete(workflowRuns).run();
  db.delete(goalProgress).run();
  db.delete(goalWorkflows).run();
  db.delete(goals).run();
  db.delete(contactPersonas).run();
  db.delete(identityMetrics).run();
  db.delete(graphEdges).run();
  db.delete(embeddings).run();
  db.delete(variants).run();
  db.delete(contentPosts).run();
  db.delete(contentItems).run();
  db.delete(launches).run();
  db.delete(niches).run();
  db.delete(orgs).run();
  db.delete(contactIdentities).run();
  db.delete(contacts).run();
  db.delete(workflowTemplates).run();
}
