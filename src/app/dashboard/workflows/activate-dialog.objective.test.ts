// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivateDialog } from "@/app/dashboard/workflows/activate-dialog";
import { buildContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import { OBJECTIVE_BRIEF_TEMPLATE } from "@/lib/writing/objective-brief";

vi.mock("@/app/dashboard/workflows/use-acting-targets", () => ({
  useActingTargets: () => [
    { id: "target-1", platform: "linkedin", name: "Founder", handle: "founder", status: "active" },
  ],
}));

const OUTCOME_BRIEF = "## Outcome\nAgree to a 20-minute evaluation of @PRODUCTS.md#engineering-workflow.\n\n## Fit\nFounders hiring.\n";

type Call = { url: string; method: string; body: unknown };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function template(extra: Record<string, unknown> = {}) {
  return {
    id: "tpl_nurture",
    name: "Contact Relationship Nurture",
    description: "Assist-only relationship progression.",
    templateType: "nurture",
    systemPrompt: "Nurture contacts.",
    targetPersona: null,
    config: JSON.stringify({ ...buildContactNurtureTemplateConfig({ targetId: "target-1" }), ...extra }),
  };
}

describe("ActivateDialog run objective (#549)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let calls: Call[];
  let runResponse: () => Response;
  let putResponse: () => Response;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    calls = [];
    onClose = vi.fn();
    runResponse = () => json({ workflowRunId: "run_1", threadPath: "realtimex/thread" }, 201);
    putResponse = () => json({ brief: { name: "x" } }, 201);
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url === "/api/objectives") {
        return json({ briefs: [{ name: "eng-founders", path: "objectives/eng-founders.md", outcome: "Book a call.", fileHash: "h", updatedAt: 1_792_000_000 }] });
      }
      if (url === "/api/objectives/mentions") {
        return json({
          products: [{ slug: "engineering-workflow", name: "Engineering Workflow", oneLiner: null, proofPointCount: 2, token: "@PRODUCTS.md#engineering-workflow" }],
          files: [{ path: "BRAND.md", token: "@BRAND.md" }],
          productsFile: "present",
        });
      }
      if (url === "/api/objectives/preview") {
        return json({ parsed: { outcome: null, fit: null, unknowns: [], nextStep: null, success: null }, mentions: [], offering: null, limitations: [], workspace: "available" });
      }
      if (url.startsWith("/api/objectives/") && method === "GET") return json({ text: "## Outcome\nBook a call.\n" });
      if (url.startsWith("/api/objectives/") && method === "PUT") return putResponse();
      if (url === "/api/workflows/templates/tpl_nurture/run") return runResponse();
      return json({}, 404);
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  async function render(tpl = template()) {
    await act(async () => {
      root.render(createElement(ActivateDialog, { template: tpl, open: true, onClose }));
    });
    await flush();
  }

  const runButton = () => [...document.querySelectorAll("button")]
    .find((button) => /Run Agent|Choose what this run is for|Launching/.test(button.textContent ?? ""))!;
  const radio = (value: string) => document.querySelector<HTMLInputElement>(`input[name="objective-kind"][value="${value}"]`)!;
  const textarea = () => document.querySelector<HTMLTextAreaElement>("#objective-brief-text")!;
  const runCalls = () => calls.filter((call) => call.url.endsWith("/run"));

  async function click(element: HTMLElement) {
    await act(async () => {
      element.click();
    });
    await flush();
  }

  async function type(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
    await act(async () => {
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
      element.setSelectionRange(value.length, value.length);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function key(element: HTMLElement, name: string) {
    await act(async () => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    });
  }

  it("does not preselect a kind and keeps Run disabled until one is chosen", async () => {
    await render();
    expect(document.body.textContent).toContain("What is this run for?");
    expect(radio("relationship_only").checked).toBe(false);
    expect(radio("commercial").checked).toBe(false);
    expect(runButton().textContent).toContain("Choose what this run is for");
    expect(runButton().disabled).toBe(true);
  });

  it("sends a relationship-only objective and confirms it", async () => {
    await render();
    await click(radio("relationship_only"));
    expect(document.body.textContent).toContain("Every draft is marked Relationship only, and the agent won't bring up an offering.");
    expect(runButton().disabled).toBe(false);
    await click(runButton());
    expect(runCalls()[0].body).toMatchObject({ config: { accountObjective: { kind: "relationship_only" } } });
    const status = document.querySelector<HTMLElement>('[data-testid="activate-run-status"]')!;
    expect(status.textContent).toContain("Objective attached: Relationship only");
    expect(document.activeElement).toBe(status);
  });

  it("requires an Outcome before a business-outcome run starts", async () => {
    await render();
    await click(radio("commercial"));
    expect(textarea().value).toBe(OBJECTIVE_BRIEF_TEMPLATE);
    await click(runButton());
    expect(runCalls()).toHaveLength(0);
    expect(document.body.textContent).toContain(
      "Add an Outcome: a line under ## Outcome that says what you want to happen for these accounts.",
    );
    expect(textarea().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(textarea());
  });

  it("sends a written brief inline and names the attached outcome from the stamped record", async () => {
    runResponse = () => json({
      workflowRunId: "run_1",
      threadPath: "realtimex/thread",
      workflowRun: {
        config: JSON.stringify({
          accountObjective: {
            kind: "commercial",
            parsed: { outcome: "Agree to a 20-minute evaluation of @PRODUCTS.md#engineering-workflow." },
            mentions: [{
              raw: "@PRODUCTS.md#engineering-workflow",
              path: "PRODUCTS.md",
              anchor: "engineering-workflow",
              resolved: { fileHash: "f", excerpt: "", excerptHash: "e", entry: { slug: "engineering-workflow", name: "Engineering Workflow", oneLiner: null, proofPointCount: 2 } },
              unresolvedReason: null,
            }],
            brief: { source: { kind: "inline" } },
          },
        }),
      },
    }, 201);
    await render();
    await click(radio("commercial"));
    await type(textarea(), OUTCOME_BRIEF);
    await click(runButton());
    expect(runCalls()[0].body).toMatchObject({
      config: { accountObjective: { kind: "commercial", brief: { kind: "inline", text: OUTCOME_BRIEF } } },
    });
    expect(document.querySelector('[data-testid="activate-objective-line"]')?.textContent).toBe(
      "Objective attached: Business outcome — Agree to a 20-minute evaluation of Engineering Workflow.",
    );
  });

  it("opens the @ list, inserts with the keyboard, and Esc closes the list but not the dialog", async () => {
    await render();
    await click(radio("commercial"));
    await type(textarea(), "## Outcome\nTry @eng");
    const list = document.querySelector<HTMLElement>('[data-testid="objective-mention-list"]')!;
    expect(list.hidden).toBe(false);
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(textarea().getAttribute("aria-activedescendant")).toBe("objective-mention-option-0");
    await key(textarea(), "Enter");
    expect(textarea().value).toBe("## Outcome\nTry @PRODUCTS.md#engineering-workflow ");
    expect(list.hidden).toBe(true);

    await type(textarea(), `${textarea().value}@`);
    expect(list.hidden).toBe(false);
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(2);
    await key(textarea(), "ArrowDown");
    expect(textarea().getAttribute("aria-activedescendant")).toBe("objective-mention-option-1");
    await key(textarea(), "Escape");
    expect(list.hidden).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector("#objective-brief-text")).not.toBeNull();

    await key(textarea(), "Escape");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a name conflict under Name and never overwrites", async () => {
    putResponse = () => json({ error: "exists", code: "CONFLICT", errorCode: "objective_exists" }, 409);
    await render();
    await click(radio("commercial"));
    await type(textarea(), OUTCOME_BRIEF);
    await click(document.querySelector<HTMLElement>("#objective-brief-save")!);
    const name = document.querySelector<HTMLInputElement>("#objective-brief-name")!;
    expect(name.value).toBe("agree-to-a-20-minute");
    expect(document.body.textContent).toContain("Saved as objectives/agree-to-a-20-minute.md. Use lowercase letters, numbers and dashes.");
    await click(runButton());
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toBe("/api/objectives/agree-to-a-20-minute");
    expect(put.body).toEqual({ text: OUTCOME_BRIEF });
    expect(runCalls()).toHaveLength(0);
    expect(document.body.textContent).toContain(
      "A saved brief named agree-to-a-20-minute already exists. Choose another name.",
    );
    expect(document.activeElement).toBe(document.querySelector("#objective-brief-name"));
  });

  it("saves first and dispatches the saved path", async () => {
    await render();
    await click(radio("commercial"));
    await type(textarea(), OUTCOME_BRIEF);
    await click(document.querySelector<HTMLElement>("#objective-brief-save")!);
    await click(runButton());
    expect(runCalls()[0].body).toMatchObject({
      config: { accountObjective: { kind: "commercial", brief: { kind: "saved", path: "objectives/agree-to-a-20-minute.md" } } },
    });
    expect(document.querySelector('[data-testid="activate-objective-line"]')?.textContent)
      .toContain(" · brief saved as objectives/agree-to-a-20-minute.md");
  });

  it("titles a refused run and keys the copy off details.reason", async () => {
    runResponse = () => json({
      error: "workspace",
      errorCode: "invalid_account_objective",
      details: { reason: "workspace_unavailable" },
    }, 422);
    await render();
    await click(radio("commercial"));
    await type(textarea(), OUTCOME_BRIEF);
    await click(runButton());
    const box = document.querySelector<HTMLElement>('[data-testid="activate-run-error"]')!;
    expect(box.textContent).toContain("Signals didn't start the run");
    expect(box.textContent).toContain(
      "Signals can't reach its RealTimeX workspace, so it can't read or save the files this brief needs. Nothing was started.",
    );
    expect(document.activeElement).toBe(box);
    expect(textarea().value).toBe(OUTCOME_BRIEF);
  });

  it("drops a saved brief the server no longer has and returns to writing", async () => {
    runResponse = () => json({
      error: "gone",
      errorCode: "invalid_account_objective",
      details: { reason: "saved_brief_not_found", path: "objectives/eng-founders.md", name: "eng-founders" },
    }, 422);
    await render(template({ accountObjective: { kind: "commercial", brief: { kind: "saved", path: "objectives/eng-founders.md" } } }));
    expect(document.querySelector('[data-testid="objective-saved-brief"]')?.textContent).toContain("objectives/eng-founders.md");
    await click(runButton());
    expect(document.body.textContent).toContain(
      "The saved brief eng-founders isn't in the workspace anymore. Nothing was started. Write a brief, or choose another saved one.",
    );
    expect(document.querySelector('[data-testid="objective-saved-brief"]')).toBeNull();
    expect(textarea()).not.toBeNull();
  });

  it("omits an untouched template default and sends it once edited", async () => {
    await render(template({ accountObjective: { kind: "commercial", brief: { kind: "inline", text: OUTCOME_BRIEF } } }));
    const note = () => document.querySelector('[data-testid="objective-template-note"]')?.textContent;
    expect(radio("commercial").checked).toBe(true);
    expect(note()).toBe("Filled in from this template's default brief. Change anything to use your own for this run.");
    await click(runButton());
    expect((runCalls()[0].body as { config: Record<string, unknown> }).config).not.toHaveProperty("accountObjective");
  });

  it("marks an edited template default as changed", async () => {
    await render(template({ accountObjective: { kind: "commercial", brief: { kind: "inline", text: OUTCOME_BRIEF } } }));
    await type(textarea(), `${OUTCOME_BRIEF}\n## Success\nA reply.\n`);
    expect(document.querySelector('[data-testid="objective-template-note"]')?.textContent).toBe(
      "Changed from the template's default. This run uses your version.",
    );
    await click(runButton());
    expect(runCalls()[0].body).toMatchObject({
      config: { accountObjective: { kind: "commercial", brief: { kind: "inline" } } },
    });
  });
});
