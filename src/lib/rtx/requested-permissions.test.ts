import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RTX_SDK_PERMISSIONS } from "@/lib/rtx/manifest";
import { devNeedsPath, resolveRequestedRtxPermissions } from "@/lib/rtx/requested-permissions";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "signals-rtx-needs-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function writeNeeds(content: string): void {
  mkdirSync(join(dataDir, ".launcher"), { recursive: true });
  writeFileSync(join(dataDir, ".launcher", "needs.json"), content);
}

const dev = () => ({ SIGNALS_INSTANCE: "dev", SIGNALS_DATA_DIR: dataDir });

describe("resolveRequestedRtxPermissions", () => {
  it("asks the canonical app for the whole manifest and never reads needs.json", () => {
    const readFile = vi.fn(() => JSON.stringify({ needs: ["llm.chat"] }));
    for (const env of [{ SIGNALS_DATA_DIR: dataDir }, { SIGNALS_INSTANCE: "canonical", SIGNALS_DATA_DIR: dataDir }, {}]) {
      expect(resolveRequestedRtxPermissions(env, readFile)).toEqual(RTX_SDK_PERMISSIONS);
    }
    expect(readFile).not.toHaveBeenCalled();
    expect(RTX_SDK_PERMISSIONS).toHaveLength(8);
  });

  it("asks a Dev app for nothing when its slot has no needs.json", () => {
    expect(resolveRequestedRtxPermissions(dev())).toEqual([]);
  });

  it("asks a Dev app only for the slot's needs, in manifest order", () => {
    writeNeeds(JSON.stringify({ schemaVersion: 1, kind: "signals-dev-needs", needs: ["llm.embed", "llm.chat"] }));
    expect(resolveRequestedRtxPermissions(dev())).toEqual(["llm.embed", "llm.chat"]);
    writeNeeds(JSON.stringify({ needs: ["llm.chat", "llm.embed"] }));
    expect(resolveRequestedRtxPermissions(dev())).toEqual(["llm.embed", "llm.chat"]);
  });

  it("drops names outside the manifest, so a Dev app never asks for more than the canonical app", () => {
    writeNeeds(JSON.stringify({ needs: ["llm.chat", "admin.everything", 7, null, "LLM.CHAT"] }));
    expect(resolveRequestedRtxPermissions(dev())).toEqual(["llm.chat"]);
  });

  it("asks for nothing when needs.json is unreadable or has no needs list", () => {
    for (const content of ["{", "null", "[]", '["llm.chat"]', '{"needs":"llm.chat"}', '{"needs":{"llm.chat":true}}', ""]) {
      writeNeeds(content);
      expect(resolveRequestedRtxPermissions(dev()), content).toEqual([]);
    }
  });

  it("reads <SIGNALS_DATA_DIR>/.launcher/needs.json, expanding a leading ~", () => {
    expect(devNeedsPath(dev())).toBe(join(dataDir, ".launcher", "needs.json"));
    expect(devNeedsPath({ SIGNALS_INSTANCE: "dev", SIGNALS_DATA_DIR: "~/.signals-dev/main" })).toBe(
      join(homedir(), ".signals-dev", "main", ".launcher", "needs.json")
    );
    const readFile = vi.fn(() => JSON.stringify({ needs: ["llm.chat"] }));
    expect(resolveRequestedRtxPermissions(dev(), readFile)).toEqual(["llm.chat"]);
    expect(readFile).toHaveBeenCalledWith(join(dataDir, ".launcher", "needs.json"));
  });
});
