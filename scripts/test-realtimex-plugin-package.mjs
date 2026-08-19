#!/usr/bin/env node
/**
 * Smoke test: com.realtimex.signals plugin zip structure and bundled skill runtime.
 * Usage: node scripts/test-realtimex-plugin-package.mjs [path-to-zip]
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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
  "tools/signals-pp-cli/bin/signals-pp-cli.js",
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
const requiredTargets = [
  "darwin-x64",
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
  "win32-arm64",
];

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
if (manifest.license !== "UNLICENSED") {
  errors.push(`Plugin manifest must be UNLICENSED, received ${manifest.license}`);
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
if (releaseManifest.schemaVersion !== 2) {
  errors.push(`Unsupported release manifest schema: ${releaseManifest.schemaVersion}`);
}
if (releaseManifest.proprietary !== true) {
  errors.push("Release manifest must mark Signals proprietary");
}
if (
  releaseManifest.runtime?.kind !== "node" ||
  releaseManifest.runtime?.version !== "20.x" ||
  releaseManifest.runtime?.managedBy !== "realtimex"
) {
  errors.push("Release manifest has an invalid managed Node runtime contract");
}
const releaseArtifacts = Object.entries(releaseManifest.artifacts ?? {});
if (releaseArtifacts.length === 0) {
  errors.push("Release manifest has no platform artifacts");
}
for (const [target, artifact] of releaseArtifacts) {
  if (`${artifact.platform}-${artifact.arch}` !== target) {
    errors.push(`Release artifact selector mismatch: ${target}`);
  }
  if (!/^[a-f0-9]{64}$/.test(artifact.checksumSha256 ?? "")) {
    errors.push(`Release artifact missing sha256: ${target}`);
  }
  if (!artifact.artifactName?.endsWith(`-${target}.tar.gz`)) {
    errors.push(`Release artifact filename mismatch: ${target}`);
  }
  if (artifact.artifactPath !== artifact.artifactName) {
    errors.push(`Release artifact path must be bundle-relative: ${target}`);
  }
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
if (localAppManifest.configuration?.command !== "{runtime.executable}") {
  errors.push("Local app must use the RealtimeX-managed runtime executable");
}
if (localAppManifest.artifactContract?.schemaVersion !== 2) {
  errors.push("Local app is missing artifact contract v2");
}
const supportedTargets = localAppManifest.artifactContract?.supportedTargets ?? [];
const uniqueSupportedTargets = [...new Set(supportedTargets)];
if (
  uniqueSupportedTargets.length !== supportedTargets.length ||
  [...uniqueSupportedTargets].sort().join(",") !==
    [...requiredTargets].sort().join(",")
) {
  errors.push(
    `Local app supported targets must exactly match RealtimeX SDK targets: ${requiredTargets.join(", ")}`
  );
}
for (const [target] of releaseArtifacts) {
  if (!supportedTargets.includes(target)) {
    errors.push(`Release artifact target is not supported by local app: ${target}`);
  }
}

const signatureEntry = "marketplace/release-manifest.sig.json";
const requireSignature = process.env.SIGNALS_REQUIRE_RELEASE_SIGNATURE === "1";
if (requireSignature && !entries.includes(signatureEntry)) {
  errors.push(`Missing entry: ${signatureEntry}`);
}
if (entries.includes(signatureEntry)) {
  const signature = JSON.parse(
    execSync(`unzip -p "${zipPath}" ${signatureEntry}`, { encoding: "utf8" }),
  );
  const manifestSha256 = createHash("sha256")
    .update(Buffer.from(releaseManifestRaw))
    .digest("hex");
  if (
    signature.algorithm !== "Ed25519" ||
    signature.manifest !== "release-manifest.json" ||
    signature.manifestSha256 !== manifestSha256 ||
    !signature.keyId ||
    !signature.signatureBase64
  ) {
    errors.push("Invalid release manifest signature envelope");
  }
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

const bundledPublishPath = "skills/signals-publish/scripts/x-publish.cjs";
const sourcePublishPath = path.join(
  root,
  ".claude/skills/signals-publish/scripts/x-publish.cjs"
);
if (!fs.existsSync(sourcePublishPath)) {
  errors.push(`Source missing for freshness check: ${sourcePublishPath}`);
} else {
  const sourceHash = createHash("sha256")
    .update(fs.readFileSync(sourcePublishPath))
    .digest("hex");
  const zipBytes = execSync(`unzip -p "${zipPath}" ${bundledPublishPath}`, {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  const zipHash = createHash("sha256").update(zipBytes).digest("hex");
  if (sourceHash !== zipHash) {
    errors.push(
      `Stale bundle: ${bundledPublishPath} sha256 ${zipHash} != source ${sourceHash} (rebuild plugin zip)`
    );
  }
}

if (errors.length) {
  console.error("Plugin package validation failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK: ${zipPath} (${entries.length} entries)`);
