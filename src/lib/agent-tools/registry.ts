import {
  archiveContactSchema,
  createContactSchema,
  findDuplicateContactsSchema,
  mergeContactsSchema,
  createTaskSchema,
  enrichContactSchema,
  getContactSchema,
  listWorkflowTemplatesSchema,
  queryAnalyticsSchema,
  queryContactsSchema,
  resolvePlatformClaimSchema,
  queryContentSchema,
  queryGoalsSchema,
  queryWorkflowsSchema,
  startWorkflowSchema,
  dispatchFollowOnWorkflowSchema,
  completeWorkflowRunSchema,
  updateContactSchema,
  upsertContactIdentitySchema,
  getPersonaSchema,
  upsertPersonaSchema,
  getPersonaEvidenceSchema,
  generatePersonaSchema,
  getPersonaJobSchema,
  completePersonaJobSchema,
  listMailAccountsSchema,
  recordWorkflowRunContactsSchema,
} from "@/lib/agent-tools/schemas";
import {
  logInteractionSchema,
  queryGraphSchema,
  queryNichesSchema,
  queryOrgsSchema,
  queryLaunchesSchema,
  queryOrgIdentitiesSchema,
  upsertEdgeSchema,
  upsertLaunchSchema,
  upsertNicheSchema,
  upsertOrgIdentitySchema,
  upsertVariantSchema,
  semanticSearchSchema,
  createSimulationRunSchema,
  querySimulationsSchema,
  recordSimulationResultsSchema,
  completeSimulationRunSchema,
  calibrateSimulationRunSchema,
} from "@/lib/agent-tools/graph-schemas";
import {
  completePublishSchema,
  getPublishJobSchema,
  handleCompletePublish,
  handleGetPublishJob,
  handleUpdatePublishJob,
  updatePublishJobSchema,
} from "@/lib/agent-tools/publish-handlers";
import {
  handleCompletePersonaJob,
  handleGetPersonaJob,
} from "@/lib/agent-tools/persona-job-handlers";
import {
  handleLogInteraction,
  handleQueryGraph,
  handleQueryLaunches,
  handleQueryNiches,
  handleQueryOrgIdentities,
  handleQueryOrgs,
  handleSemanticSearch,
  handleUpsertEdge,
  handleUpsertLaunch,
  handleUpsertNiche,
  handleUpsertOrgIdentity,
  handleUpsertVariant,
  handleCreateSimulationRun,
  handleQuerySimulations,
  handleRecordSimulationResults,
  handleCompleteSimulationRun,
  handleCalibrateSimulationRun,
} from "@/lib/agent-tools/graph-handlers";
import {
  completeSimulationRunParameters,
  zodToParameters,
} from "@/lib/agent-tools/json-schema";
import {
  handleArchiveContact,
  handleCreateContact,
  handleFindDuplicateContacts,
  handleMergeContacts,
  handleCreateTask,
  handleEnrichContact,
  handleGetContact,
  handleListWorkflowTemplates,
  handleQueryAnalytics,
  handleQueryContacts,
  handleResolvePlatformClaim,
  handleQueryContent,
  handleQueryGoals,
  handleQueryWorkflows,
  handleStartWorkflow,
  handleDispatchFollowOnWorkflow,
  handleCompleteWorkflowRun,
  handleUpdateContact,
  handleUpsertContactIdentity,
  handleGetPersona,
  handleGetPersonaEvidence,
  handleGeneratePersona,
  handleUpsertPersona,
  handleRecordWorkflowRunContacts,
} from "@/lib/agent-tools/handlers";
import { handleListMailAccounts } from "@/lib/agent-tools/mail-handlers";
import {
  getPlatformTargetSchema,
  handleGetPlatformTarget,
  handleListPlatformTargets,
  handlePreparePlatformTarget,
  handleReleasePlatformTarget,
  listPlatformTargetsSchema,
  preparePlatformTargetSchema,
  releasePlatformTargetSchema,
} from "@/lib/agent-tools/platform-target-handlers";
import type { AgentToolDefinition } from "@/lib/agent-tools/types";

export const AGENT_TOOL_VERSION = "1";

export const AGENT_TOOLS: Record<string, AgentToolDefinition> = {
  query_contacts: {
    name: "query_contacts",
    description:
      "Search and filter active contacts by name, company, funnel stage, or platform. " +
      "Pass email for an exact normalized email match (including non-primary email " +
      "channels), or platformUserId for an exact platform-identity match. " +
      "To find out whether a platform account is already claimed, use " +
      "resolve_platform_claim instead — this tool excludes archived contacts and " +
      "does not see org-held claims.",
    category: "contacts",
    schema: queryContactsSchema,
    parameters: zodToParameters(queryContactsSchema),
    execute: handleQueryContacts,
  },
  resolve_platform_claim: {
    name: "resolve_platform_claim",
    description:
      "Resolve whether a platform account is already claimed, by a contact identity or an " +
      "org identity. This is the same resolution upsert_contact_identity enforces, so use " +
      "it before creating a contact for an imported platform handle. Returns " +
      "{claimed:false} or {claimed:true, claimant:{kind:'contact'|'org', ...}}; a contact " +
      "claimant reports whether it is archived.",
    category: "contacts",
    schema: resolvePlatformClaimSchema,
    parameters: zodToParameters(resolvePlatformClaimSchema),
    execute: handleResolvePlatformClaim,
  },
  get_contact: {
    name: "get_contact",
    description: "Get full details for a single contact by ID, including linked identities.",
    category: "contacts",
    schema: getContactSchema,
    parameters: zodToParameters(getContactSchema),
    execute: handleGetContact,
  },
  create_contact: {
    name: "create_contact",
    description: "Create a new contact record. At minimum a name is required.",
    category: "contacts",
    schema: createContactSchema,
    parameters: zodToParameters(createContactSchema),
    execute: handleCreateContact,
  },
  update_contact: {
    name: "update_contact",
    description: "Update fields on an existing contact by ID.",
    category: "contacts",
    schema: updateContactSchema,
    parameters: zodToParameters(updateContactSchema),
    execute: handleUpdateContact,
  },
  enrich_contact: {
    name: "enrich_contact",
    description:
      "Fill missing contact fields without overwriting existing data. Recalculates enrichment score.",
    category: "contacts",
    schema: enrichContactSchema,
    parameters: zodToParameters(enrichContactSchema),
    execute: handleEnrichContact,
  },
  upsert_contact_identity: {
    name: "upsert_contact_identity",
    description:
      "Create or update a platform identity for a contact. Cross-claim conflicts return a reassign error.",
    category: "contacts",
    schema: upsertContactIdentitySchema,
    parameters: zodToParameters(upsertContactIdentitySchema),
    execute: handleUpsertContactIdentity,
  },
  archive_contact: {
    name: "archive_contact",
    description: "Archive a contact with a reason.",
    category: "contacts",
    schema: archiveContactSchema,
    parameters: zodToParameters(archiveContactSchema),
    execute: handleArchiveContact,
  },
  find_duplicate_contacts: {
    name: "find_duplicate_contacts",
    description:
      "Scan the contact graph for duplicate records. Tier 1 is an exact email or platform-handle match, tier 2 is a matching name at the same organization, tier 3 is a shared employment node plus overlapping interaction threads. Read-only — feed the result to merge_contacts.",
    category: "contacts",
    schema: findDuplicateContactsSchema,
    parameters: zodToParameters(findDuplicateContactsSchema),
    execute: handleFindDuplicateContacts,
  },
  merge_contacts: {
    name: "merge_contacts",
    description:
      "Merge duplicate contacts into a surviving primary: re-link identities, channels, employments, interactions, tasks, and content, then archive each secondary with merged_into_contact_id set. Idempotent — replaying a merge reports already_merged. Pass options.dryRun to preview.",
    category: "contacts",
    schema: mergeContactsSchema,
    parameters: zodToParameters(mergeContactsSchema),
    execute: handleMergeContacts,
  },
  query_analytics: {
    name: "query_analytics",
    description:
      "Get CRM dashboard metrics: total contacts, active workflows, pending tasks, and content count.",
    category: "analytics",
    schema: queryAnalyticsSchema,
    parameters: zodToParameters(queryAnalyticsSchema),
    execute: handleQueryAnalytics,
  },
  query_workflows: {
    name: "query_workflows",
    description:
      "List automation runs. Filter by type (sync, enrich, search, prune, sequence, agent) or status.",
    category: "workflows",
    schema: queryWorkflowsSchema,
    parameters: zodToParameters(queryWorkflowsSchema),
    execute: handleQueryWorkflows,
  },
  list_workflow_templates: {
    name: "list_workflow_templates",
    description: "List available agent/workflow templates that can be started.",
    category: "workflows",
    schema: listWorkflowTemplatesSchema,
    parameters: zodToParameters(listWorkflowTemplatesSchema),
    execute: handleListWorkflowTemplates,
  },
  start_workflow: {
    name: "start_workflow",
    description: "Start an agent workflow from a template ID.",
    category: "workflows",
    schema: startWorkflowSchema,
    parameters: zodToParameters(startWorkflowSchema),
    execute: handleStartWorkflow,
  },
  dispatch_follow_on_workflow: {
    name: "dispatch_follow_on_workflow",
    description:
      "Cascade newly created contacts from a completed parent workflow run into a follow-on enrichment or outreach workflow.",
    category: "workflows",
    schema: dispatchFollowOnWorkflowSchema,
    parameters: zodToParameters(dispatchFollowOnWorkflowSchema),
    execute: handleDispatchFollowOnWorkflow,
  },
  complete_workflow_run: {
    name: "complete_workflow_run",
    description:
      "Mark a workflow run as completed, update processed counts, and trigger automated follow-on cascading and webhook dispatch.",
    category: "workflows",
    schema: completeWorkflowRunSchema,
    parameters: zodToParameters(completeWorkflowRunSchema),
    execute: handleCompleteWorkflowRun,
  },
  record_workflow_run_contacts: {
    name: "record_workflow_run_contacts",
    description:
      "Validate a workflow run and durably add created or discovered contact IDs to its idempotent cohort.",
    category: "workflows",
    schema: recordWorkflowRunContactsSchema,
    parameters: zodToParameters(recordWorkflowRunContactsSchema),
    execute: handleRecordWorkflowRunContacts,
  },
  query_content: {
    name: "query_content",
    description:
      "List content items. Filter by content type (post, thread, article, newsletter, dm, reply) or status.",
    category: "content",
    schema: queryContentSchema,
    parameters: zodToParameters(queryContentSchema),
    execute: handleQueryContent,
  },
  query_goals: {
    name: "query_goals",
    description: "List and filter goals by status or type.",
    category: "goals",
    schema: queryGoalsSchema,
    parameters: zodToParameters(queryGoalsSchema),
    execute: handleQueryGoals,
  },
  create_task: {
    name: "create_task",
    description: "Create a follow-up task, optionally linked to a contact.",
    category: "tasks",
    schema: createTaskSchema,
    parameters: zodToParameters(createTaskSchema),
    execute: handleCreateTask,
  },
  get_persona: {
    name: "get_persona",
    description:
      "Get the active AI persona for a contact (archetype, tone, interests, conversion triggers).",
    category: "contacts",
    schema: getPersonaSchema,
    parameters: zodToParameters(getPersonaSchema),
    execute: handleGetPersona,
  },
  upsert_persona: {
    name: "upsert_persona",
    description:
      "Save a new active persona for a contact; supersedes any previous active persona (versioned history).",
    category: "contacts",
    schema: upsertPersonaSchema,
    parameters: zodToParameters(upsertPersonaSchema),
    execute: handleUpsertPersona,
  },
  get_persona_evidence: {
    name: "get_persona_evidence",
    description:
      "Read the shared-scope evidence bundle used for persona synthesis (identities, content, interactions).",
    category: "contacts",
    schema: getPersonaEvidenceSchema,
    parameters: zodToParameters(getPersonaEvidenceSchema),
    execute: handleGetPersonaEvidence,
  },
  generate_persona: {
    name: "generate_persona",
    description:
      "Synthesize and persist a shared-scope persona using the globally configured structured-workflow or terminal-agent backend.",
    category: "contacts",
    schema: generatePersonaSchema,
    parameters: zodToParameters(generatePersonaSchema),
    execute: handleGeneratePersona,
  },
  get_persona_job: {
    name: "get_persona_job",
    description:
      "Read a PersonaAgentJob status and its evidence while the frozen evidence hash still matches.",
    category: "contacts",
    schema: getPersonaJobSchema,
    parameters: zodToParameters(getPersonaJobSchema),
    execute: handleGetPersonaJob,
  },
  complete_persona_job: {
    name: "complete_persona_job",
    description:
      "Submit the schema-validated synthesis or failure for one PersonaAgentJob callback.",
    category: "contacts",
    schema: completePersonaJobSchema,
    parameters: zodToParameters(completePersonaJobSchema),
    execute: handleCompletePersonaJob,
  },
  query_orgs: {
    name: "query_orgs",
    description: "Search organization nodes in the graph.",
    category: "graph",
    schema: queryOrgsSchema,
    parameters: zodToParameters(queryOrgsSchema),
    execute: handleQueryOrgs,
  },
  query_org_identities: {
    name: "query_org_identities",
    description: "List org platform identities with profile and stat fields.",
    category: "graph",
    schema: queryOrgIdentitiesSchema,
    parameters: zodToParameters(queryOrgIdentitiesSchema),
    execute: handleQueryOrgIdentities,
  },
  upsert_org_identity: {
    name: "upsert_org_identity",
    description:
      "Create or update an org platform identity. Cross-claim conflicts return a reassign error.",
    category: "graph",
    schema: upsertOrgIdentitySchema,
    parameters: zodToParameters(upsertOrgIdentitySchema),
    execute: handleUpsertOrgIdentity,
  },
  query_graph: {
    name: "query_graph",
    description: "Traverse 1-hop graph edges from a node. Private edges excluded unless includeLocalOnly is true.",
    category: "graph",
    schema: queryGraphSchema,
    parameters: zodToParameters(queryGraphSchema),
    execute: handleQueryGraph,
  },
  upsert_edge: {
    name: "upsert_edge",
    description: "Create or update a typed graph edge between two nodes.",
    category: "graph",
    schema: upsertEdgeSchema,
    parameters: zodToParameters(upsertEdgeSchema),
    execute: handleUpsertEdge,
  },
  log_interaction: {
    name: "log_interaction",
    description: "Append an interaction event for a contact (meetings, calls, messages, notes).",
    category: "graph",
    schema: logInteractionSchema,
    parameters: zodToParameters(logInteractionSchema),
    execute: handleLogInteraction,
  },
  query_niches: {
    name: "query_niches",
    description: "List or search niche clusters with member counts. Private niches excluded unless includeLocalOnly is true.",
    category: "graph",
    schema: queryNichesSchema,
    parameters: zodToParameters(queryNichesSchema),
    execute: handleQueryNiches,
  },
  upsert_niche: {
    name: "upsert_niche",
    description: "Create or update a niche cluster. Use upsert_edge with belongs_to_niche for membership.",
    category: "graph",
    schema: upsertNicheSchema,
    parameters: zodToParameters(upsertNicheSchema),
    execute: handleUpsertNiche,
  },
  query_launches: {
    name: "query_launches",
    description:
      "List GTM launches with variant summaries and linked goal IDs. Private launches excluded unless includeLocalOnly is true.",
    category: "graph",
    schema: queryLaunchesSchema,
    parameters: zodToParameters(queryLaunchesSchema),
    execute: handleQueryLaunches,
  },
  upsert_launch: {
    name: "upsert_launch",
    description: "Create or update a GTM launch by explicit id (insert when id omitted).",
    category: "graph",
    schema: upsertLaunchSchema,
    parameters: zodToParameters(upsertLaunchSchema),
    execute: handleUpsertLaunch,
  },
  upsert_variant: {
    name: "upsert_variant",
    description:
      "Create or update a creative variant under a launch. status:'published' routes through publishVariant. predicted_* fields are manual overrides; use create_simulation_run / complete_simulation_run for Wind Tunnel projections.",
    category: "graph",
    schema: upsertVariantSchema,
    parameters: zodToParameters(upsertVariantSchema),
    execute: handleUpsertVariant,
  },
  semantic_search: {
    name: "semantic_search",
    description:
      "Top-k semantic search over embedded graph nodes. Embeds the query via RealtimeX and searches local vectors.",
    category: "graph",
    schema: semanticSearchSchema,
    parameters: zodToParameters(semanticSearchSchema),
    execute: handleSemanticSearch,
  },
  create_simulation_run: {
    name: "create_simulation_run",
    description:
      "Create a Wind Tunnel simulation run for a variant, materialize a grounded agent population, and start the run atomically.",
    category: "graph",
    schema: createSimulationRunSchema,
    parameters: zodToParameters(createSimulationRunSchema),
    execute: handleCreateSimulationRun,
  },
  query_simulations: {
    name: "query_simulations",
    description:
      "List simulation run history and results by variant, launch, or batch. Transcripts are not included.",
    category: "graph",
    schema: querySimulationsSchema,
    parameters: zodToParameters(querySimulationsSchema),
    execute: handleQuerySimulations,
  },
  record_simulation_results: {
    name: "record_simulation_results",
    description:
      "Batch per-agent simulation outcomes for a running simulation run. Idempotent per agentId.",
    category: "graph",
    schema: recordSimulationResultsSchema,
    parameters: zodToParameters(recordSimulationResultsSchema),
    execute: handleRecordSimulationResults,
  },
  complete_simulation_run: {
    name: "complete_simulation_run",
    description:
      "Finish a simulation run and project latest predictions onto the parent variant when completed. status defaults to 'completed', which requires predictedScore (0–100), predictionConfidence (0–1), and predictedMetrics (engagement_metrics keyspace, e.g. { likes: 120 }). failed requires error; cancelled accepts optional error. Neither failed nor cancelled projects scores.",
    category: "graph",
    schema: completeSimulationRunSchema,
    parameters: completeSimulationRunParameters(),
    execute: handleCompleteSimulationRun,
  },
  calibrate_simulation_run: {
    name: "calibrate_simulation_run",
    description:
      "Compute predicted-vs-actual calibration for a completed simulation run on a published variant.",
    category: "graph",
    schema: calibrateSimulationRunSchema,
    parameters: zodToParameters(calibrateSimulationRunSchema),
    execute: handleCalibrateSimulationRun,
  },
  get_publish_job: {
    name: "get_publish_job",
    description:
      "Load a publish job snapshot (text, media paths, per-platform targets) for terminal-agent publishing.",
    category: "content",
    schema: getPublishJobSchema,
    parameters: zodToParameters(getPublishJobSchema),
    execute: handleGetPublishJob,
  },
  update_publish_job: {
    name: "update_publish_job",
    description:
      "Mark a publish job or platform target as publishing or failed before completion callbacks.",
    category: "content",
    schema: updatePublishJobSchema,
    parameters: zodToParameters(updatePublishJobSchema),
    execute: handleUpdatePublishJob,
  },
  complete_publish: {
    name: "complete_publish",
    description:
      "Record per-platform publish results for a terminal-agent job and update CRM bookkeeping.",
    category: "content",
    schema: completePublishSchema,
    parameters: zodToParameters(completePublishSchema),
    execute: handleCompletePublish,
  },
  list_mail_accounts: {
    name: "list_mail_accounts",
    description:
      "List configured Himalaya mail account aliases and emails. Agents send/read mail via Himalaya CLI with optional --account <alias>; default alias when unspecified.",
    category: "content",
    schema: listMailAccountsSchema,
    parameters: zodToParameters(listMailAccountsSchema),
    execute: handleListMailAccounts,
  },
  list_platform_targets: {
    name: "list_platform_targets",
    description:
      "List known X, LinkedIn, and Facebook acting targets and their browser connections.",
    category: "platforms",
    schema: listPlatformTargetsSchema,
    parameters: zodToParameters(listPlatformTargetsSchema),
    execute: handleListPlatformTargets,
  },
  get_platform_target: {
    name: "get_platform_target",
    description: "Get one platform target, its browser connection, and current lease state.",
    category: "platforms",
    schema: getPlatformTargetSchema,
    parameters: zodToParameters(getPlatformTargetSchema),
    execute: handleGetPlatformTarget,
  },
  prepare_platform_target: {
    name: "prepare_platform_target",
    description:
      "Acquire the target's browser-session lease, activate it, and verify the live identity before browsing or publishing.",
    category: "platforms",
    schema: preparePlatformTargetSchema,
    parameters: zodToParameters(preparePlatformTargetSchema),
    execute: handlePreparePlatformTarget,
  },
  release_platform_target: {
    name: "release_platform_target",
    description: "Release a browser-session lease returned by prepare_platform_target.",
    category: "platforms",
    schema: releasePlatformTargetSchema,
    parameters: zodToParameters(releasePlatformTargetSchema),
    execute: handleReleasePlatformTarget,
  },
};

export function listAgentToolsManifest() {
  return {
    version: AGENT_TOOL_VERSION,
    tools: Object.values(AGENT_TOOLS).map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      parameters: tool.parameters,
    })),
  };
}
