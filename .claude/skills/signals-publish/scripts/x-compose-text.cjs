"use strict";

/**
 * Shared X Draft.js / Lexical compose helpers.
 *
 * Multi-paragraph replies must be injected with one CDP Input.insertText
 * (`agent-browser keyboard inserttext`) of the entire string. Splitting on
 * newline / insertParagraph, or using document.execCommand("insertText"),
 * creates separate ContentBlocks; X then serializes only the focused active
 * block on submit even when innerText still shows every line.
 *
 * Never use document.execCommand("selectAll"|"delete"|"insertText") on the
 * composer: Chrome can delete Draft's DOM, and execCommand insertText is not
 * a single ContentBlock pass.
 */

function normalizeComposeText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphBlocks(text) {
  return String(text ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean);
}

function canonicalComposeText(text) {
  return paragraphBlocks(text).join("\n");
}

function publishedReplyMatches(actual, expected) {
  const want = canonicalComposeText(expected);
  const got = canonicalComposeText(actual);
  return Boolean(want) && got === want;
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
      leafBlocks: [last],
      leafText: last,
      editorPlainText: last,
      focusedBlockText: last,
      selectionText: last,
      text: normalizeComposeText(full),
    };
  }
  return {
    ok: true,
    innerText: full,
    blocks: blocks.length ? blocks : full ? [full] : [],
    leafBlocks: blocks.length ? blocks : full ? [full] : [],
    leafText: full,
    editorPlainText: full,
    focusedBlockText: last || full,
    selectionText: full,
    text: normalizeComposeText(full),
  };
}

function leafParagraphsFromSnapshot(snapshot) {
  if (Array.isArray(snapshot.leafBlocks) && snapshot.leafBlocks.length) {
    return snapshot.leafBlocks.flatMap((block) => paragraphBlocks(block));
  }
  if (snapshot.leafText != null && String(snapshot.leafText).length) {
    return paragraphBlocks(snapshot.leafText);
  }
  return [];
}

function matchComposeSnapshot(snapshot, expected) {
  const wantParagraphs = paragraphBlocks(expected);
  const want = wantParagraphs.join("\n");
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

  const innerParagraphs = paragraphBlocks(snapshot.innerText ?? snapshot.text ?? "");
  const selectedParagraphs = paragraphBlocks(snapshot.selectionText ?? "");
  const blockParagraphs = Array.isArray(snapshot.blocks)
    ? snapshot.blocks.flatMap((block) => paragraphBlocks(block))
    : [];
  const leafParagraphs = leafParagraphsFromSnapshot(snapshot);

  const inner = innerParagraphs.join("\n");
  const selected = selectedParagraphs.join("\n");
  const fromBlocks = blockParagraphs.join("\n");
  const fromLeaves = leafParagraphs.join("\n");

  if (!selectedParagraphs.length) {
    return {
      ok: false,
      reason: "missing_selection",
      expected: want,
      actual: selected,
    };
  }
  if (!blockParagraphs.length) {
    return {
      ok: false,
      reason: "missing_blocks",
      expected: want,
      actual: fromBlocks,
    };
  }
  if (!leafParagraphs.length) {
    return {
      ok: false,
      reason: "missing_draft_leaves",
      expected: want,
      actual: fromLeaves,
    };
  }
  if (inner !== want) {
    return {
      ok: false,
      reason: "innerText_mismatch",
      expected: want,
      actual: inner,
    };
  }
  if (selected !== want) {
    return {
      ok: false,
      reason: "editor_selection_mismatch",
      expected: want,
      actual: selected,
    };
  }
  if (fromBlocks !== want || blockParagraphs.length !== wantParagraphs.length) {
    return {
      ok: false,
      reason: "editor_blocks_mismatch",
      expected: want,
      actual: fromBlocks,
    };
  }
  if (fromLeaves !== want || leafParagraphs.length !== wantParagraphs.length) {
    return {
      ok: false,
      reason: "draft_leaf_mismatch",
      expected: want,
      actual: fromLeaves,
    };
  }
  if (typeof snapshot.editorPlainText === "string") {
    const fromEditor = canonicalComposeText(snapshot.editorPlainText);
    if (fromEditor !== want) {
      return {
        ok: false,
        reason: "editor_state_mismatch",
        expected: want,
        actual: fromEditor,
      };
    }
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
  return `function signalsReadDraftPlainText(editable) {
    function fiberFrom(node) {
      if (!node) return null;
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (
          key.indexOf("__reactFiber") === 0 ||
          key.indexOf("__reactInternalInstance") === 0
        ) {
          return node[key];
        }
      }
      return null;
    }
    function plainFromEditorState(es) {
      if (!es || typeof es.getCurrentContent !== "function") return null;
      try {
        return String(es.getCurrentContent().getPlainText() || "");
      } catch {
        return null;
      }
    }
    function editorStateFromFiber(fiber) {
      let f = fiber;
      for (let i = 0; i < 40 && f; i++) {
        const props = f.memoizedProps || f.pendingProps || {};
        const state = f.memoizedState;
        const candidates = [props.editorState, state && state.editorState];
        for (let c = 0; c < candidates.length; c++) {
          const plain = plainFromEditorState(candidates[c]);
          if (plain != null) return plain;
        }
        f = f.return;
      }
      return null;
    }
    let node = editable;
    for (let depth = 0; depth < 10 && node; depth++) {
      const fiber = fiberFrom(node);
      if (fiber) {
        const plain = editorStateFromFiber(fiber);
        if (plain != null) return plain;
      }
      node = node.parentElement;
    }
    return null;
  }
  function signalsReadComposeSnapshot(editable) {
    const innerText = String(editable.innerText || editable.textContent || "");
    const blockSelector =
      '[data-block="true"], .public-DraftStyleDefault-block, [data-contents="true"] > div, [contenteditable="true"] > p, [contenteditable="true"] > div[dir]';
    const blockNodes = Array.from(editable.querySelectorAll(blockSelector));
    const blocks = [];
    const leafBlocks = [];
    for (const node of blockNodes) {
      if (blockNodes.some((other) => other !== node && other.contains(node))) continue;
      blocks.push(String(node.innerText || node.textContent || ""));
      const leaves = Array.from(
        node.querySelectorAll(
          'span[data-text="true"], [data-lexical-text="true"]'
        )
      );
      leafBlocks.push(leaves.map((leaf) => String(leaf.textContent || "")).join(""));
    }
    if (!leafBlocks.some((block) => block.length) && !blockNodes.length) {
      const leaves = Array.from(
        editable.querySelectorAll(
          'span[data-text="true"], [data-lexical-text="true"]'
        )
      );
      if (leaves.length) {
        leafBlocks.push(leaves.map((leaf) => String(leaf.textContent || "")).join(""));
      }
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
      const range = document.createRange();
      range.selectNodeContents(editable);
      selectionText = String(range.toString() || selectionText);
    } catch {}
    let editorPlainText = null;
    try {
      editorPlainText = signalsReadDraftPlainText(editable);
    } catch {
      editorPlainText = null;
    }
    if (typeof editorPlainText === "string") {
      const editorNorm = editorPlainText.replace(/\\s+/g, " ").trim();
      const leafNorm = leafBlocks.join("\\n").replace(/\\s+/g, " ").trim();
      const innerNorm = innerText.replace(/\\s+/g, " ").trim();
      if (
        editorNorm &&
        ((leafNorm && editorNorm !== leafNorm) || (!leafNorm && innerNorm && editorNorm !== innerNorm))
      ) {
        editorPlainText = null;
      }
    }
    return {
      innerText,
      blocks,
      leafBlocks,
      leafText: leafBlocks.join("\\n"),
      editorPlainText,
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

function selectComposeContentsEvalJs(wrapperSelector) {
  return `(() => {
    /* signals-compose-select */
    ${findComposeEditableJs()}
    ${resolveComposeRootJs(wrapperSelector)}
    if (!root) return JSON.stringify({ ok: false, reason: "no_root" });
    const editable = signalsFindComposeEditable(root);
    editable.focus();
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {}
    return JSON.stringify({ ok: true, reason: "selected" });
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
  canonicalComposeText,
  publishedReplyMatches,
  paragraphBlocks,
  composeSnapshotFromText,
  matchComposeSnapshot,
  selectComposeContentsEvalJs,
  readComposeSnapshotEvalJs,
};
