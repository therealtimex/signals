import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  open: vi.fn(),
  resolveContext: vi.fn(),
  readFiles: vi.fn(),
}));

vi.mock("@/lib/personality/editor-handoff", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/personality/editor-handoff")
  >();
  return {
    ...actual,
    probePersonalityEditorCapability: mocks.probe,
    openWorkspacePersonalityEditor: mocks.open,
  };
});

vi.mock("@/lib/personality/workspace", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/personality/workspace")
  >();
  return {
    ...actual,
    resolvePersonalityWorkspaceContext: mocks.resolveContext,
    readPersonalityWorkspaceFiles: mocks.readFiles,
  };
});

import { GET, POST } from "@/app/api/personality/onboarding/route";

const roots: string[] = [];
const limits = {
  maxTaskPromptChars: 24_000,
  maxAttachmentCount: 12,
  maxAttachmentBytes: 10 * 1024 * 1024,
  maxTotalAttachmentBytes: 25 * 1024 * 1024,
};

function context() {
  const root = mkdtempSync(join(tmpdir(), "signals-onboarding-route-"));
  roots.push(root);
  const dir = join(root, "working-data", "signals");
  mkdirSync(dir, { recursive: true });
  return {
    displayName: "Signals GTM",
    workspace: { id: "42", slug: "signals", dir, key: "workspace-key" },
  };
}

beforeEach(() => {
  mocks.probe.mockReset();
  mocks.open.mockReset();
  mocks.resolveContext.mockReset();
  mocks.readFiles.mockReset();
  mocks.probe.mockResolvedValue({ state: "available", version: 1, limits });
  mocks.resolveContext.mockImplementation(async () => context());
  mocks.readFiles.mockReturnValue([
    { path: "IDENTITY.md", content: null, fileHash: null, size: 0 },
    { path: "SOUL.md", content: null, fileHash: null, size: 0 },
    { path: "VOICE.md", content: null, fileHash: null, size: 0 },
    { path: "BRAND.md", content: null, fileHash: null, size: 0 },
    { path: "AGENTS.md", content: "# Agents", fileHash: "hash", size: 8 },
  ]);
  mocks.open.mockImplementation(async (input) => ({
    success: true,
    accepted: true,
    requestId: input.requestId,
    replayed: false,
    workspace: { id: 42, slug: "signals" },
    sessionId: "session-1",
    limits,
  }));
});

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("Personality onboarding route", () => {
  it("opens only when all four social Personality files are absent", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace: { id: "42", slug: "signals", displayName: "Signals GTM" },
      personality: { present: false, files: [] },
      shouldOnboard: true,
      editor: { state: "available" },
    });

    mocks.readFiles.mockReturnValue([
      { path: "IDENTITY.md", content: "# Me", fileHash: "hash", size: 4 },
    ]);
    await expect(GET().then((result) => result.json())).resolves.toMatchObject({
      personality: { present: true, files: ["IDENTITY.md"] },
      shouldOnboard: false,
    });
  });

  it("stages files and calls the host with server-resolved workspace identity", async () => {
    const formData = new FormData();
    formData.set("requestId", "signals-personality-request-1");
    formData.set("brief", "I build tools for revenue teams. https://example.com");
    formData.append(
      "files",
      new File(["company facts"], "company.md", { type: "text/markdown" }),
    );
    const response = await POST(
      new Request("http://localhost/api/personality/onboarding", {
        method: "POST",
        body: formData,
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "signals-personality-request-1",
        workspace: expect.objectContaining({ id: "42", slug: "signals" }),
        taskPrompt: expect.stringContaining("https://example.com"),
        attachmentPaths: [
          ".signals/personality-onboarding/signals-personality-request-1/attachments/01-company.md",
        ],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      sessionId: "session-1",
      workspace: { id: "42", slug: "signals" },
    });
  });

  it("fails before staging when the host capability is unavailable", async () => {
    mocks.probe.mockResolvedValue({
      state: "not_granted",
      version: 1,
      limits,
      reason: "permission_not_granted",
    });
    const formData = new FormData();
    formData.set("requestId", "signals-personality-request-1");
    formData.set("brief", "Context");
    const response = await POST(
      new Request("http://localhost/api/personality/onboarding", {
        method: "POST",
        body: formData,
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "PERSONALITY_EDITOR_UNAVAILABLE",
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("honors stricter attachment limits advertised by the host", async () => {
    mocks.probe.mockResolvedValue({
      state: "available",
      version: 1,
      limits: {
        ...limits,
        maxAttachmentBytes: 4,
        maxTotalAttachmentBytes: 4,
      },
    });
    const formData = new FormData();
    formData.set("requestId", "signals-personality-request-1");
    formData.set("brief", "Context");
    formData.append(
      "files",
      new File(["company facts"], "company.md", { type: "text/markdown" }),
    );

    const response = await POST(
      new Request("http://localhost/api/personality/onboarding", {
        method: "POST",
        body: formData,
      }),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "ATTACHMENT_TOO_LARGE",
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
