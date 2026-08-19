import { describe, expect, it } from "vitest";
import { buildAgentToolsOpenApiDocument } from "@/lib/agent-tools/openapi-document";

describe("openapi-document", () => {
  it("wraps agent-tools manifest and invoke paths", () => {
    const document = buildAgentToolsOpenApiDocument("http://localhost:3010");
    expect(document.servers[0].url).toBe("http://localhost:3010");
    expect(document.paths["/api/health"]?.get).toBeDefined();
    expect(document.paths["/api/agent-tools"]?.get).toBeDefined();
    expect(document.paths["/api/agent-tools/invoke"]?.post).toBeDefined();
    expect(document["x-signals-agent-tools"].toolCount).toBeGreaterThan(10);
  });
});
