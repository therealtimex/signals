#!/usr/bin/env node
/**
 * Unit tests for x-compose-text.cjs snapshot matching.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  composeSnapshotFromText,
  insertComposeTextEvalJs,
  matchComposeSnapshot,
  normalizeComposeText,
  paragraphBlocks,
  readComposeSnapshotEvalJs,
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

const insertJs = insertComposeTextEvalJs('[data-testid="tweetTextarea_0"]', drafted);
if (!insertJs.includes("signals-compose-insert") || !insertJs.includes("insertText")) {
  console.error("insert eval must be a single-pass insertText payload");
  process.exit(1);
}
if (insertJs.includes("insertParagraph") || insertJs.split("execCommand(\"insertText\"").length < 2) {
  console.error("insert eval must not split paragraphs");
  process.exit(1);
}
if (!insertJs.includes(JSON.stringify(drafted))) {
  console.error("insert eval must carry the entire drafted string in one payload");
  process.exit(1);
}

const snapshotJs = readComposeSnapshotEvalJs('[data-testid="tweetTextarea_0"]');
if (!snapshotJs.includes("signals-compose-snapshot") || !snapshotJs.includes("selectAll")) {
  console.error("snapshot eval must selectAll and read editor blocks");
  process.exit(1);
}

console.log("x-compose-text helpers: OK");
