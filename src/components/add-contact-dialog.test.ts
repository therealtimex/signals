// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AddContactDialog } from "@/components/add-contact-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(label: string, root: ParentNode = document.body) {
  return Array.from(root.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
}

async function clickButton(label: string, root: ParentNode = document.body) {
  await act(async () => {
    const button = findButton(label, root);
    expect(button).toBeTruthy();
    button!.click();
  });
}

describe("AddContactDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.replaceChildren();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not attach canceled identity drafts to a later save", async () => {
    await act(async () => {
      root.render(createElement(AddContactDialog));
    });

    await clickButton("Add Contact");
    await clickButton("Add Identity");

    const identityInput = document.querySelector("#identity-user-id-0") as HTMLInputElement;
    expect(identityInput).toBeTruthy();
    await act(async () => {
      setInputValue(identityInput, "stale-user-id");
    });

    await clickButton("Cancel");
    await clickButton("Add Contact");

    const firstNameInput = document.querySelector("#firstName") as HTMLInputElement;
    expect(firstNameInput).toBeTruthy();
    await act(async () => {
      setInputValue(firstNameInput, "Fresh");
    });

    await clickButton("Save Contact");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body.name).toBe("Fresh");
    expect(body.identities).toBeUndefined();
  });

  it("omits identity rows without a user id from the save payload", async () => {
    await act(async () => {
      root.render(createElement(AddContactDialog));
    });

    await clickButton("Add Contact");
    await clickButton("Add Identity");

    const firstNameInput = document.querySelector("#firstName") as HTMLInputElement;
    expect(firstNameInput).toBeTruthy();
    await act(async () => {
      setInputValue(firstNameInput, "Partial");
    });

    await clickButton("Save Contact");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body.name).toBe("Partial");
    expect(body.identities).toBeUndefined();
  });
});
