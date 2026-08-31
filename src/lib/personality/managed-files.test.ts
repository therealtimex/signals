import { describe, expect, it } from "vitest";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  mergeManagedFile,
  parseManagedFile,
  unifiedDiff,
} from "@/lib/personality/managed-files";
import { markerEnd, markerStart } from "@/lib/personality/contracts";
import { sha256 } from "@/lib/writing/hash";

const BINDING = "pb_binding01" as const;
const SOURCE = "a".repeat(64);
const BODY = "## Identity (managed by Signals)\nName: Ada";

function wrapper(body = BODY, binding: `pb_${string}` = BINDING, eol = "\n") {
  return [
    markerStart("identity", binding, SOURCE),
    body.replace(/\n/g, eol),
    markerEnd("identity"),
  ].join(eol);
}

function applySimpleUnifiedDiff(before: string, diff: string): string {
  const source = before === "" ? [] : before.split("\n");
  if (before.endsWith("\n")) source.pop();
  const result: string[] = [];
  let cursor = 0;
  const lines = diff.trimEnd().split("\n").slice(2);
  for (let index = 0; index < lines.length;) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(lines[index]);
    if (!header) throw new Error(`Invalid test diff hunk: ${lines[index]}`);
    const oldStart = Number(header[1]);
    result.push(...source.slice(cursor, oldStart === 0 ? 0 : oldStart - 1));
    cursor = oldStart === 0 ? 0 : oldStart - 1;
    index += 1;
    while (index < lines.length && !lines[index].startsWith("@@ ")) {
      const line = lines[index];
      if (line === "\\ No newline at end of file") {
        index += 1;
        continue;
      }
      if (line.startsWith(" ")) {
        result.push(line.slice(1));
        cursor += 1;
      } else if (line.startsWith("-")) {
        cursor += 1;
      } else if (line.startsWith("+")) {
        result.push(line.slice(1));
      }
      index += 1;
    }
  }
  result.push(...source.slice(cursor));
  return result.join("\n");
}

describe("managed Personality files", () => {
  it("preserves unmanaged CRLF bytes and replaces only the managed span", () => {
    const current = `User prose\r\n\r\n${wrapper("Old", BINDING, "\r\n")}\r\nTail`;
    const merged = mergeManagedFile({
      path: "IDENTITY.md",
      section: "identity",
      currentFile: current,
      desiredBlock: { body: BODY, blockHash: sha256(BODY) },
      bindingId: "pb_binding02",
      sourceHash: SOURCE,
    });
    expect(merged.proposedFile).toBe(
      `User prose\r\n\r\n${wrapper(BODY, "pb_binding02", "\r\n")}\r\nTail`,
    );
    expect(merged.unmanagedBytes).toBe(Buffer.byteLength("User prose\r\n\r\n\r\nTail"));
  });

  it("collapses complete duplicates but refuses ambiguous or wrong-section markers", () => {
    const duplicated = `${wrapper()}\nkeep\n${wrapper()}`;
    const merged = mergeManagedFile({
      path: "IDENTITY.md",
      section: "identity",
      currentFile: duplicated,
      desiredBlock: { body: BODY, blockHash: sha256(BODY) },
      bindingId: BINDING,
      sourceHash: SOURCE,
    });
    expect(merged.repair).toBe("duplicate_block");
    expect(parseManagedFile("IDENTITY.md", "identity", merged.proposedFile).spans).toHaveLength(1);
    expect(() => parseManagedFile(
      "IDENTITY.md",
      "identity",
      markerStart("identity", BINDING, SOURCE),
    )).toThrowError(AgentToolError);
    expect(() => parseManagedFile(
      "IDENTITY.md",
      "identity",
      `${markerStart("voice", BINDING, SOURCE)}\nvoice\n${markerEnd("voice")}`,
    )).toThrowError(AgentToolError);
  });

  it("removes only managed bytes and deletes a file only when no prose remains", () => {
    const kept = mergeManagedFile({
      path: "IDENTITY.md",
      section: "identity",
      currentFile: `Before\n${wrapper()}\nAfter`,
      desiredBlock: null,
      bindingId: BINDING,
      sourceHash: "",
    });
    expect(kept.proposedFile).toBe("Before\n\nAfter");
    const removed = mergeManagedFile({
      path: "IDENTITY.md",
      section: "identity",
      currentFile: `\uFEFF \n${wrapper()}\n`,
      desiredBlock: null,
      bindingId: BINDING,
      sourceHash: "",
    });
    expect(removed.proposedFile).toBeNull();
  });

  it("renders deterministic Myers hunks whose edits reconstruct the proposed LF text", () => {
    const before = "one\ntwo\nthree\nfour";
    const after = "zero\none\nthree\nfour\nfive";
    const diff = unifiedDiff("VOICE.md", before, after);
    expect(diff).toContain("--- a/VOICE.md\n+++ b/VOICE.md\n");
    expect(diff).toContain("\\ No newline at end of file");
    expect(applySimpleUnifiedDiff(before, diff)).toBe(after);
    expect(unifiedDiff("VOICE.md", before, after)).toBe(diff);
    for (const [oldText, newText] of [
      ["", "created"],
      ["deleted", ""],
      ["a\nb\nc\nd\ne\nf\ng\nh\ni", "a\nB\nc\nd\ne\nf\ng\nH\ni"],
      ["same\nend", "same\ninserted\nend"],
    ]) {
      expect(applySimpleUnifiedDiff(
        oldText,
        unifiedDiff("IDENTITY.md", oldText, newText),
      )).toBe(newText);
    }
  });
});
