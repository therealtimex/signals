import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveRtxStorageDir,
  resolveRtxWorkspaceWorkingDir,
} from "@/lib/rtx/storage-path";

describe("resolveRtxStorageDir", () => {
  it("prefers STORAGE_DIR when set", () => {
    expect(resolveRtxStorageDir({ STORAGE_DIR: "/tmp/rtx-storage" })).toBe("/tmp/rtx-storage");
  });

  it("derives storage from REALTIMEX_USER_DATA_PATH and current-user.json", () => {
    const userDataRoot = mkdtempSync(join(tmpdir(), "rtx-user-data-"));
    mkdirSync(join(userDataRoot, "state"), { recursive: true });
    writeFileSync(
      join(userDataRoot, "state", "current-user.json"),
      JSON.stringify({ userId: "qa_user" }),
      "utf8"
    );

    expect(
      resolveRtxStorageDir({
        REALTIMEX_USER_DATA_PATH: userDataRoot,
      })
    ).toBe(join(userDataRoot, "users", "qa_user", "storage"));
  });
});

describe("resolveRtxWorkspaceWorkingDir", () => {
  it("joins working-data with workspace slug", () => {
    const dir = resolveRtxWorkspaceWorkingDir("signals", { STORAGE_DIR: "/data/rtx" });
    expect(dir).toBe("/data/rtx/working-data/signals");
  });
});
