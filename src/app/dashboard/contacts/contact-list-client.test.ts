// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactListClient } from "@/app/dashboard/contacts/contact-list-client";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("@/components/add-contact-dialog", () => ({
  AddContactDialog: () => createElement("button", { type: "button" }, "Add Contact"),
}));

vi.mock("@/components/pagination-controls", () => ({
  PaginationControls: () => null,
}));

vi.mock("@/components/ui/select", () => {
  function passthrough(tag: string) {
    function SelectStub({ children }: { children?: React.ReactNode }) {
      return createElement(tag, null, children);
    }
    return SelectStub;
  }
  return {
    Select: passthrough("div"),
    SelectContent: passthrough("div"),
    SelectItem: passthrough("option"),
    SelectTrigger: passthrough("div"),
    SelectValue: passthrough("span"),
  };
});

const listContact = {
  id: "c1",
  name: "Trung Le",
  firstName: "Trung",
  lastName: "Le",
  headline: "Founder @ RealTimeX.ai",
  company: "RealTimeX.ai",
  title: "Founder",
  isSelf: true,
  enrichmentScore: 56,
  funnelStage: "prospect",
  metadata: "{}",
  identities: [
    { id: "li-1", platform: "linkedin" },
    { id: "fb-1", platform: "facebook" },
  ],
  resolvedAvatarUrl: null,
} as unknown as ContactDTO;

describe("ContactListClient", () => {
  it("renders platform marks instead of raw slugs and drops empty company dashes", () => {
    const html = renderToStaticMarkup(
      createElement(ContactListClient, {
        contacts: [listContact],
        total: 1,
        page: 1,
        pageSize: 25,
      }),
    );
    expect(html).toContain("Trung Le");
    expect(html).toContain("Founder · RealTimeX.ai");
    expect(html).toContain("Facebook");
    expect(html).toContain("LinkedIn");
    expect(html).toContain("Prospect");
    expect(html).toContain("Identities");
    expect(html).toContain("Stage");
    expect(html).toContain("min-w-[7.5rem]");
    expect(html).not.toContain("table-fixed");
    expect(html).not.toContain("Your profile");
    expect(html).not.toContain(">facebook<");
    expect(html).not.toContain(">LI<");
    expect(html).not.toContain(">Company<");
    expect(html).not.toContain("—");
  });
});
