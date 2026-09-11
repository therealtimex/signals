import { beforeEach, describe, expect, it } from "vitest";
import { createOrg } from "@/lib/db/queries/orgs";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";
import {
  buildNetworkSnowballRunConfig,
  readNetworkSnowballConfig,
} from "@/lib/workflows/network-snowball";
import { attachNetworkSnowballHop0Org } from "@/lib/workflows/network-snowball-hop0";
import { parseTemplateConfig } from "@/lib/workflows/template-config";

function createSnowballRun(configOverrides: Record<string, unknown> = {}) {
  const config = {
    ...buildNetworkSnowballRunConfig(readNetworkSnowballConfig({
      seedType: "event_url",
      seedValue: "https://x.com/acme/status/1",
    })),
    ...configOverrides,
  };
  const template = createTemplate({
    name: "Network Snowball",
    templateType: "prospecting",
    status: "active",
    config: JSON.stringify(config),
  });
  return createWorkflowRun({
    templateId: template.id,
    workflowType: "search",
    status: "running",
    trigger: "template",
    config: JSON.stringify(config),
  });
}

describe("attachNetworkSnowballHop0Org", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("stamps orgId onto a snowball run that has none", () => {
    const run = createSnowballRun();
    const org = createOrg({ name: "Kepler Computing" });

    attachNetworkSnowballHop0Org(run.id, org.id);

    const updated = getWorkflowRun(run.id);
    expect(parseTemplateConfig(updated?.config).orgId).toBe(org.id);
  });

  it("leaves an existing company-page orgId unchanged", () => {
    const run = createSnowballRun({ orgId: "org_existing" });
    const org = createOrg({ name: "Other Co" });

    attachNetworkSnowballHop0Org(run.id, org.id);

    expect(parseTemplateConfig(getWorkflowRun(run.id)?.config).orgId).toBe("org_existing");
  });

  it("ignores non-snowball runs", () => {
    const run = createWorkflowRun({
      workflowType: "enrich",
      status: "running",
      trigger: "template",
      config: JSON.stringify({ contactId: "c-1" }),
    });
    const org = createOrg({ name: "Ignored Co" });

    attachNetworkSnowballHop0Org(run.id, org.id);

    expect(parseTemplateConfig(getWorkflowRun(run.id)?.config).orgId).toBeUndefined();
  });
});
