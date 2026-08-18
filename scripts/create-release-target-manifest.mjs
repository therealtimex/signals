#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [target, artifactArgument] = process.argv.slice(2);

if (!target || !artifactArgument) {
  console.error(
    "Usage: node scripts/create-release-target-manifest.mjs <platform-arch> <artifact>",
  );
  process.exit(1);
}

const artifactPath = path.resolve(artifactArgument);
if (!fs.existsSync(artifactPath)) {
  console.error(`Artifact not found: ${artifactPath}`);
  process.exit(1);
}

const pkg = readJson("package.json");
const plugin = readJson("realtimex-plugin/realtimex.plugin.json");
const localApp = readJson("realtimex-plugin/marketplace/local-app.manifest.json");
const rtxManifest = readJson("rtx-manifest.json");
const supportedTargets = localApp.artifactContract?.supportedTargets ?? [];

if (!supportedTargets.includes(target)) {
  console.error(`Unsupported marketplace target: ${target}`);
  process.exit(1);
}

const separator = target.indexOf("-");
const platform = target.slice(0, separator);
const arch = target.slice(separator + 1);
if (!platform || !arch || `${platform}-${arch}` !== target) {
  console.error(`Invalid platform-architecture target: ${target}`);
  process.exit(1);
}

const artifactBytes = fs.readFileSync(artifactPath);
const artifactName = path.basename(artifactPath);
const expectedArtifactName = `signals-${pkg.version}-${target}.tar.gz`;
if (artifactName !== expectedArtifactName) {
  console.error(`Artifact must be named ${expectedArtifactName}, received ${artifactName}`);
  process.exit(1);
}
const manifest = {
  schemaVersion: 2,
  signalsVersion: pkg.version,
  pluginVersion: plugin.version,
  pluginId: plugin.id,
  localAppId: localApp.id,
  proprietary: true,
  runtime: localApp.runtime,
  artifacts: {
    [target]: {
      platform,
      arch,
      artifactName,
      artifactPath: artifactName,
      checksumSha256: createHash("sha256").update(artifactBytes).digest("hex"),
      sizeBytes: artifactBytes.length,
    },
  },
  minRealtimeXVersion: "1.0.0",
  permissions: rtxManifest.permissions,
  platformDependency:
    "https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/issues/1614",
  builtAt: new Date().toISOString(),
};

const targetManifestPath = path.join(
  root,
  "dist",
  `release-target-${target}.json`,
);
const releaseManifestPath = path.join(root, "marketplace", "release-manifest.json");
const signaturePath = path.join(root, "marketplace", "release-manifest.sig.json");
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

fs.mkdirSync(path.dirname(targetManifestPath), { recursive: true });
fs.mkdirSync(path.dirname(releaseManifestPath), { recursive: true });
fs.writeFileSync(targetManifestPath, serialized);
fs.writeFileSync(releaseManifestPath, serialized);
fs.rmSync(signaturePath, { force: true });

console.log(`Wrote ${path.relative(root, targetManifestPath)}`);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}
