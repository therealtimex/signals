"use strict";

function parseEvalJsonValue(raw) {
  if (!raw) return null;
  try {
    let value = JSON.parse(raw);
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        // keep string eval result
      }
    }
    return value;
  } catch {
    return null;
  }
}

function parseEvalJsonArray(raw) {
  const value = parseEvalJsonValue(raw);
  return Array.isArray(value) ? value : [];
}

module.exports = { parseEvalJsonArray, parseEvalJsonValue };
