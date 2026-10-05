// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ContactChannelsSection } from "@/components/contact-channels-section";
import { IdentitiesSection } from "@/components/identities-section";
import type { ContactChannel } from "@/lib/db/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

function channel(overrides: Partial<ContactChannel> & Pick<ContactChannel, "id">): ContactChannel {
  return {
    contactId: "c1",
    channelType: "email",
    value: "giang@mes-engineering.com.vn",
    valueNormalized: "giang@mes-engineering.com.vn",
    label: null,
    isPrimary: false,
    isVerified: false,
    contactIdentityId: null,
    scope: "shared",
    source: "test",
    metadata: "{}",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const workEmail = channel({
  id: "email-work",
  label: "work",
  isPrimary: true,
  isVerified: true,
  createdAt: 2,
});
const otherEmail = channel({
  id: "email-other",
  value: "giang.bui@gmail.com",
  valueNormalized: "giang.bui@gmail.com",
  label: "Office",
  createdAt: 1,
});
const phone = channel({
  id: "phone",
  channelType: "phone",
  value: "+84913039986",
  valueNormalized: "+84913039986",
  isPrimary: true,
});
const zalo = channel({
  id: "zalo",
  channelType: "zalo",
  value: "0913039986",
  valueNormalized: "0913039986",
  scope: "local_only",
});

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttons(label: string): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === label || button.getAttribute("aria-label") === label,
  );
}

async function click(element: Element | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
}

function rowTexts(): string[] {
  return Array.from(document.body.querySelectorAll("li")).map((li) => li.textContent ?? "");
}

describe("ContactChannelsSection", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    refresh.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
  });

  async function render(channels: ContactChannel[]) {
    await act(async () => {
      root.render(createElement(ContactChannelsSection, { contactId: "c1", channels }));
    });
  }

  it("lists rows by type, primary first, with a badge per flag", async () => {
    await render([zalo, phone, otherEmail, workEmail]);

    const rows = rowTexts();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("giang@mes-engineering.com.vn");
    expect(rows[0]).toContain("Work");
    expect(rows[0]).toContain("Primary");
    expect(rows[0]).toContain("Verified");
    expect(rows[1]).toContain("giang.bui@gmail.com");
    expect(rows[1]).toContain("Office");
    expect(rows[1]).not.toContain("Primary");
    expect(rows[2]).toContain("Phone");
    expect(rows[2]).toContain("Primary");
    expect(rows[3]).toContain("Zalo");
    expect(rows[3]).toContain("Local only");

    // One Primary per type, and "Set as primary" only where it would change something.
    expect(rows.filter((row) => row.includes("Primary") && !row.includes("Set as primary"))).toHaveLength(2);
    expect(buttons("Set as primary")).toHaveLength(2);
  });

  it("links values in place or in a new tab", async () => {
    await render([workEmail, phone, zalo]);

    const mail = document.body.querySelector('a[href="mailto:giang@mes-engineering.com.vn"]');
    expect(mail).toBeTruthy();
    expect(mail?.getAttribute("target")).toBeNull();
    expect(document.body.querySelector('a[href="tel:+84913039986"]')).toBeTruthy();
    const zaloLink = document.body.querySelector('a[href="https://zalo.me/0913039986"]');
    expect(zaloLink?.getAttribute("target")).toBe("_blank");
    expect(zaloLink?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows the empty state with an add action", async () => {
    await render([]);

    expect(document.body.textContent).toContain("No email, phone or messaging channel yet.");
    expect(buttons("Add channel")).toHaveLength(1);
  });

  it("sets a channel as primary and removes one through the per-row routes", async () => {
    await render([workEmail, otherEmail]);

    await click(buttons("Set as primary")[0]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/contacts/c1/channels/email-other", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPrimary: true }),
    });

    await click(buttons("Remove giang.bui@gmail.com")[0]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/contacts/c1/channels/email-other", {
      method: "DELETE",
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("reports a failed row action instead of refreshing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await render([workEmail, otherEmail]);

    await click(buttons("Remove giang.bui@gmail.com")[0]);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not remove giang.bui@gmail.com. Try again.",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers Verified only for email and phone", async () => {
    await render([workEmail, zalo]);

    await click(buttons("Edit 0913039986")[0]);
    expect(document.body.textContent).toContain("Edit channel");
    expect(document.body.querySelector('label[for$="-verified"]')).toBeNull();
    await click(buttons("Cancel")[0]);

    await click(buttons("Edit giang@mes-engineering.com.vn")[0]);
    expect(document.body.querySelector('label[for$="-verified"]')?.textContent).toBe("Verified");
  });

  it("renders a duplicate as an inline error and keeps the dialog open", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "This contact already has that channel", code: "CHANNEL_DUPLICATE" }),
        { status: 409 },
      ),
    );
    await render([workEmail]);

    await click(buttons("Add channel")[0]);
    const input = document.body.querySelector<HTMLInputElement>('input[id$="-value"]');
    await act(async () => setInputValue(input!, "GIANG@mes-engineering.com.vn"));
    await act(async () => {
      document.body.querySelector("form")!.requestSubmit();
      await Promise.resolve();
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/contacts/c1/channels");
    // A second email does not take the primary by default.
    expect(JSON.parse(String(init.body))).toEqual({
      channelType: "email",
      value: "GIANG@mes-engineering.com.vn",
      label: null,
      isPrimary: false,
      isVerified: false,
    });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "This contact already has that email address.",
    );
    expect(document.body.textContent).toContain("Add channel");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("makes the first channel of a type primary by default", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 201 }));
    await render([phone]);

    await click(buttons("Add channel")[0]);
    const input = document.body.querySelector<HTMLInputElement>('input[id$="-value"]');
    await act(async () => setInputValue(input!, "giang@mes-engineering.com.vn"));
    await act(async () => {
      document.body.querySelector("form")!.requestSubmit();
      await Promise.resolve();
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ channelType: "email", isPrimary: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("sends only changed fields on edit and skips the request when nothing changed", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    await render([workEmail, zalo]);

    await click(buttons("Edit giang@mes-engineering.com.vn")[0]);
    await act(async () => {
      document.body.querySelector("form")!.requestSubmit();
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Edit channel");

    await click(buttons("Edit 0913039986")[0]);
    const input = document.body.querySelector<HTMLInputElement>('input[id$="-value"]');
    await act(async () => setInputValue(input!, "+84 91 303 9986"));
    await act(async () => {
      document.body.querySelector("form")!.requestSubmit();
      await Promise.resolve();
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/contacts/c1/channels/zalo");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ value: "+84 91 303 9986" });
  });

  it("turns Verified off when an edit changes the address, and sends it only if re-verified", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await render([workEmail]);

    const verifiedSwitch = () => document.body.querySelector<HTMLButtonElement>('button[id$="-verified"]');
    const valueInput = () => document.body.querySelector<HTMLInputElement>('input[id$="-value"]')!;
    const submit = async () =>
      act(async () => {
        document.body.querySelector("form")!.requestSubmit();
        await Promise.resolve();
      });

    await click(buttons("Edit giang@mes-engineering.com.vn")[0]);
    expect(verifiedSwitch()?.getAttribute("aria-checked")).toBe("true");
    // Same address in another case: still verified.
    await act(async () => setInputValue(valueInput(), "Giang@MES-Engineering.com.vn"));
    expect(verifiedSwitch()?.getAttribute("aria-checked")).toBe("true");
    // A different address: the old verification no longer applies.
    await act(async () => setInputValue(valueInput(), "bui-sy.giang@mes-engineering.com.vn"));
    expect(verifiedSwitch()?.getAttribute("aria-checked")).toBe("false");
    await submit();
    let [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ value: "bui-sy.giang@mes-engineering.com.vn" });

    await click(buttons("Edit giang@mes-engineering.com.vn")[0]);
    await act(async () => setInputValue(valueInput(), "bui-sy.giang@mes-engineering.com.vn"));
    await click(verifiedSwitch() ?? undefined);
    await submit();
    [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      value: "bui-sy.giang@mes-engineering.com.vn",
      isVerified: true,
    });
  });

  describe("keyboard focus (#534 UX2)", () => {
    const settle = async () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    const active = () => document.activeElement as HTMLElement | null;
    const label = (element: HTMLElement | null) =>
      element?.getAttribute("aria-label") ?? element?.textContent?.trim() ?? element?.tagName;

    async function pressEscape() {
      await act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      await settle();
    }

    it("returns focus to Add channel after Cancel and to the row's Edit after Escape", async () => {
      await render([workEmail, phone]);

      await click(buttons("Add channel")[0]);
      await click(buttons("Cancel")[0]);
      await settle();
      expect(label(active())).toBe("Add channel");

      await click(buttons("Edit +84913039986")[0]);
      await pressEscape();
      expect(label(active())).toBe("Edit +84913039986");
    });

    it("keeps focus on the edited row after Save, even when the refresh reorders it", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
      await render([workEmail, otherEmail]);

      await click(buttons("Edit giang.bui@gmail.com")[0]);
      await act(async () => setInputValue(document.body.querySelector<HTMLInputElement>('input[id$="-value"]')!, "giang.b@gmail.com"));
      await act(async () => {
        document.body.querySelector("form")!.requestSubmit();
        await Promise.resolve();
      });
      await settle();
      expect(label(active())).toBe("Edit giang.bui@gmail.com");

      // The refresh lands with the row moved to the top; a lost focus is recovered.
      const edited = { ...otherEmail, value: "giang.b@gmail.com", isPrimary: true };
      (document.activeElement as HTMLElement | null)?.blur();
      await render([edited, { ...workEmail, isPrimary: false }]);
      expect(label(active())).toBe("Edit giang.b@gmail.com");
    });

    it("moves focus to a surviving row after Remove, and to Add channel when none is left", async () => {
      await render([workEmail, otherEmail, phone]);

      await click(buttons("Remove giang.bui@gmail.com")[0]);
      // The next row in display order is the phone.
      expect(label(active())).toBe("Edit +84913039986");
      await render([workEmail, phone]);
      expect(label(active())).toBe("Edit +84913039986");

      await click(buttons("Remove +84913039986")[0]);
      expect(label(active())).toBe("Edit giang@mes-engineering.com.vn");
      await render([workEmail]);

      await click(buttons("Remove giang@mes-engineering.com.vn")[0]);
      expect(label(active())).toBe("Add channel");
    });

    it("lands on the row's Edit button after Set as primary removes that button", async () => {
      await render([workEmail, otherEmail]);

      await click(buttons("Set as primary")[0]);
      expect(label(active())).toBe("Edit giang.bui@gmail.com");
      (document.activeElement as HTMLElement | null)?.blur();
      await render([{ ...otherEmail, isPrimary: true }, { ...workEmail, isPrimary: false }]);
      expect(buttons("Set as primary")).toHaveLength(1);
      expect(label(active())).toBe("Edit giang.bui@gmail.com");
    });

    it("does not pull focus back after the user moved on", async () => {
      await render([workEmail, otherEmail]);

      await click(buttons("Set as primary")[0]);
      buttons("Add channel")[0].focus();
      await render([{ ...otherEmail, isPrimary: true }, { ...workEmail, isPrimary: false }]);
      expect(label(active())).toBe("Add channel");
    });
  });
});

describe("IdentitiesSection group heading", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("renders the heading and the empty-state slot", async () => {
    await act(async () => {
      root.render(
        createElement(IdentitiesSection, {
          contactId: "c1",
          identities: [],
          title: "Platform identities",
          description: "Accounts on social and content platforms.",
          emptyAction: createElement("p", { "data-testid": "slot" }, "Enrich prompt"),
        }),
      );
    });

    expect(container.querySelector("h3")?.textContent).toBe("Platform identities");
    expect(container.textContent).toContain("Accounts on social and content platforms.");
    const empty = container.querySelector('[data-testid="slot"]');
    expect(empty?.closest('[data-slot="card"]')?.textContent).toContain(
      "No platform identities linked yet.",
    );
    expect(buttons("Add identity")).toHaveLength(1);
  });
});
