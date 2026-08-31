import { AgentToolError } from "@/lib/agent-tools/types";
import {
  markerEnd,
  markerStart,
  type PersonalitySection,
} from "@/lib/personality/contracts";
import { sha256 } from "@/lib/writing/hash";

export type ManagedBlockSpan = {
  start: number;
  end: number;
  bindingId: `pb_${string}`;
  sourceHashPrefix: string | null;
  body: string;
  blockHash: string;
};

export type ParsedManagedFile = {
  spans: ManagedBlockSpan[];
  currentBlockHash: string | null;
  currentBindingId: `pb_${string}` | null;
  duplicate: boolean;
  unmanagedBytes: number;
};

export type MergeManagedFileResult = ParsedManagedFile & {
  proposedFile: string | null;
  proposedFileHash: string | null;
  proposedBlock: string | null;
  proposedBlockHash: string | null;
  repair?: "duplicate_block";
};

type DiffOperation = { kind: "equal" | "delete" | "insert"; line: string };
type PositionedOperation = DiffOperation & { oldLine: number; newLine: number };

function markerAmbiguous(path: string, details: Record<string, unknown> = {}): never {
  throw new AgentToolError("VALIDATION_ERROR", `Personality markers are ambiguous in ${path}`, {
    reason: "marker_ambiguous",
    path,
    ...details,
  });
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function eolFor(value: string): "\r\n" | "\n" {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function withoutSpans(content: string, spans: ManagedBlockSpan[]): string {
  let cursor = 0;
  let result = "";
  for (const span of spans) {
    result += content.slice(cursor, span.start);
    cursor = span.end;
  }
  return result + content.slice(cursor);
}

export function unmanagedPersonalityContent(
  content: string,
  parsed: ParsedManagedFile,
): string {
  return withoutSpans(content, parsed.spans);
}

export function parseManagedFile(
  path: string,
  section: PersonalitySection,
  content: string | null,
): ParsedManagedFile {
  if (content === null) {
    return {
      spans: [],
      currentBlockHash: null,
      currentBindingId: null,
      duplicate: false,
      unmanagedBytes: 0,
    };
  }
  const markerLikeCount = content.split("signals:personality:").length - 1;
  const commentPattern = /<!--[\s\S]*?-->/g;
  const markerComments: Array<{ text: string; start: number; end: number }> = [];
  for (const match of content.matchAll(commentPattern)) {
    if (!match[0].includes("signals:personality:")) continue;
    markerComments.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  if (markerComments.length !== markerLikeCount) {
    markerAmbiguous(path, { reasonDetail: "malformed_comment" });
  }

  const exactStart = new RegExp(
    `^<!-- signals:personality:${section}:start v=1 binding=(pb_[A-Za-z0-9_-]{6,})${section === "index" ? "" : " source=([a-f0-9]{12})"} -->$`,
  );
  const exactEnd = `<!-- signals:personality:${section}:end -->`;
  const spans: ManagedBlockSpan[] = [];
  let pending: { start: number; markerEnd: number; bindingId: `pb_${string}`; source: string | null } | null = null;

  for (const marker of markerComments) {
    const start = exactStart.exec(marker.text);
    if (start) {
      if (pending) markerAmbiguous(path, { reasonDetail: "nested_start" });
      pending = {
        start: marker.start,
        markerEnd: marker.end,
        bindingId: start[1] as `pb_${string}`,
        source: start[2] ?? null,
      };
      continue;
    }
    if (marker.text !== exactEnd || !pending) {
      markerAmbiguous(path, { reasonDetail: "wrong_or_orphan_marker" });
    }
    const between = content.slice(pending.markerEnd, marker.start);
    const wrappedBody = /^(?:\r\n|\n)([\s\S]*)(?:\r\n|\n)$/.exec(between);
    if (!wrappedBody) markerAmbiguous(path, { reasonDetail: "invalid_wrapper" });
    const body = normalizeLf(wrappedBody[1]);
    spans.push({
      start: pending.start,
      end: marker.end,
      bindingId: pending.bindingId,
      sourceHashPrefix: pending.source,
      body,
      blockHash: sha256(body),
    });
    pending = null;
  }
  if (pending) markerAmbiguous(path, { reasonDetail: "missing_end_marker" });
  const unmanaged = withoutSpans(content, spans);
  return {
    spans,
    currentBlockHash: spans[0]?.blockHash ?? null,
    currentBindingId: spans[0]?.bindingId ?? null,
    duplicate: spans.length > 1,
    unmanagedBytes: Buffer.byteLength(unmanaged, "utf8"),
  };
}

function appendWrapper(content: string, wrapper: string, eol: string): string {
  if (content === "") return wrapper;
  if (content.endsWith(`${eol}${eol}`)) return content + wrapper;
  if (content.endsWith(eol)) return content + eol + wrapper;
  return content + eol + eol + wrapper;
}

function onlyWhitespaceOrBom(value: string): boolean {
  return value.replace(/^\uFEFF/, "").trim() === "";
}

export function mergeManagedFile(input: {
  path: string;
  section: PersonalitySection;
  currentFile: string | null;
  desiredBlock: { body: string; blockHash: string } | null;
  bindingId: `pb_${string}`;
  sourceHash: string;
}): MergeManagedFileResult {
  const parsed = parseManagedFile(input.path, input.section, input.currentFile);
  const current = input.currentFile ?? "";
  const eol = eolFor(current);
  let proposed: string | null;

  if (input.desiredBlock) {
    const start = markerStart(input.section, input.bindingId, input.sourceHash);
    const end = markerEnd(input.section);
    const body = input.desiredBlock.body.replace(/\n/g, eol);
    const wrapper = `${start}${eol}${body}${eol}${end}`;
    if (parsed.spans.length === 0) {
      proposed = appendWrapper(current, wrapper, eol);
    } else {
      let cursor = 0;
      let output = "";
      parsed.spans.forEach((span, index) => {
        output += current.slice(cursor, span.start);
        if (index === 0) output += wrapper;
        cursor = span.end;
      });
      proposed = output + current.slice(cursor);
    }
  } else if (parsed.spans.length === 0) {
    proposed = input.currentFile;
  } else {
    const unmanaged = withoutSpans(current, parsed.spans);
    proposed = onlyWhitespaceOrBom(unmanaged) ? null : unmanaged;
  }

  return {
    ...parsed,
    proposedFile: proposed,
    proposedFileHash: proposed === null ? null : sha256(Buffer.from(proposed, "utf8")),
    proposedBlock: input.desiredBlock?.body ?? null,
    proposedBlockHash: input.desiredBlock?.blockHash ?? null,
    ...(parsed.duplicate ? { repair: "duplicate_block" as const } : {}),
  };
}

function displayLines(value: string | null): { lines: string[]; finalNewline: boolean } {
  if (value === null || value === "") return { lines: [], finalNewline: false };
  const normalized = normalizeLf(value);
  const finalNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (finalNewline) lines.pop();
  return { lines, finalNewline };
}

function valueAt(values: Map<number, number>, key: number): number {
  return values.get(key) ?? Number.NEGATIVE_INFINITY;
}

function myersOperations(before: string[], after: string[]): DiffOperation[] {
  const maximum = before.length + after.length;
  const trace: Array<Map<number, number>> = [];
  const frontier = new Map<number, number>([[1, 0]]);
  let distance = 0;
  outer: for (let d = 0; d <= maximum; d += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -d; diagonal <= d; diagonal += 2) {
      let x = diagonal === -d || (
        diagonal !== d
        && valueAt(frontier, diagonal - 1) < valueAt(frontier, diagonal + 1)
      )
        ? valueAt(frontier, diagonal + 1)
        : valueAt(frontier, diagonal - 1) + 1;
      if (!Number.isFinite(x)) x = 0;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);
      if (x >= before.length && y >= after.length) {
        distance = d;
        break outer;
      }
    }
  }

  const reversed: DiffOperation[] = [];
  let x = before.length;
  let y = after.length;
  for (let d = distance; d >= 0; d -= 1) {
    const previous = trace[d];
    const diagonal = x - y;
    const previousDiagonal = diagonal === -d || (
      diagonal !== d
      && valueAt(previous, diagonal - 1) < valueAt(previous, diagonal + 1)
    ) ? diagonal + 1 : diagonal - 1;
    const previousX = valueAt(previous, previousDiagonal);
    const safePreviousX = Number.isFinite(previousX) ? previousX : 0;
    const previousY = safePreviousX - previousDiagonal;
    while (x > safePreviousX && y > previousY) {
      reversed.push({ kind: "equal", line: before[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (d === 0) break;
    if (x === safePreviousX) {
      reversed.push({ kind: "insert", line: after[y - 1] });
      y -= 1;
    } else {
      reversed.push({ kind: "delete", line: before[x - 1] });
      x -= 1;
    }
  }
  return reversed.reverse();
}

function positionOperations(operations: DiffOperation[]): PositionedOperation[] {
  let oldLine = 1;
  let newLine = 1;
  return operations.map((operation) => {
    const positioned = { ...operation, oldLine, newLine };
    if (operation.kind !== "insert") oldLine += 1;
    if (operation.kind !== "delete") newLine += 1;
    return positioned;
  });
}

function hunkRanges(operations: PositionedOperation[]): Array<[number, number]> {
  const changed = operations.flatMap((operation, index) =>
    operation.kind === "equal" ? [] : [index]);
  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - 3);
    const end = Math.min(operations.length, index + 4);
    const previous = ranges.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}

function representLineTerminationChanges(
  operations: DiffOperation[],
  before: ReturnType<typeof displayLines>,
  after: ReturnType<typeof displayLines>,
): DiffOperation[] {
  const represented: DiffOperation[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const operation of operations) {
    const oldTerminated = oldLine < before.lines.length || before.finalNewline;
    const newTerminated = newLine < after.lines.length || after.finalNewline;
    if (
      operation.kind === "equal"
      && oldTerminated !== newTerminated
    ) {
      represented.push(
        { kind: "delete", line: operation.line },
        { kind: "insert", line: operation.line },
      );
    } else {
      represented.push(operation);
    }
    if (operation.kind !== "insert") oldLine += 1;
    if (operation.kind !== "delete") newLine += 1;
  }
  return represented;
}

export function unifiedDiff(
  path: string,
  beforeValue: string | null,
  afterValue: string | null,
): string {
  if (beforeValue === afterValue) return "";
  const before = displayLines(beforeValue);
  const after = displayLines(afterValue);
  const operations = positionOperations(representLineTerminationChanges(
    myersOperations(before.lines, after.lines),
    before,
    after,
  ));
  const output = [`--- a/${path}`, `+++ b/${path}`];
  for (const [start, end] of hunkRanges(operations)) {
    const hunk = operations.slice(start, end);
    const oldCount = hunk.filter((operation) => operation.kind !== "insert").length;
    const newCount = hunk.filter((operation) => operation.kind !== "delete").length;
    const rawOldStart = hunk[0]?.oldLine ?? 1;
    const rawNewStart = hunk[0]?.newLine ?? 1;
    const oldStart = oldCount === 0 ? Math.max(0, rawOldStart - 1) : rawOldStart;
    const newStart = newCount === 0 ? Math.max(0, rawNewStart - 1) : rawNewStart;
    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const operation of hunk) {
      const prefix = operation.kind === "equal" ? " " : operation.kind === "delete" ? "-" : "+";
      output.push(`${prefix}${operation.line}`);
      const oldLast = operation.kind !== "insert" && operation.oldLine === before.lines.length;
      const newLast = operation.kind !== "delete" && operation.newLine === after.lines.length;
      if ((oldLast && !before.finalNewline) || (newLast && !after.finalNewline)) {
        output.push("\\ No newline at end of file");
      }
    }
  }
  return output.join("\n") + "\n";
}
