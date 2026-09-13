// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/db/types";

const queries = vi.hoisted(() => ({
  getTaskById: vi.fn(),
  getContactById: vi.fn(),
  getOrgById: vi.fn(),
}));

vi.mock("@/lib/db/queries/tasks", () => ({ getTaskById: queries.getTaskById }));
vi.mock("@/lib/db/queries/contacts", () => ({ getContactById: queries.getContactById }));
vi.mock("@/lib/db/queries/orgs", () => ({ getOrgById: queries.getOrgById }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) =>
    createElement("a", { href, ...props }, children),
}));

import TaskDetailPage from "@/app/dashboard/tasks/[id]/page";

const task = {
  id: "task-1",
  title: "Follow up",
  description: "Read the full context",
  taskType: "follow_up",
  status: "todo",
  priority: "high",
  assignee: "user",
  relatedContactId: null,
  relatedOrgId: null,
  relatedTemplateId: null,
  dueAt: null,
  completedAt: null,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
} satisfies Task;

async function renderTask(id = task.id): Promise<string> {
  const page = await TaskDetailPage({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(page);
}

describe("TaskDetailPage", () => {
  beforeEach(() => {
    queries.getTaskById.mockReset();
    queries.getContactById.mockReset();
    queries.getOrgById.mockReset();
  });

  it("shows an unlinked task without guessing a quarantine destination", async () => {
    queries.getTaskById.mockReturnValue(task);

    const html = await renderTask();

    expect(html).toContain("Read the full context");
    expect(html).toContain("This task has no linked CRM record");
    expect(html).not.toContain("/dashboard/quarantine");
  });

  it("links a valid related contact by stable id", async () => {
    queries.getTaskById.mockReturnValue({ ...task, relatedContactId: "contact-1" });
    queries.getContactById.mockReturnValue({ id: "contact-1", name: "Ada Lovelace" });

    const html = await renderTask();

    expect(html).toContain('href="/dashboard/contacts/contact-1"');
    expect(html).toContain("Open contact: Ada Lovelace");
  });

  it("links a valid related organization by stable id", async () => {
    queries.getTaskById.mockReturnValue({ ...task, relatedOrgId: "org-1" });
    queries.getOrgById.mockReturnValue({ id: "org-1", name: "Analytical Engines" });

    const html = await renderTask();

    expect(html).toContain('href="/dashboard/organizations/org-1"');
    expect(html).toContain("Open organization: Analytical Engines");
  });

  it("makes a stale related contact explicit and offers a valid fallback", async () => {
    queries.getTaskById.mockReturnValue({ ...task, relatedContactId: "missing-contact" });
    queries.getContactById.mockReturnValue(undefined);

    const html = await renderTask();

    expect(html).toContain("Related contact unavailable");
    expect(html).toContain('href="/dashboard/contacts"');
    expect(html).toContain("Browse contacts");
  });

  it("makes a deleted task explicit and returns to the pending-work list", async () => {
    queries.getTaskById.mockReturnValue(undefined);

    const html = await renderTask("deleted-task");

    expect(html).toContain("Task unavailable");
    expect(html).toContain('href="/dashboard#pending-tasks"');
    expect(html).toContain("Return to pending tasks");
  });
});
