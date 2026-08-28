import { describe, expect, it } from "vitest";
import { buildNetworkSnowballTemplateConfig, readNetworkSnowballConfig } from "@/lib/workflows/network-snowball";
import { buildSnowballDialogRunConfig } from "./snowball-dialog-config";

describe("company Snowball dialog", () => {
  it("keeps the canonical company id in the launched run config", () => {
    const config = readNetworkSnowballConfig({
      ...buildNetworkSnowballTemplateConfig(), seedType: "org_id", seedValue: "Acme",
    });
    expect(buildSnowballDialogRunConfig(config, "org-123")).toMatchObject({
      orgId: "org-123", seedType: "org_id", seedValue: "Acme",
    });
  });
});
