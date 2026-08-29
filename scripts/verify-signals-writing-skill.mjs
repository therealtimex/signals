#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractLinks, extractTaggedBlocks, FORMULA_ID_RE, parseFrontmatter, RULE_ID_RE } from "./lib/signals-writing-skill-format.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, ".claude/skills/signals-writing");
const expected = [
  "SKILL.md", "reference.md",
  "core/claims.md", "core/voice.md", "core/audit.md", "core/adapt.md", "core/approval.md", "core/lineage.md",
  "overlays/README.md", "overlays/x.md", "overlays/linkedin.md", "overlays/facebook.md",
  "scripts/writing-cli.cjs",
];
const errors = [];
const fail = (message) => errors.push(message);
const read = (rel) => fs.readFileSync(path.join(skill, rel), "utf8");

function walk(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(prefix, entry.name);
    const absolute = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) { fail(`symlink forbidden: ${rel}`); return []; }
    return entry.isDirectory() ? walk(absolute, rel) : [rel];
  });
}

if (!fs.existsSync(skill)) fail("signals-writing skill directory missing");
const actual = fs.existsSync(skill) ? walk(skill).sort() : [];
for (const rel of expected) if (!actual.includes(rel)) fail(`missing skill file: ${rel}`);
for (const rel of actual) if (!expected.includes(rel)) fail(`unexpected skill file: ${rel}`);
for (const rel of actual) if (rel.endsWith(".mjs") || rel.includes("node_modules") || rel === "package.json") fail(`package-unsafe skill entry: ${rel}`);

const skillText = actual.includes("SKILL.md") ? read("SKILL.md") : "";
if (skillText) {
  try {
    const { data } = parseFrontmatter(skillText, "SKILL.md");
    const fields = { name: "signals-writing", author: "RealtimeX", license: "Apache-2.0", coreVersion: 1, "allowed-tools": "Read Bash" };
    for (const [key, value] of Object.entries(fields)) if (data[key] !== value) fail(`SKILL.md frontmatter ${key} must equal ${JSON.stringify(value)}`);
    if (String(data.description ?? "").length < 80) fail("SKILL.md description must be at least 80 characters");
    if (!/^\d+\.\d+\.\d+$/.test(data.version ?? "")) fail("SKILL.md version must be semver");
  } catch (error) { fail(error.message); }
  if (skillText.split(/\r?\n/).length > 250) fail("SKILL.md exceeds 250 lines");
  const prohibited = ["save_draft", "report_progress", "search_web", "lib.*"];
  const never = skillText.match(/## Never do[\s\S]*?(?=\n## |$)/)?.[0] ?? "";
  for (const token of prohibited) {
    if (!never.includes(token)) fail(`SKILL.md must explicitly prohibit ${token}`);
    const outside = skillText.replace(never, "");
    if (outside.includes(token)) fail(`retired token appears outside Never do: ${token}`);
  }
}

for (const rel of actual.filter((item) => item.endsWith(".md"))) {
  const text = read(rel);
  for (const link of extractLinks(text)) {
    if (/^(?:https?:|#|mailto:)/.test(link)) continue;
    const resolved = path.resolve(path.dirname(path.join(skill, rel)), decodeURIComponent(link.split("#")[0]));
    if (!fs.existsSync(resolved)) fail(`${rel}: broken relative link ${link}`);
  }
  const withoutRecords = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/```json signals-writing:(?:rules|formulas)\r?\n[\s\S]*?\r?\n```/g, "");
  if (withoutRecords.includes("docs-dev/refs")) fail(`${rel}: docs-dev/refs may appear only in provenance records/frontmatter`);
}
for (const rel of expected.filter((item) => item.startsWith("core/") && item.endsWith(".md"))) {
  const lines = read(rel).split(/\r?\n/).length;
  if (lines < 80 || lines > 200) fail(`${rel}: expected 80-200 lines, received ${lines}`);
}
for (const rel of ["overlays/x.md", "overlays/linkedin.md", "overlays/facebook.md"]) {
  const lines = read(rel).split(/\r?\n/).length;
  if (lines < 150 || lines > 350) fail(`${rel}: expected 150-350 lines, received ${lines}`);
}

const catalog = {
  "x.md": ["x/post/one-liner-contrarian@1", "x/post/data-point@1", "x/post/build-in-public-confession@1", "x/post/mini-list@1", "x/post/relatable-cold-open@1", "x/post/third-party-case-study@1", "x/thread/listicle-promise@1", "x/thread/story-arc@1", "x/thread/curiosity-gap-opener@1", "x/thread/how-i-teardown@1"],
  "linkedin.md": ["linkedin/post/anaphora@1", "linkedin/post/rip-obituary@1", "linkedin/post/year-over-year-pivot@1", "linkedin/post/time-anchor-confession@1", "linkedin/post/self-proving-meta@1", "linkedin/post/precise-ledger@1", "linkedin/post/paid-vs-free-reversal@1", "linkedin/post/curiosity-gap@1", "linkedin/post/contrarian-with-receipts@1", "linkedin/post/emotional-cold-open@1", "linkedin/post/permission-slip@1", "linkedin/post/expectation-reversal@1", "linkedin/post/named-tribute@1", "linkedin/post/explain-simply@1", "linkedin/post/status-strip@1", "linkedin/post/controlled-comparison@1", "linkedin/post/false-binary-dissolve@1", "linkedin/post/anecdote-evidence-bridge@1", "linkedin/post/diverging-curves-close@1"],
  "facebook.md": ["facebook/post/one-line-opinion@1", "facebook/post/tiny-number@1", "facebook/post/genuine-question@1", "facebook/post/relatable-one-liner@1", "facebook/post/behind-the-scenes@1", "facebook/post/useful-tip@1", "facebook/post/story-with-a-turn@1", "facebook/post/announcement-with-stakes@1", "facebook/post/community-spotlight@1"],
};
const overlayRuleCatalog = {
  "x.md": ["x/post/hard/char-limit", "x/thread/hard/char-limit", "x/post/hard/single-unit", "x/thread/hard/min-units", "x/post/hard/media-count", "x/post/heuristic/hook-first-line", "x/post/heuristic/hashtags-0-1", "x/post/heuristic/no-link-in-body", "x/post/heuristic/emoji-0-1", "x/thread/heuristic/thread-promise-open-loop", "x/thread/heuristic/thread-5-9-units", "x/thread/heuristic/thread-no-link-unit-1", "x/thread/heuristic/thread-no-numbering-required"],
  "linkedin.md": ["linkedin/post/hard/char-limit", "linkedin/post/hard/single-unit", "linkedin/post/heuristic/hook-before-fold", "linkedin/post/heuristic/no-external-link-in-body", "linkedin/post/heuristic/hashtags-0-2", "linkedin/post/heuristic/line-breaks-for-scan", "linkedin/post/heuristic/no-comment-gate", "linkedin/post/heuristic/passive-voice-ceiling"],
  "facebook.md": ["facebook/post/hard/char-limit", "facebook/post/hard/single-unit", "facebook/post/heuristic/short-post-sweet-spot", "facebook/post/heuristic/link-in-first-comment", "facebook/post/heuristic/hashtags-0-2", "facebook/post/heuristic/emoji-0-2", "facebook/post/heuristic/page-vs-profile-cta", "facebook/post/heuristic/genuine-question-only"],
};
const seenRules = new Set();
const ruleById = new Map();
for (const rel of ["core/claims.md", "core/voice.md", "core/audit.md", "overlays/x.md", "overlays/linkedin.md", "overlays/facebook.md"]) {
  if (!actual.includes(rel)) continue;
  const text = read(rel);
  const records = extractTaggedBlocks(text, "signals-writing:rules", rel).flat();
  if (!records.length) fail(`${rel}: no tagged rule records`);
  for (const rule of records) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) { fail(`${rel}: invalid rule record`); continue; }
    if (!RULE_ID_RE.test(rule.id ?? "")) fail(`${rel}: invalid rule id ${rule.id}`);
    if (seenRules.has(rule.id)) fail(`${rel}: duplicate rule id ${rule.id}`);
    seenRules.add(rule.id);
    ruleById.set(rule.id, rule);
    if (!["hard", "claim", "voice", "heuristic", "aesthetic"].includes(rule.class)) fail(`${rule.id}: invalid class`);
    if (!rule.statement || !Array.isArray(rule.applies) || !rule.applies.length || !rule.severity || !Array.isArray(rule.source) || !rule.source.length || !rule.status) fail(`${rule.id}: incomplete rule record`);
    const expectedPrefix = rel.startsWith("core/") ? "core/" : `${rel.split("/").at(-1).replace(".md", "")}/`;
    if (!rule.id.startsWith(expectedPrefix)) fail(`${rule.id}: wrong namespace for ${rel}`);
    if (rel.startsWith("core/") ? !rule.applies.every((surface) => surface === "core") : !rule.applies.every((surface) => surface.startsWith(`${expectedPrefix.split("/")[0]}/`))) fail(`${rule.id}: applies outside its namespace`);
    if (rule.id.split("/").at(-2) !== rule.class) fail(`${rule.id}: class segment does not match class`);
    const allowedSeverity = { hard: ["blocker"], claim: ["blocker"], voice: ["warning"], heuristic: ["warning", "info"], aesthetic: ["info"] }[rule.class] ?? [];
    if (!allowedSeverity.includes(rule.severity)) fail(`${rule.id}: invalid severity for class`);
    for (const token of ["save_draft", "report_progress", "search_web", "lib.", "Publora", "Apify", "Pixfaro", "OriginalityAI", "GPTZero", "engagement pod"]) if (String(rule.statement).includes(token)) fail(`${rule.id}: forbidden token in rule statement`);
    if (!["active", "deprecated"].includes(rule.status)) fail(`${rule.id}: invalid status`);
    if (rule.class === "hard") {
      if (!rule.enforcedBy) fail(`${rule.id}: hard rule lacks enforcedBy`);
      if (!rule.source.some((source) => ["platform_doc", "adapter", "server"].includes(source.kind))) fail(`${rule.id}: hard rule lacks platform/adapter/server source`);
      if (rule.reviewBy) fail(`${rule.id}: hard rule must not carry reviewBy`);
    }
    if (rule.class === "heuristic") {
      if (!rule.confidence || !rule.reviewBy) fail(`${rule.id}: heuristic requires confidence and reviewBy`);
      if (!rule.source.every((source) => source.path && source.kind && source.observedAt)) fail(`${rule.id}: heuristic source requires path, kind, and observedAt`);
      if (rule.reviewBy < "2026-08-29") fail(`${rule.id}: reviewBy predates review date`);
    }
  }
}
const coreCatalog = ["core/claim/no-invented-fact", "core/claim/no-invented-number", "core/claim/no-invented-date", "core/claim/no-invented-name", "core/claim/no-invented-quote", "core/claim/no-invented-citation", "core/claim/verbatim-claim-kept", "core/claim/claim-source-resolves", "core/claim/private-claim-excluded", "core/claim/no-third-party-dunk", "core/claim/no-unverifiable-promise", "core/claim/named-party-consent", "core/claim/no-manipulation", "core/voice/drift", "core/voice/protected-quirk-kept", "core/voice/avoid-list", "core/voice/taboo", "core/voice/signature-verbatim", "core/heuristic/ai-tell-phrases", "core/heuristic/tricolon-cadence", "core/heuristic/uniform-sentence-length", "core/heuristic/rhetorical-question-open", "core/heuristic/summary-close", "core/heuristic/hedge-stack", "core/heuristic/emoji-bullets", "core/heuristic/title-case-headers", "core/aesthetic/em-dash-sparingly", "core/aesthetic/emoji-count", "core/aesthetic/list-vs-prose", "core/aesthetic/sign-off-style"];
for (const id of coreCatalog) if (!seenRules.has(id)) fail(`missing required core rule ${id}`);

for (const [file, ids] of Object.entries(catalog)) {
  const rel = `overlays/${file}`;
  if (!actual.includes(rel)) continue;
  const text = read(rel);
  try {
    const { data } = parseFrontmatter(text, rel);
    const platform = file.replace(".md", "");
    const allowedSurfaces = { x: ["x/post", "x/thread"], linkedin: ["linkedin/post"], facebook: ["facebook/post"] }[platform];
    if (data.overlayId !== `overlay:${platform}` || data.version !== 1 || data.platform !== platform || !Array.isArray(data.surfaces) || !data.surfaces.every((surface) => allowedSurfaces.includes(surface)) || !/^\d{4}-\d{2}-\d{2}$/.test(data.reviewedAt ?? "") || !Array.isArray(data.sources) || !data.sources.length) fail(`${rel}: invalid overlay frontmatter`);
  } catch (error) { fail(error.message); }
  const sectionOrder = ["## Hard constraints", "## Formulas", "## Heuristics & aesthetics"].map((heading) => text.indexOf(heading));
  if (sectionOrder.some((index) => index < 0) || sectionOrder.some((index, position) => position > 0 && index <= sectionOrder[position - 1])) fail(`${rel}: required sections are missing or out of order`);
  const formulas = extractTaggedBlocks(text, "signals-writing:formulas", rel).flat();
  const rules = extractTaggedBlocks(text, "signals-writing:rules", rel).flat();
  if (rules.map((rule) => rule.id).sort().join("\n") !== [...overlayRuleCatalog[file]].sort().join("\n")) fail(`${rel}: rule catalog mismatch`);
  const found = formulas.map((formula) => formula.id).sort();
  if (found.join("\n") !== [...ids].sort().join("\n")) fail(`${rel}: formula catalog mismatch`);
  for (const formula of formulas) {
    if (!FORMULA_ID_RE.test(formula.id ?? "")) fail(`${rel}: invalid formula id ${formula.id}`);
    if (!Array.isArray(formula.surfaces) || !formula.surfaces.length || !Array.isArray(formula.goals) || !formula.goals.length || !formula.shape || !Array.isArray(formula.slots) || !formula.slots.every((slot) => slot && typeof slot.name === "string" && typeof slot.from === "string" && typeof slot.required === "boolean") || !Array.isArray(formula.claimRules) || typeof formula.consent !== "boolean" || !Array.isArray(formula.source) || !formula.source.length || !formula.confidence || !formula.reviewBy || !formula.status) fail(`${formula.id}: incomplete formula record`);
    if (Number(formula.id.split("@")[1]) !== 1 || !formula.surfaces.every((surface) => text.includes(`surfaces: [${surface}`) || (parseFrontmatter(text, rel).data.surfaces).includes(surface))) fail(`${formula.id}: surface/version does not match overlay`);
    for (const claimRule of formula.claimRules) if (!seenRules.has(claimRule)) fail(`${formula.id}: unknown claim rule ${claimRule}`);
    if (!formula.source.every((source) => source.path && source.kind && source.observedAt)) fail(`${formula.id}: source requires path, kind, and observedAt`);
    if (formula.reviewBy < "2026-08-29") fail(`${formula.id}: reviewBy predates overlay review`);
    for (const token of ["Publora", "Apify", "Pixfaro", "OriginalityAI", "GPTZero", "engagement pod"]) if (String(formula.shape).includes(token)) fail(`${formula.id}: forbidden token in shape`);
    if (!["active", "deprecated"].includes(formula.status)) fail(`${formula.id}: invalid status`);
    if (formula.id.endsWith("third-party-case-study@1") || formula.id.endsWith("named-tribute@1") || formula.id.endsWith("community-spotlight@1")) if (!formula.consent) fail(`${formula.id}: consent must be true`);
  }
}
for (const excluded of ["comment-gate", "this-or-that", "vote", "quote-dunk", "dunk", "engagement-pod", "detector"]) if (Object.values(catalog).flat().some((id) => id.includes(excluded))) fail(`excluded formula slug present: ${excluded}`);
for (const [id, value] of Object.entries({ "x/post/hard/char-limit": 280, "x/thread/hard/char-limit": 280, "linkedin/post/hard/char-limit": 3000, "facebook/post/hard/char-limit": 63206 })) {
  const rule = ruleById.get(id);
  if (rule?.value !== value || rule?.enforcedBy !== "server:hardLimit") fail(`${id}: hard-limit value/enforcement mismatch`);
}
if (ruleById.get("x/thread/hard/min-units")?.value !== 2) fail("x/thread/hard/min-units: value must be 2");

if (actual.includes("reference.md")) {
  const tags = [...read("reference.md").matchAll(/```json (signals-writing:example:[^\s]+)/g)].map((match) => match[1]);
  const requiredTags = ["launch-writing-patch", "spine", "variant-input", "generation", "audit-input", "voice-profile-input", "materialize-input", "approve-voice-input", "send-to-agent-body"].map((name) => `signals-writing:example:${name}`);
  for (const tag of requiredTags) {
    const blocks = extractTaggedBlocks(read("reference.md"), tag, "reference.md");
    if (blocks.length !== 1) fail(`reference.md: expected one ${tag} block`);
  }
  if (tags.length !== requiredTags.length || tags.some((tag) => !requiredTags.includes(tag))) fail("reference.md: unexpected or duplicate example tag");
}

if (actual.includes("scripts/writing-cli.cjs")) {
  const cli = path.join(skill, "scripts/writing-cli.cjs");
  try {
    const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    for (const command of ["id", "measure", "verdict", "precheck"]) if (!help.includes(command)) fail(`writing helper help missing ${command}`);
    const generated = JSON.parse(execFileSync(process.execPath, [cli, "id", "spn"], { encoding: "utf8" }));
    if (!/^spn_[A-Za-z0-9_-]{16}$/.test(generated)) fail("writing helper generated invalid ID");
    const measured = JSON.parse(execFileSync(process.execPath, [cli, "measure", "--surface", "x/post", "--text", `#Signal https://example.com ${"x".repeat(281)}`], { encoding: "utf8" }));
    if (measured.hard.hashtags !== 1 || measured.hard.links !== 1 || measured.violations.filter((violation) => violation.reason === "unit_over_limit").length !== 1) fail("writing helper measurement smoke mismatch");
  } catch (error) { fail(`writing helper smoke failed: ${error.message}`); }
}

if (errors.length) {
  console.error("signals-writing skill validation failed:");
  errors.forEach((error, index) => console.error(`  ${index + 1}. ${error}`));
  process.exit(1);
}
console.log(`signals-writing skill validation: OK (${actual.length} files, ${seenRules.size} rules)`);
