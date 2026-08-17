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
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "contact-id" }),
    });
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

  it("clears draft after a successful save so the next contact starts fresh", async () => {
    await act(async () => {
      root.render(createElement(AddContactDialog));
    });

    await clickButton("Add Contact");
    await clickButton("Add Identity");

    const identityInput = document.querySelector("#identity-user-id-0") as HTMLInputElement;
    expect(identityInput).toBeTruthy();
    await act(async () => {
      setInputValue(identityInput, "first-user-id");
    });

    const firstNameInput = document.querySelector("#firstName") as HTMLInputElement;
    expect(firstNameInput).toBeTruthy();
    await act(async () => {
      setInputValue(firstNameInput, "First Contact");
    });

    await clickButton("Save Contact");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, firstRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
    const firstBody = JSON.parse(String(firstRequest.body));
    expect(firstBody.name).toBe("First Contact");
    expect(firstBody.identities).toEqual([
      expect.objectContaining({ platformUserId: "first-user-id" }),
    ]);

    await clickButton("Add Contact");

    const secondFirstNameInput = document.querySelector("#firstName") as HTMLInputElement;
    expect(secondFirstNameInput).toBeTruthy();
    expect(secondFirstNameInput.value).toBe("");
    await act(async () => {
      setInputValue(secondFirstNameInput, "Second Contact");
    });

    await clickButton("Save Contact");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(String(secondRequest.body));
    expect(secondBody.name).toBe("Second Contact");
    expect(secondBody.identities).toBeUndefined();
    expect(secondBody.firstName).toBe("Second Contact");
    expect(secondBody.firstName).not.toBe("First Contact");
  });

  it("uploads and attaches an avatar after the contact is created", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "contact-123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "asset-456" }),
      })
      .mockResolvedValueOnce({ ok: true });

    await act(async () => {
      root.render(createElement(AddContactDialog));
    });

    await clickButton("Add Contact");

    const firstNameInput = document.querySelector("#firstName") as HTMLInputElement;
    expect(firstNameInput).toBeTruthy();
    await act(async () => {
      setInputValue(firstNameInput, "Avatar");
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    await act(async () => {
      Object.defineProperty(fileInput, "files", { value: [file] });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await clickButton("Save Contact");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("/api/contacts");
    expect(JSON.parse(String(createInit.body)).name).toBe("Avatar");

    const [mediaUrl, mediaInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(mediaUrl).toBe("/api/media");
    expect(mediaInit.body).toBeInstanceOf(FormData);

    const [attachUrl, attachInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(attachUrl).toBe("/api/media/attachments");
    expect(JSON.parse(String(attachInit.body))).toEqual({
      mediaAssetId: "asset-456",
      parentType: "contact",
      parentId: "contact-123",
      role: "avatar",
    });
  });
});
