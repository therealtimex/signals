#!/usr/bin/env node
/**
 * Unit tests for x-compose-text.cjs snapshot matching.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  composeSnapshotFromText,
  matchComposeSnapshot,
  normalizeComposeText,
  paragraphBlocks,
  publishedReplyMatches,
  readComposeSnapshotEvalJs,
  selectComposeContentsEvalJs,
} = require(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    ".claude",
    "skills",
    "signals-publish",
    "scripts",
    "x-compose-text.cjs"
  )
);

const drafted = `Your files and repo are safe—agent memory is just metadata.

1. Copy your memory rules into AGENTS.md.
2. Standardize skills into standalone CLI scripts.
3. Test Codex in a separate git worktree first.`;

const lastOnly = paragraphBlocks(drafted).at(-1);

if (normalizeComposeText(drafted) === normalizeComposeText(lastOnly)) {
  console.error("drafted text should not collapse to the last paragraph");
  process.exit(1);
}

const full = composeSnapshotFromText(drafted);
const fullMatch = matchComposeSnapshot(full, drafted);
if (!fullMatch.ok) {
  console.error("full snapshot should match drafted text", fullMatch);
  process.exit(1);
}

const truncated = composeSnapshotFromText(drafted, { truncateToActiveBlock: true });
if (truncated.innerText !== drafted) {
  console.error("truncated snapshot should still expose full innerText");
  process.exit(1);
}
if (truncated.selectionText === drafted) {
  console.error("truncated snapshot selection should be the active block only");
  process.exit(1);
}
const truncatedMatch = matchComposeSnapshot(truncated, drafted);
if (truncatedMatch.ok || truncatedMatch.reason !== "editor_selection_mismatch") {
  console.error("truncated active block must fail the pre-submit gate", truncatedMatch);
  process.exit(1);
}

const missingEvidence = matchComposeSnapshot(
  { ok: true, innerText: drafted, blocks: [], selectionText: "", text: drafted },
  drafted
);
if (missingEvidence.ok || missingEvidence.reason !== "missing_selection") {
  console.error("empty selection must fail closed even when innerText matches", missingEvidence);
  process.exit(1);
}

const missingBlocks = matchComposeSnapshot(
  { ok: true, innerText: drafted, blocks: [], selectionText: drafted, text: drafted },
  drafted
);
if (missingBlocks.ok || missingBlocks.reason !== "missing_blocks") {
  console.error("empty blocks must fail closed even when innerText matches", missingBlocks);
  process.exit(1);
}

const missingLeaves = matchComposeSnapshot(
  {
    ok: true,
    innerText: drafted,
    blocks: paragraphBlocks(drafted),
    selectionText: drafted,
    text: drafted,
  },
  drafted
);
if (missingLeaves.ok || missingLeaves.reason !== "missing_draft_leaves") {
  console.error("missing Draft leaves must fail closed even when DOM matches", missingLeaves);
  process.exit(1);
}

const flattened = matchComposeSnapshot(
  {
    ok: true,
    innerText: drafted,
    blocks: [normalizeComposeText(drafted)],
    leafBlocks: [normalizeComposeText(drafted)],
    leafText: normalizeComposeText(drafted),
    selectionText: drafted,
    text: drafted,
  },
  drafted
);
if (flattened.ok || flattened.reason !== "editor_blocks_mismatch") {
  console.error("flattened single block must not match multi-paragraph draft", flattened);
  process.exit(1);
}

const incidentDom = matchComposeSnapshot(
  {
    ok: true,
    innerText: drafted,
    blocks: paragraphBlocks(drafted),
    leafBlocks: [lastOnly],
    leafText: lastOnly,
    selectionText: drafted,
    text: drafted,
  },
  drafted
);
if (incidentDom.ok || incidentDom.reason !== "draft_leaf_mismatch") {
  console.error(
    "full DOM with last-paragraph Draft leaves must fail (incident signature)",
    incidentDom
  );
  process.exit(1);
}

const incidentEditor = matchComposeSnapshot(
  {
    ok: true,
    innerText: drafted,
    blocks: paragraphBlocks(drafted),
    leafBlocks: paragraphBlocks(drafted),
    leafText: drafted,
    editorPlainText: lastOnly,
    selectionText: drafted,
    text: drafted,
  },
  drafted
);
if (incidentEditor.ok || incidentEditor.reason !== "editor_state_mismatch") {
  console.error(
    "full DOM/leaves with last-paragraph EditorState must fail",
    incidentEditor
  );
  process.exit(1);
}

const collapsedSelection = matchComposeSnapshot(
  {
    ok: true,
    innerText: drafted,
    blocks: paragraphBlocks(drafted),
    leafBlocks: paragraphBlocks(drafted),
    leafText: drafted,
    editorPlainText: drafted,
    selectionText: paragraphBlocks(drafted).join(""),
    text: drafted,
  },
  drafted
);
if (!collapsedSelection.ok) {
  console.error(
    "range.toString() without Draft block breaks must still pass when blocks match",
    collapsedSelection
  );
  process.exit(1);
}

if (!publishedReplyMatches(drafted, drafted)) {
  console.error("full tweet body must match the drafted reply");
  process.exit(1);
}
const prefixOnly = normalizeComposeText(drafted).slice(0, 80);
if (publishedReplyMatches(prefixOnly, drafted)) {
  console.error("first-80-character tweet body must not match the full draft");
  process.exit(1);
}
if (publishedReplyMatches(paragraphBlocks(drafted)[0], drafted)) {
  console.error("first paragraph alone must not match the full draft");
  process.exit(1);
}

const selectJs = selectComposeContentsEvalJs('[data-testid="tweetTextarea_0"]');
if (
  !selectJs.includes("signals-compose-select") ||
  !selectJs.includes("selectNodeContents")
) {
  console.error("select eval must range-select the target editable only");
  process.exit(1);
}
if (
  selectJs.includes("execCommand") ||
  selectJs.includes("insertParagraph") ||
  selectJs.includes("insertText")
) {
  console.error("select eval must not use execCommand insert/delete/selectAll");
  process.exit(1);
}

const snapshotJs = readComposeSnapshotEvalJs('[data-testid="tweetTextarea_0"]');
if (
  !snapshotJs.includes("signals-compose-snapshot") ||
  !snapshotJs.includes('data-text="true"') ||
  !snapshotJs.includes("selectNodeContents")
) {
  console.error("snapshot eval must read Draft leaves via a per-editable range");
  process.exit(1);
}
if (snapshotJs.includes("execCommand") || snapshotJs.includes("selectAll")) {
  console.error("snapshot eval must not call document.execCommand or selectAll");
  process.exit(1);
}
if (
  snapshotJs.includes("editorNorm !== leafNorm") ||
  snapshotJs.includes("editorNorm !== innerNorm")
) {
  console.error(
    "snapshot eval must not drop a readable EditorState that disagrees with the DOM"
  );
  process.exit(1);
}
if (!snapshotJs.includes("Keep the closest reading")) {
  console.error("snapshot eval must keep a desynced EditorState for fail-closed matching");
  process.exit(1);
}

const publishSrc = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    ".claude",
    "skills",
    "signals-publish",
    "scripts",
    "x-publish.cjs"
  ),
  "utf8"
);
if (publishSrc.includes("Control+a") || publishSrc.includes("Meta+a")) {
  console.error("x-publish retry must range-select the editable, not Control/Meta+a");
  process.exit(1);
}

console.log("x-compose-text helpers: OK");
