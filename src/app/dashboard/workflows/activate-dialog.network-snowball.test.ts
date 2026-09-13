// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivateDialog } from "@/app/dashboard/workflows/activate-dialog";
import { buildNetworkSnowballTemplateConfig } from "@/lib/workflows/network-snowball";

function template(input?: { seedValue?: string; participantEnabled?: boolean; sessionName?: string }) {
  return {
    id: "tpl-snowball",
    name: "Network Snowball",
    description: "Map a network",
    templateType: "prospecting",
    systemPrompt: null,
    targetPersona: null,
    config: JSON.stringify({
      ...buildNetworkSnowballTemplateConfig(),
      seedValue: input?.seedValue ?? "https://luma.com/build-night",
      participantAccess: {
        enabled: input?.participantEnabled ?? false,
        browserSessionName: input?.sessionName ?? "signals-publish",
      },
    }),
  };
}

function previewResponse(provider: "luma" | "generic" = "luma") {
  const luma = provider === "luma";
  return new Response(JSON.stringify({
    preview: {
      resolvedSource: {
        version: 1,
        canonicalUrl: luma ? "https://luma.com/build-night" : "https://metr.org/about",
        provider,
        kind: luma ? "event" : "organization",
        classification: { basis: "metadata", confidence: "high" },
        capabilities: {
          publicRead: true,
          signedInRead: luma,
          participantExpansion: luma,
        },
      },
      accessPlan: {
        mode: "public_only",
        signedInRequested: false,
        signedInSupported: luma,
        reason: null,
      },
      publicSource: null,
      errors: [],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("ActivateDialog Network Snowball launch contract", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("resets a saved registered-access opt-in and blocks launch while preview is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => previewResponse()));
    await act(async () => root.render(createElement(ActivateDialog, {
      template: template({ participantEnabled: true }),
      open: true,
      onClose: () => undefined,
    })));
    const checkbox = document.body.querySelector("#snowball-participant-access") as HTMLButtonElement;
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(document.body.textContent).not.toContain("Existing browser session");
    const pendingButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Checking source"),
    );
    expect(pendingButton?.disabled).toBe(true);
  });

  it("allows a safe public-only source only after its server preview is displayed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("source-sessions")) {
        return new Response(JSON.stringify({
          sessions: [],
          crmTarget: {
            platform: "linkedin",
            sessionName: "crm-linkedin",
            identity: "/in/crm-writer",
            verification: "previously_verified",
            lastVerifiedAt: 1_700_000_000,
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return previewResponse("generic");
    }));
    await act(async () => root.render(createElement(ActivateDialog, {
      template: template({ seedValue: "https://metr.org/about" }),
      open: true,
      onClose: () => undefined,
    })));
    await act(async () => vi.advanceTimersByTimeAsync(451));
    expect(document.body.textContent).toContain("Generic");
    expect(document.body.textContent).toContain("Public-only source");
    expect(document.body.textContent).toContain("CRM write identity (separate)");
    expect(document.body.textContent).toContain("/in/crm-writer");
    expect(document.body.textContent).toContain("crm-linkedin");
    const runButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Run Agent"),
    );
    expect(runButton?.disabled).toBe(false);
  });

  it("blocks a missing source session and discloses the independent CRM identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("source-sessions")) {
        return new Response(JSON.stringify({
          sessions: [{
            sessionName: "running-luma",
            running: true,
            sourceIdentity: null,
            identityVerification: "checked_at_launch",
          }],
          crmTarget: {
            platform: "linkedin",
            sessionName: "crm-linkedin",
            identity: "/in/crm-writer",
            verification: "previously_verified",
            lastVerifiedAt: 1_700_000_000,
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return previewResponse();
    }));
    await act(async () => root.render(createElement(ActivateDialog, {
      template: template({ sessionName: "stopped-luma" }),
      open: true,
      onClose: () => undefined,
    })));
    await act(async () => vi.advanceTimersByTimeAsync(451));
    const checkbox = document.body.querySelector("#snowball-participant-access") as HTMLButtonElement;
    await act(async () => checkbox.click());
    await act(async () => Promise.resolve());

    expect(document.body.textContent).toContain("previously selected session is no longer running");
    expect(document.body.textContent).toContain("Source identity verification");
    expect(document.body.textContent).toContain("Not checked yet");
    expect(document.body.textContent).toContain("CRM write identity (separate)");
    expect(document.body.textContent).toContain("/in/crm-writer");
    expect(document.body.textContent).toContain("crm-linkedin");
    const blockedButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Select running session"),
    );
    expect(blockedButton?.disabled).toBe(true);
  });
});
