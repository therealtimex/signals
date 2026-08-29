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
import { SIGNALS_NODE_VERSION } from "./node-runtime-contract.mjs";

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
  "skills/realtimex-signals/scripts/run-signals-pp-cli.sh",
  "skills/signals-publish/SKILL.md",
  "skills/signals-publish/scripts/x-publish.cjs",
  "skills/signals-writing/SKILL.md",
  "skills/signals-writing/reference.md",
  "skills/signals-writing/core/claims.md",
  "skills/signals-writing/core/voice.md",
  "skills/signals-writing/core/audit.md",
  "skills/signals-writing/core/adapt.md",
  "skills/signals-writing/core/approval.md",
  "skills/signals-writing/core/lineage.md",
  "skills/signals-writing/overlays/README.md",
  "skills/signals-writing/overlays/x.md",
  "skills/signals-writing/overlays/linkedin.md",
  "skills/signals-writing/overlays/facebook.md",
  "skills/signals-writing/scripts/writing-cli.cjs",
  "tools/signals-pp-cli/README.md",
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
const workspaceSkillNames = manifest.capabilities?.workspace_skills?.map((skill) => skill.key) ?? [];
for (const name of ["realtimex-signals", "signals-writing", "signals-publish"]) {
  if (!workspaceSkillNames.includes(name)) errors.push(`Missing workspace skill capability: ${name}`);
}
const provisionSkills = manifest.provisions?.workspaces?.find((workspace) => workspace.key === "signals")?.skills?.workspace?.include ?? [];
for (const name of ["realtimex-signals", "signals-writing", "signals-publish"]) {
  if (!provisionSkills.includes(name)) errors.push(`Missing provisioned workspace skill: ${name}`);
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
  releaseManifest.runtime?.version !== SIGNALS_NODE_VERSION ||
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
if (
  localAppManifest.runtime?.kind !== "node" ||
  localAppManifest.runtime?.version !== SIGNALS_NODE_VERSION ||
  localAppManifest.runtime?.managedBy !== "realtimex"
) {
  errors.push(
    `Local app must require RealtimeX-managed Node ${SIGNALS_NODE_VERSION}`,
  );
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
if (!skillMd.includes("run-signals-pp-cli.sh agent-tools invoke --agent")) {
  errors.push("realtimex-signals SKILL.md missing health-pinned CLI agent-tools invocation");
}
if (!skillMd.includes("Automated persona callbacks")) {
  errors.push("realtimex-signals SKILL.md missing persona callback CLI guidance");
}

const workspaceAgentsMd = execSync(
  `unzip -p "${zipPath}" templates/signals/AGENTS.md`,
  { encoding: "utf8" }
);
if (!workspaceAgentsMd.includes("run-signals-pp-cli.sh health")) {
  errors.push("Signals workspace AGENTS.md missing health-pinned CLI bootstrap");
}
if (!workspaceAgentsMd.includes("@realtimex/signals-pp-cli")) {
  errors.push("Signals workspace AGENTS.md missing npm CLI package reference");
}
if (workspaceAgentsMd.includes("run `scripts/resolve-base-url.sh`")) {
  errors.push("Signals workspace AGENTS.md requires an ambiguous helper path");
}

const bundledNativeCli = entries.filter(
  (entry) =>
    /^tools\/signals-pp-cli\/bin\/(?:darwin|linux|win32)-/.test(entry) ||
    entry === "tools/signals-pp-cli/bin/signals-pp-cli.cjs",
);
if (bundledNativeCli.length > 0) {
  errors.push(
    `Thin plugin must not ship bundled CLI binaries (found: ${bundledNativeCli.slice(0, 3).join(", ")}${bundledNativeCli.length > 3 ? "…" : ""})`,
  );
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

const writingMarkdownEntries = entries.filter(
  (entry) => entry.startsWith("skills/signals-writing/") && entry.endsWith(".md"),
);
const writingMarkdown = new Map();
for (const entry of writingMarkdownEntries) {
  const markdown = execSync(`unzip -p "${zipPath}" "${entry}"`, { encoding: "utf8" });
  writingMarkdown.set(entry, markdown);
  if (markdown.includes(".claude/skills/")) errors.push(`${entry} still references .claude/skills paths`);
}
const bundledAdapt = writingMarkdown.get("skills/signals-writing/core/adapt.md") ?? "";
if (/\b(?:variant|alternative)\b[\s\S]{0,160}`vs_`|`vs_`[\s\S]{0,160}\b(?:variant|alternative)\b/i.test(bundledAdapt)) {
  errors.push("Packaged adaptation guidance assigns voice-sample vs_ IDs to variants");
}
if (!bundledAdapt.includes("omit the top-level variant `id`")) {
  errors.push("Packaged adaptation guidance does not require server-allocated variant IDs");
}
if (entries.some((entry) => entry === "docs-dev" || entry.startsWith("docs-dev/"))) {
  errors.push("Plugin zip contains docs-dev reference corpus files");
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

const bundledWritingHelperPath = "skills/signals-writing/scripts/writing-cli.cjs";
const sourceWritingHelperPath = path.join(root, ".claude/skills/signals-writing/scripts/writing-cli.cjs");
if (!fs.existsSync(sourceWritingHelperPath)) {
  errors.push(`Source missing for freshness check: ${sourceWritingHelperPath}`);
} else {
  const sourceHash = createHash("sha256").update(fs.readFileSync(sourceWritingHelperPath)).digest("hex");
  const zipHash = createHash("sha256").update(execSync(`unzip -p "${zipPath}" ${bundledWritingHelperPath}`, { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 })).digest("hex");
  if (sourceHash !== zipHash) errors.push(`Stale bundle: ${bundledWritingHelperPath} sha256 ${zipHash} != source ${sourceHash} (rebuild plugin zip)`);
}

if (errors.length) {
  console.error("Plugin package validation failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK: ${zipPath} (${entries.length} entries)`);
