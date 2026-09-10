"use strict";

/**
 * Shared X Draft.js / Lexical compose helpers.
 *
 * Multi-paragraph replies must be injected as one insertText payload. Splitting on
 * newline / insertParagraph creates separate ContentBlocks; X then serializes only
 * the focused active block on submit even when innerText still shows every line.
 */

function normalizeComposeText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphBlocks(text) {
  return String(text ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function composeSnapshotFromText(text, options = {}) {
  const full = String(text ?? "");
  const blocks = paragraphBlocks(full);
  const last = blocks[blocks.length - 1] || "";
  if (options.truncateToActiveBlock && blocks.length > 1) {
    return {
      ok: true,
      innerText: full,
      blocks: [last],
      focusedBlockText: last,
      selectionText: last,
      text: normalizeComposeText(full),
    };
  }
  return {
    ok: true,
    innerText: full,
    blocks: blocks.length ? blocks : full ? [full] : [],
    focusedBlockText: last || full,
    selectionText: full,
    text: normalizeComposeText(full),
  };
}

function matchComposeSnapshot(snapshot, expected) {
  const want = normalizeComposeText(expected);
  if (!want) {
    return { ok: true, reason: "empty_expected" };
  }
  if (!snapshot || typeof snapshot !== "object") {
    return {
      ok: false,
      reason: "missing_snapshot",
      expected: want,
      actual: "",
    };
  }

  const inner = normalizeComposeText(snapshot.innerText ?? snapshot.text ?? "");
  const selected = normalizeComposeText(snapshot.selectionText ?? "");
  const fromBlocks = normalizeComposeText(
    Array.isArray(snapshot.blocks) ? snapshot.blocks.join("\n") : ""
  );

  if (inner !== want) {
    return {
      ok: false,
      reason: "innerText_mismatch",
      expected: want,
      actual: inner,
    };
  }

  if (selected && selected !== want) {
    return {
      ok: false,
      reason: "editor_selection_mismatch",
      expected: want,
      actual: selected,
    };
  }

  if (fromBlocks && fromBlocks !== want) {
    return {
      ok: false,
      reason: "editor_blocks_mismatch",
      expected: want,
      actual: fromBlocks,
    };
  }

  return { ok: true, reason: "match", expected: want, actual: inner };
}

function findComposeEditableJs() {
  return `function signalsFindComposeEditable(root) {
    if (!root) return null;
    return (
      root.querySelector('[contenteditable="true"]') ||
      root.querySelector('[role="textbox"]') ||
      root.querySelector('[data-contents="true"]') ||
      root
    );
  }`;
}

function readComposeSnapshotFnJs() {
  return `function signalsReadComposeSnapshot(editable) {
    const innerText = String(editable.innerText || editable.textContent || "");
    const blockSelector =
      '[data-block="true"], .public-DraftStyleDefault-block, [data-contents="true"] > div, [contenteditable="true"] > p, [contenteditable="true"] > div[dir]';
    const blockNodes = Array.from(editable.querySelectorAll(blockSelector));
    const blocks = [];
    for (const node of blockNodes) {
      if (blockNodes.some((other) => other !== node && other.contains(node))) continue;
      blocks.push(String(node.innerText || node.textContent || ""));
    }
    let focusedBlockText = "";
    const sel = window.getSelection();
    let anchor = sel && sel.anchorNode;
    while (anchor && anchor !== editable) {
      if (anchor.nodeType === 1) {
        const el = anchor;
        const isBlock =
          (el.getAttribute && el.getAttribute("data-block") === "true") ||
          (el.classList && el.classList.contains("public-DraftStyleDefault-block")) ||
          el.tagName === "P";
        if (isBlock) {
          focusedBlockText = String(el.innerText || el.textContent || "");
          break;
        }
      }
      anchor = anchor.parentNode;
    }
    let selectionText = innerText;
    try {
      document.execCommand("selectAll", false, null);
      const after = window.getSelection();
      if (after) selectionText = String(after.toString() || selectionText);
    } catch {
      try {
        const range = document.createRange();
        range.selectNodeContents(editable);
        selectionText = range.toString() || selectionText;
      } catch {}
    }
    return {
      innerText,
      blocks,
      focusedBlockText,
      selectionText,
      text: innerText.replace(/\\s+/g, " ").trim(),
    };
  }`;
}

function resolveComposeRootJs(wrapperSelector) {
  return `const wrapperSelector = ${JSON.stringify(wrapperSelector)};
    const numbered = document.querySelector(wrapperSelector);
    const zeros = document.querySelectorAll('[data-testid="tweetTextarea_0"]');
    const indexMatch = String(wrapperSelector).match(/tweetTextarea_(\\d+)/) ||
      String(wrapperSelector).match(/signals-publish-thread-(\\d+)/);
    const index = indexMatch ? Number(indexMatch[1]) : 0;
    const root = numbered || zeros[index] || zeros[0] || null;`;
}

function insertComposeTextEvalJs(wrapperSelector, text) {
  return `(() => {
    /* signals-compose-insert */
    ${findComposeEditableJs()}
    ${readComposeSnapshotFnJs()}
    ${resolveComposeRootJs(wrapperSelector)}
    if (!root) return JSON.stringify({ ok: false, reason: "no_root" });
    const editable = signalsFindComposeEditable(root);
    const payload = ${JSON.stringify(text)};
    editable.focus();
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {}
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch {}
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, payload);
    } catch {}
    try {
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: payload,
        })
      );
      editable.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {}
    const snapshot = signalsReadComposeSnapshot(editable);
    snapshot.ok = inserted || Boolean(snapshot.text);
    snapshot.reason = snapshot.ok ? "inserted" : "insert_failed";
    return JSON.stringify(snapshot);
  })()`;
}

function readComposeSnapshotEvalJs(wrapperSelector) {
  return `(() => {
    /* signals-compose-snapshot */
    ${findComposeEditableJs()}
    ${readComposeSnapshotFnJs()}
    ${resolveComposeRootJs(wrapperSelector)}
    if (!root) return JSON.stringify({ ok: false, reason: "no_root" });
    const editable = signalsFindComposeEditable(root);
    const snapshot = signalsReadComposeSnapshot(editable);
    snapshot.ok = true;
    return JSON.stringify(snapshot);
  })()`;
}

module.exports = {
  normalizeComposeText,
  paragraphBlocks,
  composeSnapshotFromText,
  matchComposeSnapshot,
  insertComposeTextEvalJs,
  readComposeSnapshotEvalJs,
};
