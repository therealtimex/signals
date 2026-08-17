#!/usr/bin/env node
/**
 * Smoke test: com.realtimex.signals plugin zip structure.
 * Usage: node scripts/test-realtimex-plugin-package.mjs [path-to-zip]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const zipPath =
  process.argv[2] || path.join(root, "dist/com.realtimex.signals-plugin.zip");

if (!fs.existsSync(zipPath)) {
  console.error(`Plugin zip not found: ${zipPath}`);
  console.error("Run: npm run build:standalone-artifact && npm run package:realtimex-plugin");
  process.exit(1);
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);
const rtxManifest = JSON.parse(
  fs.readFileSync(path.join(root, "rtx-manifest.json"), "utf8")
);

const listing = execSync(`zipinfo -1 "${zipPath}"`, { encoding: "utf8" });
const entries = listing
  .split("\n")
  .map((line) => line.trim().replace(/\/$/, ""))
  .filter(Boolean);

const required = [
  "realtimex.plugin.json",
  "templates/signals/AGENTS.md",
  "skills/realtimex-signals/SKILL.md",
  "skills/realtimex-signals/scripts/resolve-base-url.sh",
  "skills/signals-publish/SKILL.md",
  "skills/signals-publish/scripts/x-publish.cjs",
  "flows/signals-crm-agent-task.agent-flow.json",
  "flows/signals-create-enrich-contact.agent-flow.json",
  "marketplace/local-app.manifest.json",
  "marketplace/release-manifest.json",
];

const manifestRaw = execSync(`unzip -p "${zipPath}" realtimex.plugin.json`, {
  encoding: "utf8",
});
const manifest = JSON.parse(manifestRaw);

const releaseManifestRaw = execSync(
  `unzip -p "${zipPath}" marketplace/release-manifest.json`,
  { encoding: "utf8" }
);
const releaseManifest = JSON.parse(releaseManifestRaw);

const localAppManifestRaw = execSync(
  `unzip -p "${zipPath}" marketplace/local-app.manifest.json`,
  { encoding: "utf8" }
);
const localAppManifest = JSON.parse(localAppManifestRaw);

const errors = [];
const canonicalVersion = packageJson.version;
const localAppId = "47e45f71-3279-42f5-8e95-731de01b6eae";

for (const rel of required) {
  if (!entries.includes(rel)) {
    errors.push(`Missing entry: ${rel}`);
  }
}

if (manifest.id !== "com.realtimex.signals") {
  errors.push(`Unexpected plugin id: ${manifest.id}`);
}
if (manifest.version !== canonicalVersion) {
  errors.push(
    `Plugin manifest version ${manifest.version} != package.json ${canonicalVersion}`
  );
}
if (!manifest.capabilities?.workspace_provisions?.includes("signals")) {
  errors.push("Missing workspace_provisions signals");
}
if (!manifest.capabilities?.workspace_skills?.length) {
  errors.push("Missing workspace_skills");
}

const provisionSlug = manifest.provisions?.workspaces?.find(
  (w) => w.key === "signals"
)?.slug;
if (
  !provisionSlug ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    provisionSlug
  )
) {
  errors.push(`Invalid workspace provision slug UUID: ${provisionSlug}`);
}

if (releaseManifest.signalsVersion !== canonicalVersion) {
  errors.push(
    `Release manifest signalsVersion ${releaseManifest.signalsVersion} != package.json ${canonicalVersion}`
  );
}
if (releaseManifest.pluginVersion !== canonicalVersion) {
  errors.push(
    `Release manifest pluginVersion ${releaseManifest.pluginVersion} != package.json ${canonicalVersion}`
  );
}
if (!releaseManifest.checksumSha256 || releaseManifest.checksumSha256.length < 64) {
  errors.push("Release manifest missing checksumSha256");
}
if (releaseManifest.localAppId !== localAppId) {
  errors.push(`Release manifest localAppId mismatch: ${releaseManifest.localAppId}`);
}

if (rtxManifest.version !== canonicalVersion) {
  errors.push(
    `rtx-manifest.json version ${rtxManifest.version} != package.json ${canonicalVersion}`
  );
}

if (localAppManifest.id !== localAppId) {
  errors.push(`local-app.manifest.json id mismatch: ${localAppManifest.id}`);
}

const skillMd = execSync(
  `unzip -p "${zipPath}" skills/realtimex-signals/SKILL.md`,
  { encoding: "utf8" }
);
if (skillMd.includes(".claude/skills/realtimex-signals")) {
  errors.push("realtimex-signals SKILL.md still references .claude/skills paths");
}

if (entries.some((e) => e.endsWith(".mjs"))) {
  errors.push("Plugin zip contains .mjs files (validator requires CommonJS)");
}

if (entries.some((e) => e.includes("node_modules"))) {
  errors.push("Plugin zip contains node_modules (should be excluded)");
}

if (errors.length) {
  console.error("Plugin package validation failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK: ${zipPath} (${entries.length} entries)`);
