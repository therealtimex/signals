import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentToolError } from "@/lib/agent-tools/types";
import { COMMERCIAL_BRIEF, PRODUCTS_FIXTURE } from "@/test/account-objective-fixture";

const workspaceState = vi.hoisted(() => ({
  dir: "",
  available: true,
}));

vi.mock("@/lib/personality/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/personality/workspace")>()),
  resolvePersonalityWorkspace: vi.fn(async () => {
    if (!workspaceState.available) {
      throw new AgentToolError("WORKSPACE_UNAVAILABLE", "RealTimeX workspace identity is not configured");
    }
    return { slug: "signals", id: "workspace-test", dir: workspaceState.dir, key: "test" };
  }),
}));

const { GET: listBriefs } = await import("@/app/api/objectives/route");
const { GET: getBrief, PUT: putBrief } = await import("@/app/api/objectives/[name]/route");
const { POST: preview } = await import("@/app/api/objectives/preview/route");
const { GET: mentions } = await import("@/app/api/objectives/mentions/route");

function params(name: string) {
  return { params: Promise.resolve({ name }) };
}

function put(name: string, body: unknown) {
  return putBrief(
    new Request(`http://localhost/api/objectives/${name}`, { method: "PUT", body: JSON.stringify(body) }),
    params(name),
  );
}

beforeEach(() => {
  workspaceState.dir = mkdtempSync(join(tmpdir(), "signals-objectives-routes-"));
  workspaceState.available = true;
  writeFileSync(join(workspaceState.dir, "PRODUCTS.md"), PRODUCTS_FIXTURE);
});

afterEach(() => {
  rmSync(workspaceState.dir, { recursive: true, force: true });
});

describe("/api/objectives", () => {
  it("saves, lists and reads a brief, and refuses an existing name with objective_exists", async () => {
    const created = await put("eng-founders", { text: COMMERCIAL_BRIEF });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      brief: { name: "eng-founders", path: "objectives/eng-founders.md", outcome: expect.stringContaining("20-minute evaluation") },
    });

    const conflict = await put("eng-founders", { text: "## Outcome\nReplacement." });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ errorCode: "objective_exists" });
    expect(readFileSync(join(workspaceState.dir, "objectives", "eng-founders.md"), "utf8")).toBe(COMMERCIAL_BRIEF);

    const listed = await (await listBriefs()).json();
    expect(listed.briefs).toEqual([expect.objectContaining({ name: "eng-founders", path: "objectives/eng-founders.md" })]);

    const read = await getBrief(new Request("http://localhost"), params("eng-founders"));
    expect(await read.json()).toMatchObject({ name: "eng-founders", text: COMMERCIAL_BRIEF });
  });

  it("refuses names outside the grammar and reports a missing brief", async () => {
    for (const name of ["Upper", "..", "preview", "a"]) {
      const response = await put(name, { text: "## Outcome\nx" });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ errorCode: "invalid_name" });
    }
    const missing = await getBrief(new Request("http://localhost"), params("absent-brief"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ errorCode: "objective_not_found" });
  });

  it("previews a brief without dispatching", async () => {
    const response = await preview(new Request("http://localhost/api/objectives/preview", {
      method: "POST",
      body: JSON.stringify({ text: COMMERCIAL_BRIEF }),
    }));
    expect(await response.json()).toMatchObject({
      parsed: { unknowns: ["Whether they use a coding agent today"] },
      offering: { slug: "engineering-workflow", proofPointCount: 2 },
      workspace: "available",
    });
  });

  it("lists mention targets and answers 503 when the workspace is unavailable", async () => {
    const listed = await (await mentions()).json();
    expect(listed).toMatchObject({
      products: [expect.objectContaining({ slug: "engineering-workflow" }), expect.objectContaining({ slug: "bare-offering" })],
      productsFile: "present",
    });

    workspaceState.available = false;
    const unavailable = await mentions();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: "WORKSPACE_UNAVAILABLE" });
    expect((await listBriefs()).status).toBe(503);
  });
});
