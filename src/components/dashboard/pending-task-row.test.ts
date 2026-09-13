// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PendingTaskRow } from "@/components/dashboard/pending-task-row";
import { resolvePendingTaskDestination } from "@/lib/dashboard/pending-task-destination";
import type { Task } from "@/lib/db/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) =>
    createElement("a", { href, ...props }, children),
}));

describe("PendingTaskRow", () => {
  it("is a keyboard-native, visibly focusable link to the exact task", () => {
    const task = {
      id: "task-1",
      title: "Follow up with Ada",
      description: "Review the latest context first",
      priority: "high",
    } as Pick<Task, "id" | "title" | "description" | "priority">;

    const html = renderToStaticMarkup(
      createElement(PendingTaskRow, {
        task,
        destination: resolvePendingTaskDestination(task),
      }),
    );

    expect(html).toContain('<a href="/dashboard/tasks/task-1"');
    expect(html).toContain('aria-label="Open task: Follow up with Ada"');
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("Review the latest context first");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("/dashboard/quarantine");
  });
});
