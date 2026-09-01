// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalityOnboardingDialog } from "@/components/personality-onboarding-dialog";
import { OPEN_PERSONALITY_ONBOARDING_EVENT } from "@/lib/personality/onboarding-contract";

const onboardingState = {
  success: true,
  workspace: {
    id: "42",
    slug: "signals",
    displayName: "Signals GTM",
    path: "/working-data/signals",
  },
  personality: { present: false, files: [] },
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
  shouldOnboard: true,
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("PersonalityOnboardingDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
  });

  it("auto-opens for an empty Personality and submits to the bounded handoff route", async () => {
    const submissions: Array<{ brief: string; requestId: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/personality/onboarding" && !init) {
        return new Response(JSON.stringify(onboardingState), { status: 200 });
      }
      expect(String(input)).toBe("/api/personality/onboarding");
      expect(init?.method).toBe("POST");
      const formData = init?.body as FormData;
      const requestId = String(formData.get("requestId"));
      submissions.push({
        brief: String(formData.get("brief")),
        requestId,
      });
      expect(requestId).toMatch(/^signals-personality-/);
      return new Response(
        JSON.stringify({
          success: true,
          requestId,
          sessionId: "session-1",
          workspace: { id: "42", slug: "signals", displayName: "Signals GTM" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(createElement(PersonalityOnboardingDialog));
    });
    await flush();
    expect(document.body.textContent).toContain("Help your agents sound like you");
    expect(document.body.textContent).toContain("Destination: Signals GTM");

    const textarea = document.body.querySelector("textarea")!;
    await act(async () => {
      setTextareaValue(textarea, "I build reliable GTM systems.");
    });
    const sendButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Send to Personality Editor"),
    )!;
    await act(async () => {
      sendButton.click();
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submissions).toEqual([
      expect.objectContaining({ brief: "I build reliable GTM systems." }),
    ]);
    expect(document.body.textContent).not.toContain("Help your agents sound like you");
    expect(sessionStorage.getItem("signals:personality-onboarding:dismissed:42")).toBe("1");

    await act(async () => {
      window.dispatchEvent(new Event(OPEN_PERSONALITY_ONBOARDING_EVENT));
    });
    const reopenedTextarea = document.body.querySelector("textarea")!;
    expect(reopenedTextarea.value).toBe("");
    await act(async () => {
      setTextareaValue(reopenedTextarea, "Use this second brief.");
    });
    const reopenedSendButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Send to Personality Editor"))!;
    await act(async () => {
      reopenedSendButton.click();
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(submissions.map((submission) => submission.brief)).toEqual([
      "I build reliable GTM systems.",
      "Use this second brief.",
    ]);
    expect(submissions[1]?.requestId).not.toBe(submissions[0]?.requestId);
  });

  it("does not auto-open again after the workspace was dismissed in this session", async () => {
    sessionStorage.setItem("signals:personality-onboarding:dismissed:42", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(onboardingState), { status: 200 })),
    );
    await act(async () => {
      root.render(createElement(PersonalityOnboardingDialog));
    });
    await flush();
    expect(document.body.textContent).not.toContain("Help your agents sound like you");
  });
});
