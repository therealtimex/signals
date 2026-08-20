// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RowActionsMenu } from "@/components/row-actions-menu";

describe("RowActionsMenu", () => {
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

  it("opens, runs an action, and does not invoke the containing row", async () => {
    const onRowClick = vi.fn();
    const onSelect = vi.fn();

    await act(async () => {
      root.render(
        createElement("div", { onClick: onRowClick },
          createElement(RowActionsMenu, { actions: [{ label: "Edit", onSelect }] })
        )
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })
      );
      await Promise.resolve();
    });
    expect(onRowClick).not.toHaveBeenCalled();

    const item = document.body.querySelector<HTMLElement>('[role="menuitem"]')!;
    expect(item.textContent).toContain("Edit");
    await act(async () => {
      item.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onRowClick).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.dataset.state).toBe("closed");
  });
});
