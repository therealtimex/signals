import { describe, expect, it, vi } from "vitest";
import {
  openWorkspacePersonalityEditor,
  probePersonalityEditorCapability,
} from "@/lib/personality/editor-handoff";
import type { PersonalityWorkspace } from "@/lib/personality/workspace";

const env = {
  RTX_APP_ID: "signals-app",
  RTX_API_BASE_URL: "http://rtx.test",
};

const workspace: PersonalityWorkspace = {
  id: "42",
  slug: "signals",
  dir: "/safe/working-data/signals",
  key: "workspace-key",
};

const limits = {
  maxTaskPromptChars: 24_000,
  maxAttachmentCount: 12,
  maxAttachmentBytes: 10 * 1024 * 1024,
  maxTotalAttachmentBytes: 25 * 1024 * 1024,
};

function capability(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    apiVersion: 1,
    capabilities: {
      "desktop.workspace-personality-editor": {
        version: 1,
        endpoint: "/sdk/desktop/workspace-personality-editor",
        permissions: [
          "desktop.runtime-sessions",
          "workspace.personality.write",
        ],
        granted: true,
        limits,
        ...overrides,
      },
    },
  };
}

describe("Personality editor host handoff", () => {
  it("negotiates the exact bounded capability", async () => {
    const availableFetch = vi.fn(async () =>
      new Response(JSON.stringify(capability()), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      probePersonalityEditorCapability({ env, fetchImpl: availableFetch }),
    ).resolves.toMatchObject({ state: "available", version: 1, limits });

    const deniedFetch = vi.fn(async () =>
      new Response(JSON.stringify(capability({ granted: false })), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    await expect(
      probePersonalityEditorCapability({ env, fetchImpl: deniedFetch }),
    ).resolves.toMatchObject({
      state: "not_granted",
      reason: "permission_not_granted",
    });

    const genericRouterFetch = vi.fn(async () =>
      new Response(
        JSON.stringify(capability({ endpoint: "/sdk/desktop/open-route" })),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    await expect(
      probePersonalityEditorCapability({ env, fetchImpl: genericRouterFetch }),
    ).resolves.toMatchObject({
      state: "unsupported",
      reason: "incompatible_contract",
    });
  });

  it("sends the server-resolved workspace and preserves idempotency", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        "content-type": "application/json",
        "x-app-id": "signals-app",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        requestId: "signals-personality-request-1",
        workspaceId: "42",
        workspaceSlug: "signals",
        taskPrompt: "Build my Personality.",
        attachmentPaths: [
          ".signals/personality-onboarding/signals-personality-request-1/attachments/01-about.pdf",
        ],
      });
      return new Response(
        JSON.stringify({
          success: true,
          accepted: true,
          requestId: "signals-personality-request-1",
          replayed: false,
          workspace: { id: 42, slug: "signals" },
          sessionId: "terminal-session-1",
          limits,
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await expect(
      openWorkspacePersonalityEditor(
        {
          requestId: "signals-personality-request-1",
          workspace,
          taskPrompt: "Build my Personality.",
          attachmentPaths: [
            ".signals/personality-onboarding/signals-personality-request-1/attachments/01-about.pdf",
          ],
        },
        { env, fetchImpl },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      sessionId: "terminal-session-1",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://rtx.test/sdk/desktop/workspace-personality-editor",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects an acknowledgement for another workspace", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          accepted: true,
          requestId: "signals-personality-request-1",
          replayed: false,
          workspace: { id: 99, slug: "other" },
          sessionId: null,
          limits,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    await expect(
      openWorkspacePersonalityEditor(
        {
          requestId: "signals-personality-request-1",
          workspace,
          taskPrompt: "Build my Personality.",
          attachmentPaths: [],
        },
        { env, fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "WORKSPACE_MISMATCH", status: 409 });
  });
});
