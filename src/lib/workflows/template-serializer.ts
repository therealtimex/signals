import type { WorkflowTemplate } from "@/lib/db/types";

export type TemplateForUi = Omit<WorkflowTemplate, "estimatedCost">;

export function serializeTemplateForUi(template: WorkflowTemplate): TemplateForUi {
  const { estimatedCost: _estimatedCost, ...rest } = template;
  return rest;
}

export function serializeTemplatesForUi(templates: WorkflowTemplate[]): TemplateForUi[] {
  return templates.map(serializeTemplateForUi);
}
