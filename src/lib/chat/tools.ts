import { tool } from "ai";
import { z } from "zod";
import { listContacts, getContactById, createContact } from "@/lib/db/queries/contacts";
import { getDashboardMetrics } from "@/lib/db/queries/dashboard";
import { listWorkflowRuns } from "@/lib/db/queries/workflows";
import { listTemplates } from "@/lib/db/queries/workflow-templates";
import { listContentItems } from "@/lib/db/queries/content";
import { listGoals } from "@/lib/db/queries/goals";
import { createTask } from "@/lib/db/queries/tasks";
import { startAgentWorkflow } from "@/lib/agents/run-agent-workflow";
import type { WorkflowType } from "@/lib/workflows/types";

const MAX_RESULTS = 20;

/**
 * 8 CRM tools for the chat assistant.
 * Each wraps existing sync query functions in async execute wrappers.
 */
export const chatTools = {
  query_contacts: tool({
    description:
      "Search and filter contacts by name, email, company, funnel stage, or platform. Returns up to 20 contacts with key fields.",
    inputSchema: z.object({
      search: z.string().optional().describe("Search by name or email"),
      funnelStage: z
        .enum(["prospect", "engaged", "qualified", "opportunity", "customer", "advocate"])
        .optional()
        .describe("Filter by funnel stage"),
      platform: z
        .enum(["x", "linkedin", "gmail", "substack"])
        .optional()
        .describe("Filter by platform"),
    }),
    execute: async ({ search, funnelStage, platform }) => {
      const result = listContacts({
        search,
        funnelStage,
        platform,
        pageSize: MAX_RESULTS,
      });

      return {
        total: result.total,
        contacts: result.data.map((c) => ({
          id: c.id,
          name: c.name,
          company: c.company,
          title: c.title,
          email: c.email,
          score: c.enrichmentScore,
          stage: c.funnelStage,
          platform: c.platform,
          identityCount: c.identities.length,
        })),
      };
    },
  }),

  get_contact: tool({
    description:
      "Get full details for a single contact by ID, including all linked identities.",
    inputSchema: z.object({
      contactId: z.string().describe("The contact ID"),
    }),
    execute: async ({ contactId }) => {
      const contact = getContactById(contactId);
      if (!contact) {
        return { error: `Contact not found: ${contactId}` };
      }

      return {
        id: contact.id,
        name: contact.name,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        company: contact.company,
        title: contact.title,
        headline: contact.headline,
        bio: contact.bio,
        location: contact.location,
        website: contact.website,
        platform: contact.platform,
        funnelStage: contact.funnelStage,
        enrichmentScore: contact.enrichmentScore,
        tags: contact.tags,
        identities: contact.identities.map((id) => ({
          platform: id.platform,
          handle: id.platformHandle,
          profileUrl: id.platformUrl,
        })),
      };
    },
  }),

  query_analytics: tool({
    description:
      "Get CRM dashboard metrics: total contacts, active workflows, pending tasks, and content count.",
    inputSchema: z.object({}),
    execute: async () => {
      const metrics = getDashboardMetrics();
      return {
        totalContacts: metrics.totalContacts,
        activeWorkflows: metrics.activeWorkflows,
        pendingTasks: metrics.pendingTasks,
        contentItems: metrics.contentItems,
        recentContacts: metrics.recentContacts.map((c) => ({
          id: c.id,
          name: c.name,
          company: c.company,
          score: c.enrichmentScore,
        })),
      };
    },
  }),

  query_workflows: tool({
    description:
      "List automation runs. Filter by type (sync, enrich, search, prune, sequence, agent, simulate, calibrate) or status.",
    inputSchema: z.object({
      workflowType: z
        .enum(["sync", "enrich", "search", "prune", "sequence", "agent", "simulate", "calibrate"])
        .optional()
        .describe("Filter by workflow type"),
      status: z
        .enum(["pending", "running", "paused", "completed", "failed", "cancelled"])
        .optional()
        .describe("Filter by status"),
    }),
    execute: async ({ workflowType, status }) => {
      const result = listWorkflowRuns({
        workflowType: workflowType as WorkflowType | undefined,
        status,
        pageSize: MAX_RESULTS,
      });

      return {
        total: result.total,
        runs: result.data.map((r) => ({
          id: r.id,
          type: r.workflowType,
          status: r.status,
          trigger: r.trigger,
          model: r.model,
          processedItems: r.processedItems,
          successItems: r.successItems,
          errorItems: r.errorItems,
          costUsd: r.costUsd,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
        })),
      };
    },
  }),

  query_content: tool({
    description:
      "List content items. Filter by content type (post, thread, article, newsletter, dm, reply) or status.",
    inputSchema: z.object({
      contentType: z
        .enum(["post", "thread", "article", "newsletter", "dm", "reply"])
        .optional()
        .describe("Filter by content type"),
      status: z
        .enum(["draft", "scheduled", "published", "archived"])
        .optional()
        .describe("Filter by status"),
    }),
    execute: async ({ contentType, status }) => {
      const result = listContentItems({
        contentType,
        status,
        pageSize: MAX_RESULTS,
      });

      return {
        total: result.total,
        items: result.data.map((item) => ({
          id: item.id,
          title: item.title,
          contentType: item.contentType,
          status: item.status,
          origin: item.origin,
          body: item.body ? item.body.slice(0, 200) : null,
          publishedAt: item.post?.publishedAt ?? null,
        })),
      };
    },
  }),

  create_contact: tool({
    description:
      "Create a new contact record. At minimum a name is required.",
    inputSchema: z.object({
      name: z.string().describe("Full name of the contact"),
      email: z.string().optional().describe("Email address"),
      company: z.string().optional().describe("Company name"),
      title: z.string().optional().describe("Job title"),
      platform: z
        .enum(["x", "linkedin", "gmail", "substack"])
        .optional()
        .describe("Primary platform"),
      funnelStage: z
        .enum(["prospect", "engaged", "qualified", "opportunity", "customer", "advocate"])
        .optional()
        .describe("Funnel stage (defaults to prospect)"),
    }),
    execute: async ({ name, email, company, title, platform, funnelStage }) => {
      const contact = createContact({
        name,
        email: email ?? null,
        company: company ?? null,
        title: title ?? null,
        platform: platform ?? "x",
        funnelStage: funnelStage ?? "prospect",
      });

      return {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        company: contact.company,
        enrichmentScore: contact.enrichmentScore,
        message: `Contact "${contact.name}" created successfully.`,
      };
    },
  }),

  create_task: tool({
    description:
      "Create a follow-up task, optionally linked to a contact.",
    inputSchema: z.object({
      title: z.string().describe("Task title"),
      description: z.string().optional().describe("Task details"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .optional()
        .describe("Priority level (defaults to medium)"),
      dueDate: z
        .number()
        .optional()
        .describe("Due date as Unix timestamp in seconds"),
      relatedContactId: z
        .string()
        .optional()
        .describe("Contact ID to link this task to"),
    }),
    execute: async ({ title, description, priority, dueDate, relatedContactId }) => {
      const task = createTask({
        title,
        description: description ?? null,
        priority: priority ?? "medium",
        dueAt: dueDate ?? null,
        relatedContactId: relatedContactId ?? null,
        assignee: "user",
      });

      return {
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        message: `Task "${task.title}" created successfully.`,
      };
    },
  }),

  start_workflow: tool({
    description:
      "Start an agent from a template. Lists available agents if no templateId given, otherwise starts a run.",
    inputSchema: z.object({
      templateId: z
        .string()
        .optional()
        .describe("Agent template ID to run. Omit to list available agents."),
      workflowType: z
        .enum(["search", "enrich", "prune", "agent"])
        .optional()
        .describe("Workflow type (defaults to agent)"),
    }),
    execute: async ({ templateId, workflowType }) => {
      // If no templateId, list available templates
      if (!templateId) {
        const templates = listTemplates({ status: "active", pageSize: MAX_RESULTS });
        return {
          message: "Here are the available agents. Provide a templateId to start one.",
          templates: templates.data.map((t) => ({
            id: t.id,
            name: t.name,
            type: t.templateType,
            description: t.description,
          })),
        };
      }

      const run = startAgentWorkflow({
        templateId,
        workflowType: (workflowType as WorkflowType) ?? "agent",
      });

      return {
        runId: run.id,
        status: run.status,
        workflowType: run.workflowType,
        message: `Workflow started. Run ID: ${run.id}`,
      };
    },
  }),

  query_goals: tool({
    description:
      "List and filter goals by status or type. Returns up to 20 goals with progress.",
    inputSchema: z.object({
      status: z
        .enum(["active", "achieved", "missed", "paused"])
        .optional()
        .describe("Filter by goal status"),
      goalType: z
        .enum(["audience_growth", "lead_generation", "content_engagement", "pipeline_progression"])
        .optional()
        .describe("Filter by goal type"),
    }),
    execute: async ({ status, goalType }) => {
      const result = listGoals({
        status,
        goalType,
        pageSize: MAX_RESULTS,
      });

      return {
        total: result.total,
        goals: result.data.map((g) => ({
          id: g.id,
          name: g.name,
          goalType: g.goalType,
          targetValue: g.targetValue,
          currentValue: g.currentValue,
          unit: g.unit,
          status: g.status,
          deadline: g.deadline,
        })),
      };
    },
  }),
};
