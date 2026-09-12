import { getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { parseTemplateConfig } from "@/lib/workflows/template-config";
import { isNetworkSnowballTemplateConfig } from "@/lib/workflows/network-snowball";
import { isSupportedLumaUrl } from "@/lib/workflows/event-sources/urls";

/**
 * Bind a Hop 0 seed organization onto a Network Snowball run.
 *
 * The org page snowball card and run-subject list both read `config.orgId`. When the
 * agent ingests the featured company via `create_org` (or hits a domain CONFLICT and
 * reuses that company), stamp the id once so later hops have a durable graph anchor.
 * An existing `orgId` — including launches from the company page — is left unchanged.
 */
export function attachNetworkSnowballHop0Org(
  workflowRunId: string | undefined,
  orgId: string,
  observedRole?: "organized_by",
): void {
  const runId = workflowRunId?.trim();
  const hop0OrgId = orgId.trim();
  if (!runId || !hop0OrgId) return;

  const run = getWorkflowRun(runId);
  if (!run) return;

  const config = parseTemplateConfig(run.config);
  if (!isNetworkSnowballTemplateConfig(config)) return;

  // A generic create_org call during an event run is not proof that the new row is
  // the organizer. Public event ingestion retains explicit roles separately, so a
  // Luma seed can become Hop 0 only from an observed organized_by relationship.
  if (
    typeof config.seedValue === "string" &&
    isSupportedLumaUrl(config.seedValue) &&
    observedRole !== "organized_by"
  ) {
    return;
  }

  const existing = typeof config.orgId === "string" ? config.orgId.trim() : "";
  if (existing) return;

  updateWorkflowRun(run.id, {
    config: JSON.stringify({ ...config, orgId: hop0OrgId }),
  });
}
