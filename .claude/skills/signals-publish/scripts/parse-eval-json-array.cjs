"use strict";

function parseEvalJsonArray(raw) {
  if (!raw) return [];
  try {
    let value = JSON.parse(raw);
    if (typeof value === "string") {
      value = JSON.parse(value);
    }
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

module.exports = { parseEvalJsonArray };
