import { listWorkflowRuns } from "@/lib/db/queries/workflows";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import { AutomationTabs } from "./automation-tabs";
import type { WorkflowRun } from "@/lib/db/types";

/**
 * Enrich runs with templateName + templateCategory in config for display.
 * Older runs created before the injection fix won't have these fields,
 * so we batch-resolve from templateId on the server side.
 */
function enrichRunsWithTemplateData(runs: WorkflowRun[]): WorkflowRun[] {
  const templateCache = new Map<string, { name: string; category: string }>();

  return runs.map((run) => {
    // Check if config already has both fields
    try {
      const config = JSON.parse(run.config ?? "{}");
      if (config.templateName && config.templateCategory) return run;
    } catch { /* proceed to enrich */ }

    // Resolve from templateId
    if (!run.templateId) return run;

    let cached = templateCache.get(run.templateId);
    if (!cached) {
      const tmpl = getTemplate(run.templateId);
      cached = { name: tmpl?.name ?? "", category: tmpl?.templateType ?? "" };
      templateCache.set(run.templateId, cached);
    }
    if (!cached.name) return run;

    // Inject into config JSON
    try {
      const config = JSON.parse(run.config ?? "{}");
      if (!config.templateName) config.templateName = cached.name;
      if (!config.templateCategory) config.templateCategory = cached.category;
      return { ...run, config: JSON.stringify(config) };
    } catch {
      return run;
    }
  });
}

export default function WorkflowsPage() {
  const result = listWorkflowRuns({ pageSize: 100 });
  const enrichedRuns = enrichRunsWithTemplateData(result.data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Automation</h1>
        <p className="text-muted-foreground mt-1">
          Workflows for platform sync, file imports, and agent templates — with run history. Execution is driven by RealTimeX agents.
        </p>
      </div>

      <AutomationTabs runs={enrichedRuns} totalRuns={result.total} />
    </div>
  );
}
