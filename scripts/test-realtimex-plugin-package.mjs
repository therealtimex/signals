#!/usr/bin/env node
/**
 * Smoke test: com.realtimex.signals plugin zip structure and bundled skill runtime.
 * Usage: node scripts/test-realtimex-plugin-package.mjs [path-to-zip]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const publishSkillMd = execSync(
  `unzip -p "${zipPath}" skills/signals-publish/SKILL.md`,
  { encoding: "utf8" }
);
if (publishSkillMd.includes(".claude/skills/signals-publish")) {
  errors.push(
    "signals-publish SKILL.md still references .claude/skills paths (expected staged skills/ path)"
  );
}
if (!publishSkillMd.includes("skills/signals-publish/scripts/x-publish.cjs")) {
  errors.push("signals-publish SKILL.md missing staged script path");
}

if (entries.some((e) => e.endsWith(".mjs") && !e.includes("node_modules"))) {
  errors.push("Plugin zip contains .mjs files outside node_modules (validator requires CommonJS skill scripts)");
}

if (entries.some((e) => e.includes("node_modules"))) {
  errors.push("Plugin zip contains node_modules (forbidden by plugin contract)");
}

function assertBundledSkillRunnable() {
  const probe = spawnSync("agent-browser", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    throw new Error("agent-browser CLI not available for plugin package smoke test");
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "signals-plugin-smoke-"));
  try {
    execSync(`unzip -q "${zipPath}" -d "${workDir}"`, { stdio: "pipe" });
    const skillRoot = path.join(workDir, "skills", "signals-publish");
    const scriptPath = path.join(skillRoot, "scripts", "x-publish.cjs");
    const payloadPath = path.join(workDir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify({ text: "plugin zip smoke test" }));

    const result = spawnSync(
      process.execPath,
      [scriptPath, "--port", "9222", "--payload", payloadPath],
      { cwd: skillRoot, encoding: "utf8" }
    );
    const output = `${result.stdout}\n${result.stderr}`;
    if (
      /ERR_MODULE_NOT_FOUND/.test(output) ||
      /Cannot find module 'playwright-core'/.test(output) ||
      /Cannot find package 'playwright-core'/.test(output)
    ) {
      throw new Error(`Bundled skill should not require playwright-core:\n${output}`);
    }
    if (/agent-browser CLI not found/.test(output)) {
      throw new Error(`Bundled skill did not resolve host agent-browser:\n${output}`);
    }

    const lastLine = output.trim().split("\n").filter(Boolean).pop() ?? "";
    const parsed = JSON.parse(lastLine);
    if (typeof parsed.success !== "boolean") {
      throw new Error(`Expected JSON result on last stdout line: ${lastLine}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (errors.length) {
  console.error("Plugin package validation failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

try {
  assertBundledSkillRunnable();
} catch (err) {
  console.error("Plugin package isolated skill execution failed:");
  console.error(`  - ${err.message}`);
  process.exit(1);
}

console.log(`OK: ${zipPath} (${entries.length} entries)`);
