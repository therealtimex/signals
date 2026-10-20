/**
 * Real-DB route regression for #549 (Review F2): a composed run shows the objective saved at
 * dispatch before the agent creates any launch, and a run from before #549 still shows none.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { buildContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import { normalizeAccountObjective } from "@/lib/writing/account-objective";
import { resetCoreTables } from "@/test/db";
import { GET } from "@/app/api/workflows/[id]/proposals/route";

function composedRun(extra: Record<string, unknown> = {}) {
  const template = createTemplate({
    name: "Contact Relationship Nurture",
    templateType: "nurture",
    status: "active",
    config: JSON.stringify(buildContactNurtureTemplateConfig()),
    isSystem: 1,
  });
  return createWorkflowRun({
    templateId: template.id,
    workflowType: "agent",
    config: JSON.stringify({ ...buildContactNurtureTemplateConfig(), ...extra }),
  });
}

async function get(runId: string) {
  const response = await GET(new Request("http://signals.local"), { params: Promise.resolve({ id: runId }) });
  return { status: response.status, body: await response.json() };
}

describe("GET /api/workflows/[id]/proposals — run objective before any launch (#549)", () => {
  beforeEach(() => resetCoreTables());

  it("projects the normalized objective from the run when no launch exists yet", async () => {
    // An inline brief with no mentions needs no workspace, so the route can observe it offline.
    const normalized = await normalizeAccountObjective({
      raw: { kind: "commercial", brief: { kind: "inline", text: "## Outcome\nBook an evaluation call.\n## Unknowns\n- Who owns onboarding" } },
      source: "run_config",
      resolveWorkspace: async () => { throw new Error("not needed"); },
    });
    if (!normalized.ok) throw new Error(normalized.reason);
    const run = composedRun({ accountObjective: normalized.objective });

    const { status, body } = await get(run.id);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      launches: [],
      proposals: [],
      summary: { total: 0, pendingReview: 0 },
      objective: {
        objectiveId: normalized.objective.objectiveId,
        kind: "commercial",
        parsed: { outcome: "Book an evaluation call.", unknowns: ["Who owns onboarding"] },
        limitations: ["offering_missing", "fit_missing", "success_missing"],
      },
      objectiveSource: { status: "current", changedPaths: [] },
    });
  });

  it("still projects no objective for a composed run from before #549", async () => {
    const { body } = await get(composedRun().id);
    expect(body).toMatchObject({ objective: null, objectiveSource: null, proposals: [] });
  });
});
