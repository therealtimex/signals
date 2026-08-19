import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildAgentToolsOpenApiDocument } from "@/lib/agent-tools/openapi-document";

describe("agent-tools openapi codegen", () => {
  it("builds OpenAPI document from registry manifest", () => {
    const document = buildAgentToolsOpenApiDocument();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/api/agent-tools"]).toBeDefined();
    expect(document.paths["/api/agent-tools/invoke"]).toBeDefined();
    expect(document["x-signals-agent-tools"].toolCount).toBeGreaterThan(10);

    if (process.env.GENERATE_AGENT_TOOLS_OPENAPI === "1") {
      const outPath =
        process.env.GENERATE_AGENT_TOOLS_OPENAPI_OUT_PATH ??
        path.join(process.cwd(), "openapi", "agent-tools.json");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
      console.log(`Wrote ${outPath}`);
    }
  });
});
