// @vitest-environment happy-dom

/**
 * Focus after "Replace your draft?" (UX experience review r1, contract v2 §7): the confirm opens
 * from state with no trigger, so it must place focus itself when it closes.
 */
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountObjectiveFields } from "@/app/dashboard/workflows/account-objective-fields";
import type { ObjectiveDraft } from "@/app/dashboard/workflows/account-objective-copy";

const SAVED_TEXT = "## Outcome\nBook a call.\n";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Created outside render: the parent dialog owns these refs; the harness only threads them through.
const refs = {
  briefTextRef: createRef<HTMLTextAreaElement>(),
  editCopyRef: createRef<HTMLButtonElement>(),
  nameRef: createRef<HTMLInputElement>(),
  mentionListOpenRef: { current: false },
};

function Harness() {
  const [draft, setDraft] = useState<ObjectiveDraft>({
    kind: "commercial",
    mode: "saved",
    // A different draft the operator typed before choosing the saved brief.
    text: "## Outcome\nMy own draft that Replace would discard.\n",
    savedPath: "objectives/eng-founders.md",
    save: false,
    name: "",
  });
  return createElement(AccountObjectiveFields, {
    draft,
    onChange: setDraft,
    errors: {},
    savedBriefs: [{ name: "eng-founders", path: "objectives/eng-founders.md", outcome: "Book a call.", updatedAt: 1_792_000_000 }],
    templateNote: null,
    ...refs,
  });
}

describe("AccountObjectiveFields: Edit a copy confirm focus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      if (url === "/api/objectives/mentions") return json({ products: [], files: [], productsFile: "absent" });
      if (url === "/api/objectives/preview") {
        return json({ parsed: { outcome: "Book a call.", fit: null, unknowns: [], nextStep: null, success: null }, mentions: [], offering: null, limitations: [], workspace: "available" });
      }
      if (url.startsWith("/api/objectives/")) return json({ text: SAVED_TEXT });
      return json({}, 404);
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  const button = (label: string) => [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim().endsWith(label)) ?? null;

  async function openConfirm() {
    await act(async () => {
      root.render(createElement(Harness));
    });
    await settle();
    await act(async () => {
      button("Edit a copy")!.click();
    });
    await settle();
    expect(document.body.textContent).toContain("Replace your draft?");
  }

  it("lands at the start of the copied brief after Replace", async () => {
    await openConfirm();
    await act(async () => {
      button("Replace")!.click();
    });
    await settle();

    const textarea = document.querySelector<HTMLTextAreaElement>("#objective-brief-text")!;
    expect(textarea.value).toBe(SAVED_TEXT);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(0);
  });

  it("returns focus to Edit a copy after Cancel", async () => {
    await openConfirm();
    await act(async () => {
      button("Cancel")!.click();
    });
    await settle();

    expect(document.body.textContent).not.toContain("Replace your draft?");
    expect(document.activeElement).toBe(button("Edit a copy"));
  });
});
