// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HelpPage from "@/app/dashboard/help/page";

const navigation = vi.hoisted(() => ({ tab: null as string | null }));

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(navigation.tab ? { tab: navigation.tab } : undefined),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

describe("HelpPage", () => {
  beforeEach(() => {
    navigation.tab = null;
  });

  it("presents the current RealTimeX, browser, import, and Himalaya setup model", () => {
    const html = renderToStaticMarkup(createElement(HelpPage));

    expect(html).toContain("How Signals Connects");
    expect(html).toContain("Standalone LLM access configured");
    expect(html).toContain("Himalaya mail account registered");
    expect(html).toContain("Mail Setup");
    expect(html).not.toContain("First contact sync completed");
    expect(html).not.toContain("Environment Setup");
  });

  it.each([
    ["x-setup", "Recommended X Setup", "Create X Developer App"],
    ["linkedin-setup", "Recommended LinkedIn Setup", "Create LinkedIn App"],
    ["gmail-setup", "Mail and Google Contacts", "Configure OAuth Consent Screen"],
    ["features", "Content, Launches &amp; Wind Tunnel", "Tasks"],
    ["faq", "Do I need social-platform developer API keys?", "$200/mo"],
  ])("updates the %s guidance", (tab, currentText, obsoleteText) => {
    navigation.tab = tab;
    const html = renderToStaticMarkup(createElement(HelpPage));

    expect(html).toContain(currentText);
    expect(html).not.toContain(obsoleteText);
  });
});
