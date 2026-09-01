// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalityTab } from "@/app/dashboard/settings/personality-tab";

const onboarding = {
  success: true,
  workspace: {
    id: "42",
    slug: "signals",
    displayName: "Signals GTM",
    path: "/safe/working-data/signals",
  },
  personality: { present: true, files: ["IDENTITY.md"] },
  editor: {
    state: "available",
    version: 1,
    limits: {
      maxTaskPromptChars: 24_000,
      maxAttachmentCount: 12,
      maxAttachmentBytes: 10 * 1024 * 1024,
      maxTotalAttachmentBytes: 25 * 1024 * 1024,
    },
  },
  shouldOnboard: false,
};

const binding = {
  status: {
    workspace: { slug: "signals", dir: "/safe/working-data/signals" },
    binding: {
      id: "pb_active01",
      sourceHash: "a".repeat(64),
      personalityHash: "b".repeat(64),
      appliedAt: 1_788_000_000,
      identity: { selfContactId: "contact-self", representedOrgId: "org-own" },
      files: [],
    },
    currentSourceHash: "c".repeat(64),
    status: "drifted",
    detail: {
      sourceStale: { voice: true },
      drifted: [{ path: "IDENTITY.md", reason: "unmanaged_edited" }],
    },
    compatibleTargets: [],
    host: { capability: "available", version: 1 },
  },
  history: [],
  proposals: [
    {
      proposal: {
        id: "prp_review01",
        kind: "projection",
        basedOnBindingId: "pb_active01",
        sourceHash: "a".repeat(64),
        noop: false,
        preflight: { warnings: [] },
        files: [
          {
            path: "IDENTITY.md",
            diff: "--- IDENTITY.md\n+++ IDENTITY.md\n+approved line",
            driftDiff: "- approved\n+ manually edited",
            unmanagedBytes: 17,
            proposedFile: "# Exact final identity\n",
          },
        ],
      },
      record: {
        state: "proposed",
        updatedAt: 1_788_000_100,
        attempt: null,
        failure: null,
        hostResult: null,
      },
      actions: {
        canApprove: false,
        canReject: true,
        canRetry: false,
        approvalBlockers: ["source_changed"],
      },
    },
  ],
  diagnostics: { orphanProposalIds: [] },
};

const sources = {
  self: {
    contactId: "contact-self",
    name: "Ada Founder",
    preferredName: null,
    headline: "Founder",
    currentRole: null,
  },
  org: { orgId: "org-own", name: "Analytical Engines" },
  voice: {
    status: "active",
    candidates: [
      { id: "vp_voice01", version: 1, hash: "d".repeat(64), label: "Ada voice" },
    ],
  },
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PersonalityTab", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body =
          url === "/api/personality/binding"
            ? binding
            : url === "/api/personality/onboarding"
              ? onboarding
              : url === "/api/personality/sources"
                ? sources
                : url === "/api/personality/represented-org"
                  ? {
                      selected: { id: "org-own", name: "Analytical Engines" },
                      candidates: [{ id: "org-own", name: "Analytical Engines" }],
                    }
                  : url === "/api/personality/statements"
                    ? { values: ["Be useful"], boundaries: ["No hype"] }
                    : url === "/api/platform-targets"
                      ? { targets: [] }
                      : null;
        return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
  });

  it("separates workspace, identity, drift, and immutable proposal bytes", async () => {
    await act(async () => {
      root.render(createElement(PersonalityTab));
    });
    await flush();

    expect(document.body.textContent).toContain("Signals GTM");
    expect(document.body.textContent).toContain("workspace 42");
    expect(document.body.textContent).toContain("/safe/working-data/signals");
    expect(document.body.textContent).toContain("Ada Founder");
    expect(document.body.textContent).toContain("Workspace drift");
    expect(document.body.textContent).toContain("IDENTITY.md: unmanaged edited");
    expect(document.body.textContent).toContain("Exact whole-file diff");
    expect(document.body.textContent).toContain("# Exact final identity");

    const approve = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Approve & apply"),
    );
    expect(approve).toBeTruthy();
    expect(approve?.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Approval is blocked by current server state: source changed.",
    );
  });
});
