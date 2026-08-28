#!/usr/bin/env node
/**
 * Validate (or refresh) the writing reference-corpus manifest.
 *
 * `docs-dev/refs/manifest.json` is the curated inventory behind
 * `specs/signals-writing-system.md` §9. Every skill directory under `docs-dev/refs` must have an
 * entry whose mechanical facts (files on disk, dangling references, vendor assumptions, dated
 * claims) match what this script recomputes, and whose curated facts (surfaces, capability,
 * rule classes, disposition, heuristic confidence, replacements) are present and well-formed.
 *
 * Usage:
 *   node scripts/verify-writing-corpus-manifest.mjs            # validate, exit 1 on drift
 *   node scripts/verify-writing-corpus-manifest.mjs --update   # refresh mechanical fields, then validate
 *   node scripts/verify-writing-corpus-manifest.mjs --root <dir> --manifest <file>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const CAPABILITIES = [
  "research",
  "plan",
  "draft",
  "adapt",
  "humanize-audit",
  "engage",
  "profile",
  "analytics",
  "asset-brief",
  "governance",
];
export const DISPOSITIONS = ["adopt-core", "adopt-overlay", "defer-353", "reference-only", "exclude"];
export const CONFIDENCE = ["none", "low", "medium", "high"];
export const MISSING_REF_DISPOSITIONS = ["restore", "replace", "remove"];
export const LICENSE_STATUSES = ["unknown", "declared", "conflict"];
export const RULE_CLASSES = ["hard", "claim", "voice", "heuristic", "aesthetic"];
export const VENDORS = {
  publora: /publora/i,
  apify: /apify/i,
  pixfaro: /pixfaro/i,
  "lib-wrapper": /\blib\.[A-Za-z_][A-Za-z0-9_.]*/,
  "youtube-data-api": /YOUTUBE_API_KEY|YouTube Data API/i,
  "ai-detectors": /GPTZero|Originality\.ai|ZeroGPT|Sapling|Copyleaks/i,
};

const SURFACE_RE = /^[a-z]+\/[a-z_]+$/;
const FORMULA_RE = /^(?:[a-z]+\/[a-z_]+|core)\/[a-z0-9-]+@\d+$/;
const DATED_RE = /\b20(?:24|25|26)\b/;
const REF_RE =
  /(?:\]\(|`)((?:\.\.\/)*(?:\.\/)?(?:references|sub-skills|scripts|lib|assets)\/[A-Za-z0-9_./-]+?)(?:\)|`)/g;
const SIBLING_REF_RE = /`(\.\.\/[a-z0-9-]+\/(?:references|sub-skills|scripts)\/[A-Za-z0-9_./-]+?)`/g;
const ROOT_SKILL_RE = /root `SKILL\.md`/;

function parseArgs(argv) {
  const args = { update: false, root: "docs-dev/refs", manifest: "docs-dev/refs/manifest.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--update") args.update = true;
    else if (arg === "--root") args.root = argv[++i];
    else if (arg === "--manifest") args.manifest = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv && kv[2] !== "" && kv[2] !== "|") out[kv[1]] = kv[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

export function readPlatformRegistry(repoRoot = REPO_ROOT) {
  const source = fs.readFileSync(path.join(repoRoot, "src/lib/db/platforms.ts"), "utf8");
  const block = source.match(/export const PLATFORMS = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error("Could not parse PLATFORMS from src/lib/db/platforms.ts");
  return [...block[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
}

/** Recompute the mechanical facts for every skill directory under `root`. */
export function scanCorpus(rootAbs) {
  const skills = [];
  const skillDirs = walk(rootAbs)
    .filter((file) => path.basename(file) === "SKILL.md")
    .map((file) => path.dirname(file));

  for (const dirAbs of skillDirs) {
    const rel = path.relative(rootAbs, dirAbs).split(path.sep).join("/");
    const family = rel.split("/")[0];
    const files = walk(dirAbs).map((file) => path.relative(dirAbs, file).split(path.sep).join("/"));
    const frontmatter = parseFrontmatter(fs.readFileSync(path.join(dirAbs, "SKILL.md"), "utf8"));
    const vendors = new Map();
    const missing = new Map();
    let datedClaims = false;

    for (const relFile of files) {
      const fileAbs = path.join(dirAbs, relFile);
      const text = fs.readFileSync(fileAbs, "utf8");
      if (DATED_RE.test(text)) datedClaims = true;
      for (const [vendor, re] of Object.entries(VENDORS)) {
        if (!re.test(text)) continue;
        const symbols = vendors.get(vendor) ?? new Set();
        if (vendor === "lib-wrapper") {
          for (const m of text.matchAll(/\blib\.[A-Za-z_][A-Za-z0-9_]*/g)) symbols.add(m[0]);
        }
        vendors.set(vendor, symbols);
      }
      if (!relFile.endsWith(".md")) continue;
      const refs = new Set();
      for (const m of text.matchAll(REF_RE)) refs.add(m[1]);
      for (const m of text.matchAll(SIBLING_REF_RE)) refs.add(m[1]);
      for (const ref of refs) {
        // A reference may be written relative to the file, the skill root, or the family root
        // (the corpus was refactored between layouts). Present under any of them = not missing.
        const candidates = [path.dirname(fileAbs), dirAbs, path.join(rootAbs, family)].map((base) =>
          path.resolve(base, ref)
        );
        if (candidates.some((candidate) => fs.existsSync(candidate))) continue;
        // Canonical form keeps the author's intent: climbing refs (`../../references/x.md`)
        // target the family bundle root; non-climbing refs target the skill directory.
        const stripped = ref.replace(/^(?:\.\.\/)+/, "").replace(/^\.\//, "");
        const canonical = ref.startsWith("../") ? `${family}/${stripped}` : `${rel}/${stripped}`;
        const entry = missing.get(canonical) ?? { ref: canonical, referencedFrom: [] };
        entry.referencedFrom.push(relFile);
        missing.set(canonical, entry);
      }
      if (ROOT_SKILL_RE.test(text)) {
        const canonical = `${family}/SKILL.md`;
        if (!fs.existsSync(path.join(rootAbs, canonical))) {
          const entry = missing.get(canonical) ?? { ref: canonical, referencedFrom: [] };
          entry.referencedFrom.push(relFile);
          missing.set(canonical, entry);
        }
      }
    }

    skills.push({
      id: path.basename(dirAbs),
      family,
      path: rel,
      files,
      frontmatter: { name: frontmatter.name ?? null, license: frontmatter.license ?? null },
      datedClaims,
      vendorAssumptions: [...vendors.entries()]
        .map(([vendor, symbols]) => ({ vendor, symbols: [...symbols].sort() }))
        .sort((a, b) => a.vendor.localeCompare(b.vendor)),
      missingReferences: [...missing.values()]
        .map((entry) => ({ ...entry, referencedFrom: [...new Set(entry.referencedFrom)].sort() }))
        .sort((a, b) => a.ref.localeCompare(b.ref)),
    });
  }
  return skills.sort((a, b) => a.path.localeCompare(b.path));
}

function sameList(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

export function validateManifest(manifest, scanned, platforms) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  if (manifest.schemaVersion !== 1) err("schemaVersion must be 1");
  if (!Array.isArray(manifest.families) || !Array.isArray(manifest.skills)) {
    err("manifest needs families[] and skills[]");
    return errors;
  }

  const families = new Map();
  for (const family of manifest.families) {
    if (!family.id) err("family without id");
    if (families.has(family.id)) err(`duplicate family ${family.id}`);
    families.set(family.id, family);
    if (family.platform !== null && !platforms.includes(family.platform)) {
      err(`family ${family.id}: platform ${family.platform} is not in PLATFORMS`);
    }
    if (!LICENSE_STATUSES.includes(family.license?.status)) {
      err(`family ${family.id}: license.status must be one of ${LICENSE_STATUSES.join("|")}`);
    }
    const declaredLicense =
      typeof family.license?.declared === "string" && family.license.declared.trim().length > 0;
    if (["declared", "conflict"].includes(family.license?.status) && !declaredLicense) {
      err(`family ${family.id}: license.status=${family.license?.status} needs license.declared`);
    }
    if (family.license?.status === "unknown" && family.license?.declared !== null) {
      err(`family ${family.id}: license.status=unknown requires license.declared=null`);
    }
    if (
      family.redistribution !== "not-cleared" &&
      !(family.license?.status === "declared" && declaredLicense)
    ) {
      err(`family ${family.id}: redistribution must be "not-cleared" unless a clean license is declared`);
    }
    if (family.adoptionPolicy !== "re-author-only") {
      err(`family ${family.id}: adoptionPolicy must be "re-author-only" (no verbatim vendoring)`);
    }
    if (typeof family.provenance !== "string" || !family.provenance) err(`family ${family.id}: provenance required`);
  }

  const byPath = new Map(scanned.map((skill) => [skill.path, skill]));
  const seen = new Set();
  for (const entry of manifest.skills) {
    const label = `skill ${entry.id ?? entry.path ?? "?"}`;
    if (seen.has(entry.path)) {
      err(`${label}: duplicate manifest entry for path ${entry.path}`);
      continue;
    }
    seen.add(entry.path);
    const disk = byPath.get(entry.path);
    if (!disk) {
      err(`${label}: path ${entry.path} has no SKILL.md on disk`);
      continue;
    }
    if (entry.id !== disk.id) err(`${label}: id must equal directory name ${disk.id}`);
    if (entry.family !== disk.family) err(`${label}: family must be ${disk.family}`);
    if (!families.has(entry.family)) err(`${label}: family ${entry.family} is not declared`);
    const family = families.get(entry.family);
    if (family && entry.platform !== family.platform) err(`${label}: platform must match family platform`);
    if (entry.platform !== null && !platforms.includes(entry.platform)) err(`${label}: unknown platform ${entry.platform}`);

    if (!Array.isArray(entry.surfaces)) err(`${label}: surfaces[] required`);
    else {
      for (const surface of entry.surfaces) {
        if (!SURFACE_RE.test(surface)) err(`${label}: surface ${surface} must match <platform>/<surface>`);
        else if (entry.platform && !surface.startsWith(`${entry.platform}/`) && !surface.startsWith("core/")) {
          err(`${label}: surface ${surface} must be namespaced under ${entry.platform}/ or core/`);
        }
      }
    }
    if (!CAPABILITIES.includes(entry.capability)) err(`${label}: capability must be one of ${CAPABILITIES.join("|")}`);
    if (!DISPOSITIONS.includes(entry.disposition)) err(`${label}: disposition must be one of ${DISPOSITIONS.join("|")}`);
    if (!CONFIDENCE.includes(entry.heuristicConfidence)) err(`${label}: heuristicConfidence must be one of ${CONFIDENCE.join("|")}`);
    if (typeof entry.ruleClasses !== "object" || entry.ruleClasses === null) err(`${label}: ruleClasses{} required`);
    else {
      for (const cls of RULE_CLASSES) {
        if (typeof entry.ruleClasses[cls] !== "boolean") err(`${label}: ruleClasses.${cls} must be boolean`);
      }
    }
    if (entry.ruleClasses?.heuristic === true && entry.heuristicConfidence === "none") {
      err(`${label}: heuristic rules present but heuristicConfidence is "none"`);
    }
    if (typeof entry.notes !== "string" || !entry.notes) err(`${label}: notes required`);
    if (!Array.isArray(entry.exclusions)) err(`${label}: exclusions[] required (may be empty)`);

    if (entry.datedClaims !== disk.datedClaims) {
      err(`${label}: datedClaims must be ${disk.datedClaims} (run --update)`);
    }
    if (!sameList(entry.files ?? [], disk.files)) err(`${label}: files[] drifted from disk (run --update)`);

    const diskRefs = new Map(disk.missingReferences.map((missing) => [missing.ref, missing]));
    const manifestRefs = (entry.missingReferences ?? []).map((missing) => missing.ref);
    if (new Set(manifestRefs).size !== manifestRefs.length) {
      err(`${label}: duplicate missingReferences ref`);
    }
    if (!sameList(manifestRefs, [...diskRefs.keys()])) {
      err(`${label}: missingReferences drifted from disk (run --update)`);
    }
    for (const missing of entry.missingReferences ?? []) {
      const diskMissing = diskRefs.get(missing.ref);
      if (diskMissing && !sameList(missing.referencedFrom ?? [], diskMissing.referencedFrom)) {
        err(`${label}: missing ref ${missing.ref} referencedFrom drifted from disk (run --update)`);
      }
      if (!MISSING_REF_DISPOSITIONS.includes(missing.disposition)) {
        err(`${label}: missing ref ${missing.ref} needs disposition ${MISSING_REF_DISPOSITIONS.join("|")}`);
      }
      if (missing.disposition === "replace" && !missing.replacement) {
        err(`${label}: missing ref ${missing.ref} disposition=replace needs a replacement`);
      }
    }

    const diskVendors = new Map(disk.vendorAssumptions.map((vendor) => [vendor.vendor, vendor]));
    const manifestVendors = (entry.vendorAssumptions ?? []).map((vendor) => vendor.vendor);
    if (new Set(manifestVendors).size !== manifestVendors.length) {
      err(`${label}: duplicate vendorAssumptions vendor`);
    }
    if (!sameList(manifestVendors, [...diskVendors.keys()])) {
      err(`${label}: vendorAssumptions drifted from disk (run --update)`);
    }
    for (const vendor of entry.vendorAssumptions ?? []) {
      const diskVendor = diskVendors.get(vendor.vendor);
      if (diskVendor && !sameList(vendor.symbols ?? [], diskVendor.symbols)) {
        err(`${label}: vendor ${vendor.vendor} symbols drifted from disk (run --update)`);
      }
      if (typeof vendor.replacement !== "string" || !vendor.replacement) {
        err(`${label}: vendor ${vendor.vendor} needs a Signals/RealTimeX replacement`);
      }
    }

    for (const formula of entry.formulaMap ?? []) {
      if (!formula.corpus) err(`${label}: formulaMap entry without corpus code`);
      if (formula.adoptedAs !== null && !FORMULA_RE.test(formula.adoptedAs)) {
        err(`${label}: formula ${formula.corpus} adoptedAs ${formula.adoptedAs} is not namespaced (<platform>/<surface>/<slug>@<n>)`);
      }
      if (formula.adoptedAs && entry.platform && !formula.adoptedAs.startsWith(`${entry.platform}/`) && !formula.adoptedAs.startsWith("core/")) {
        err(`${label}: formula ${formula.adoptedAs} must live under ${entry.platform}/ or core/`);
      }
    }
    if (entry.disposition === "adopt-overlay" && entry.capability === "draft" && !(entry.formulaMap ?? []).some((f) => f.adoptedAs)) {
      err(`${label}: adopt-overlay draft skills must map at least one formula`);
    }
  }
  for (const skill of scanned) {
    if (!seen.has(skill.path)) err(`skill ${skill.path} exists on disk but has no manifest entry`);
  }
  return errors;
}

/** Refresh mechanical fields, keeping curated dispositions/replacements keyed by ref/vendor. */
export function refreshManifest(manifest, scanned) {
  const entries = new Map((manifest.skills ?? []).map((entry) => [entry.path, entry]));
  const skills = scanned.map((disk) => {
    const prev = entries.get(disk.path) ?? { id: disk.id, family: disk.family, path: disk.path };
    const prevMissing = new Map((prev.missingReferences ?? []).map((m) => [m.ref, m]));
    const prevVendors = new Map((prev.vendorAssumptions ?? []).map((v) => [v.vendor, v]));
    return {
      ...prev,
      id: disk.id,
      family: disk.family,
      path: disk.path,
      files: disk.files,
      datedClaims: disk.datedClaims,
      missingReferences: disk.missingReferences.map((m) => ({
        ref: m.ref,
        referencedFrom: m.referencedFrom,
        disposition: prevMissing.get(m.ref)?.disposition ?? null,
        replacement: prevMissing.get(m.ref)?.replacement ?? null,
      })),
      vendorAssumptions: disk.vendorAssumptions.map((v) => ({
        vendor: v.vendor,
        symbols: v.symbols,
        replacement: prevVendors.get(v.vendor)?.replacement ?? null,
      })),
    };
  });
  return { ...manifest, skills };
}

export function run(argv = process.argv.slice(2), repoRoot = REPO_ROOT) {
  const args = parseArgs(argv);
  const rootAbs = path.resolve(repoRoot, args.root);
  const manifestAbs = path.resolve(repoRoot, args.manifest);
  const platforms = readPlatformRegistry(repoRoot);
  const scanned = scanCorpus(rootAbs);
  let manifest = fs.existsSync(manifestAbs)
    ? JSON.parse(fs.readFileSync(manifestAbs, "utf8"))
    : { schemaVersion: 1, root: args.root, families: [], skills: [] };

  if (args.update) {
    manifest = refreshManifest(manifest, scanned);
    fs.writeFileSync(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const errors = validateManifest(manifest, scanned, platforms);
  const fileCount = scanned.reduce((n, skill) => n + skill.files.length, 0);
  const missingRecordCount = scanned.reduce((n, skill) => n + skill.missingReferences.length, 0);
  const missingEdgeCount = scanned.reduce(
    (n, skill) =>
      n + skill.missingReferences.reduce((count, missing) => count + missing.referencedFrom.length, 0),
    0
  );
  const missingTargetCount = new Set(
    scanned.flatMap((skill) => skill.missingReferences.map((missing) => missing.ref))
  ).size;
  if (errors.length) {
    console.error(`writing-corpus manifest: ${errors.length} error(s)`);
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  console.log(
    `writing-corpus manifest: OK (${scanned.length} skills, ${fileCount} files, ${missingRecordCount} per-skill missing-target records, ${missingEdgeCount} reference edges, ${missingTargetCount} unique missing target paths, ${manifest.families.length} families)`
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run());
}
