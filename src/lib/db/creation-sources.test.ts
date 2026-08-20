import { describe, expect, it } from "vitest";
import {
  formatContactSourceLine,
  resolveCreatedSourceDetailForFilter,
  CreatedSourceDetailFilterError,
} from "@/lib/db/creation-sources";

describe("creation source filters", () => {
  it("resolves bare suffix x_archive to import:x_archive", () => {
    expect(resolveCreatedSourceDetailForFilter("x_archive")).toBe("import:x_archive");
  });

  it("rejects ambiguous bare suffix create_contact", () => {
    expect(() => resolveCreatedSourceDetailForFilter("create_contact")).toThrow(
      CreatedSourceDetailFilterError,
    );
  });

  it("formats manual source lines", () => {
    expect(
      formatContactSourceLine({
        createdSource: "manual",
        createdSourceDetail: "manual:create_contact",
        createdWorkflowRunId: null,
        createdAt: 1_700_000_000,
      }),
    ).toMatch(/^Added manually · /);
  });

  it("formats import source lines with run fragment", () => {
    expect(
      formatContactSourceLine({
        createdSource: "import",
        createdSourceDetail: "import:x_archive",
        createdWorkflowRunId: "abcdefghijklmnop",
        createdAt: 1_700_000_000,
      }),
    ).toContain("X archive import");
    expect(
      formatContactSourceLine({
        createdSource: "import",
        createdSourceDetail: "import:x_archive",
        createdWorkflowRunId: "abcdefghijklmnop",
        createdAt: 1_700_000_000,
      }),
    ).toContain("run abcdefgh");
  });
});
