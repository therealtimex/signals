import {
  archiveContactSchema,
  createContactSchema,
  createTaskSchema,
  enrichContactSchema,
  getContactSchema,
  listWorkflowTemplatesSchema,
  queryAnalyticsSchema,
  queryContactsSchema,
  queryContentSchema,
  queryGoalsSchema,
  queryWorkflowsSchema,
  startWorkflowSchema,
  updateContactSchema,
} from "@/lib/agent-tools/schemas";
import {
  handleArchiveContact,
  handleCreateContact,
  handleCreateTask,
  handleEnrichContact,
  handleGetContact,
  handleListWorkflowTemplates,
  handleQueryAnalytics,
  handleQueryContacts,
  handleQueryContent,
  handleQueryGoals,
  handleQueryWorkflows,
  handleStartWorkflow,
  handleUpdateContact,
} from "@/lib/agent-tools/handlers";
import { zodToParameters } from "@/lib/agent-tools/json-schema";
import type { AgentToolDefinition } from "@/lib/agent-tools/types";

export const AGENT_TOOL_VERSION = "1";

export const AGENT_TOOLS: Record<string, AgentToolDefinition> = {
  query_contacts: {
    name: "query_contacts",
    description:
      "Search and filter contacts by name, email, company, funnel stage, or platform.",
    category: "contacts",
    schema: queryContactsSchema,
    parameters: zodToParameters(queryContactsSchema),
    execute: handleQueryContacts,
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
  archive_contact: {
    name: "archive_contact",
    description: "Archive a contact with a reason.",
    category: "contacts",
    schema: archiveContactSchema,
    parameters: zodToParameters(archiveContactSchema),
    execute: handleArchiveContact,
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
