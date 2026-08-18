// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OrgPicker } from "@/components/org-picker";
import type { Org } from "@/lib/db/types";

const acmeOrg: Org = {
  id: "org-acme",
  name: "Acme",
  orgType: "company",
  domain: null,
  website: null,
  description: null,
  location: null,
  avatarUrl: null,
  enrichmentScore: 0,
  scope: "shared",
  metadata: "{}",
  source: "test",
  createdSource: null,
  createdSourceDetail: null,
  createdWorkflowRunId: null,
  createdTemplateId: null,
  createdAt: 0,
  updatedAt: 0,
};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("OrgPicker", () => {
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
        if (url.includes("/api/orgs")) {
          return {
            ok: true,
            json: async () => ({ data: [acmeOrg] }),
          } as Response;
        }
        return { ok: false } as Response;
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("invalidates parent org selection when combobox text is edited after select", async () => {
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(OrgPicker, {
          id: "organization",
          onChange,
        }),
      );
    });

    const input = container.querySelector("#organization") as HTMLInputElement;
    expect(input).toBeTruthy();

    await act(async () => {
      input.focus();
      setInputValue(input, "Ac");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const option = container.querySelector('[role="option"]') as HTMLButtonElement;
    expect(option).toBeTruthy();

    await act(async () => {
      option.click();
    });

    expect(onChange).toHaveBeenCalledWith({ orgId: "org-acme", company: "Acme" });

    await act(async () => {
      setInputValue(input, "Different org");
    });

    expect(onChange).toHaveBeenLastCalledWith({ orgId: "", company: "Different org" });
  });

  it("invalidates parent value when a preloaded company name is edited", async () => {
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(OrgPicker, {
          id: "organization",
          defaultOrgName: "Acme",
          onChange,
        }),
      );
    });

    const input = container.querySelector("#organization") as HTMLInputElement;
    expect(input.value).toBe("Acme");

    await act(async () => {
      setInputValue(input, "Different org");
    });

    expect(onChange).toHaveBeenCalledWith({ orgId: "", company: "Different org" });
  });

  it("keeps notifying parent on subsequent edits after the first invalidation", async () => {
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(OrgPicker, {
          id: "organization",
          onChange,
        }),
      );
    });

    const input = container.querySelector("#organization") as HTMLInputElement;

    await act(async () => {
      input.focus();
      setInputValue(input, "Ac");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const option = container.querySelector('[role="option"]') as HTMLButtonElement;
    await act(async () => {
      option.click();
    });

    await act(async () => {
      setInputValue(input, "Acm");
    });
    await act(async () => {
      setInputValue(input, "Acme Two");
    });

    expect(onChange).toHaveBeenLastCalledWith({ orgId: "", company: "Acme Two" });
  });

  it("notifies parent when a preloaded company name is edited and reverted", async () => {
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(OrgPicker, {
          id: "organization",
          defaultOrgName: "Acme",
          onChange,
        }),
      );
    });

    const input = container.querySelector("#organization") as HTMLInputElement;

    await act(async () => {
      setInputValue(input, "Different org");
    });
    await act(async () => {
      setInputValue(input, "Acme");
    });

    expect(onChange).toHaveBeenLastCalledWith({ orgId: "", company: "Acme" });
  });
});
