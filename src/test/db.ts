import { db } from "@/lib/db/client";
import {
  contactChannels,
  contactEmployments,
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
  orgIdentityMetrics,
  orgIdentities,
  orgActivities,
  orgDomains,
  orgEmailPatterns,
  contactEmailCandidates,
  contactPersonas,
  personaJobs,
  niches,
  launches,
  variants,
  embeddings,
  mediaAttachments,
  mediaAssets,
  orgs,
  workflowRuns,
  workflowSteps,
  workflowTemplates,
  simulationAgents,
  simulationRuns,
  simulationTranscripts,
  scheduledJobs,
  simulationCalibrations,
  browserConnections,
  browserSessionLeases,
  platformTargets,
  publishJobs,
  snowballSeedLedger,
  tasks,
} from "@/lib/db/schema";
import { resetWritingStore } from "@/lib/writing/voice-profile-store";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
export { resetWritingStore } from "@/lib/writing/voice-profile-store";

/** Clear core tables used by unit tests (child rows first). */
export function resetCoreTables(): void {
  resetWritingStore();
  resetPersonalityStore();
  db.delete(snowballSeedLedger).run();
  db.delete(tasks).run();
  db.delete(contactEmailCandidates).run();
  db.delete(orgEmailPatterns).run();
  db.delete(orgActivities).run();
  db.delete(orgDomains).run();
  db.delete(browserSessionLeases).run();
  db.delete(workflowSteps).run();
  db.delete(scheduledJobs).run();
  db.delete(simulationCalibrations).run();
  db.delete(simulationTranscripts).run();
  db.delete(simulationAgents).run();
  db.delete(simulationRuns).run();
  db.delete(interactions).run();
  db.delete(contentActivities).run();
  db.delete(engagements).run();
  db.delete(personaJobs).run();
  db.delete(contactPersonas).run();
  db.delete(workflowRuns).run();
  db.delete(goalProgress).run();
  db.delete(goalWorkflows).run();
  db.delete(goals).run();
  db.delete(orgIdentityMetrics).run();
  db.delete(identityMetrics).run();
  db.delete(graphEdges).run();
  db.delete(embeddings).run();
  db.delete(mediaAttachments).run();
  db.delete(mediaAssets).run();
  db.delete(variants).run();
  db.delete(contentPosts).run();
  db.delete(publishJobs).run();
  db.delete(platformTargets).run();
  db.delete(browserConnections).run();
  db.delete(contentItems).run();
  db.delete(launches).run();
  db.delete(niches).run();
  db.delete(orgIdentities).run();
  db.delete(contactEmployments).run();
  db.delete(orgs).run();
  db.delete(contactChannels).run();
  db.delete(contactIdentities).run();
  db.delete(contacts).run();
  db.delete(workflowTemplates).run();
}
