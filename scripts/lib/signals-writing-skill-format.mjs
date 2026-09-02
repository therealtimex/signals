// Surfaces registered in src/lib/writing/surfaces.ts that carry an overlay. Nurture surfaces
// (reply/comment/direct_message) joined in #410 with draft/audit contracts and no send adapter.
const OVERLAY_SURFACE = "(?:x\\/(?:post|thread|reply|direct_message)|linkedin\\/(?:post|comment|direct_message)|facebook\\/(?:post|comment|direct_message))";
export const RULE_ID_RE = new RegExp(`^(?:core|${OVERLAY_SURFACE})\\/(?:hard|claim|voice|heuristic|aesthetic)\\/[a-z0-9]+(?:-[a-z0-9]+)*$`);
export const FORMULA_ID_RE = new RegExp(`^${OVERLAY_SURFACE}\\/[a-z0-9]+(?:-[a-z0-9]+)*@[1-9]\\d*$`);

function scalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const body = trimmed.slice(1, -1).trim();
    return body ? body.split(",").map((part) => scalar(part)) : [];
  }
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (trimmed === "null") return null;
  return trimmed.replace(/^(["'])(.*)\1$/, "$2");
}

export function parseFrontmatter(text, source = "document") {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${source}: missing frontmatter`);
  const data = {};
  const lines = match[1].split(/\r?\n/);
  for (let offset = 0; offset < lines.length; offset += 1) {
    const line = lines[offset];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) throw new Error(`${source}:${offset + 2}: frontmatter must be flat YAML`);
    if ([">", ">-", "|", "|-"].includes(field[2])) {
      const folded = [];
      while (offset + 1 < lines.length && /^\s+/.test(lines[offset + 1])) folded.push(lines[++offset].trim());
      data[field[1]] = field[2].startsWith(">") ? folded.join(" ") : folded.join("\n");
    } else {
      data[field[1]] = scalar(field[2]);
    }
  }
  return { data, body: text.slice(match[0].length) };
}

export function extractTaggedBlocks(text, tag, source = "document") {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("```json\\s+" + escaped + "\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```", "g");
  const values = [];
  for (const match of text.matchAll(pattern)) {
    try {
      values.push(JSON.parse(match[1]));
    } catch (error) {
      throw new Error(`${source}: invalid ${tag} JSON: ${error.message}`);
    }
  }
  return values;
}

export function extractLinks(text) {
  return [...text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)].map((match) => match[1]);
}
