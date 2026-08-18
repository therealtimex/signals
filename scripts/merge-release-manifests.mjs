#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const inputPaths = process.argv.slice(2).map((input) => path.resolve(input));

if (inputPaths.length === 0 && fs.existsSync(distDir)) {
  inputPaths.push(
    ...fs
      .readdirSync(distDir)
      .filter((name) => /^release-target-.+\.json$/.test(name))
      .sort()
      .map((name) => path.join(distDir, name)),
  );
}

if (inputPaths.length === 0) {
  console.error("No dist/release-target-*.json manifests found");
  process.exit(1);
}

const manifests = inputPaths.map((manifestPath) => ({
  manifestPath,
  value: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
}));
const first = manifests[0].value;
const commonFields = [
  "schemaVersion",
  "signalsVersion",
  "pluginVersion",
  "pluginId",
  "localAppId",
  "proprietary",
  "runtime",
  "minRealtimeXVersion",
  "permissions",
  "platformDependency",
];
const artifacts = {};
const errors = [];

for (const { manifestPath, value } of manifests) {
  for (const field of commonFields) {
    if (JSON.stringify(value[field]) !== JSON.stringify(first[field])) {
      errors.push(`${path.basename(manifestPath)} disagrees on ${field}`);
    }
  }

  for (const [target, artifact] of Object.entries(value.artifacts ?? {})) {
    if (artifacts[target]) {
      errors.push(`Duplicate artifact target: ${target}`);
      continue;
    }
    if (`${artifact.platform}-${artifact.arch}` !== target) {
      errors.push(`Artifact selector mismatch for ${target}`);
    }
    if (artifact.artifactName !== `signals-${first.signalsVersion}-${target}.tar.gz`) {
      errors.push(`Artifact filename mismatch for ${target}`);
    }
    if (
      artifact.artifactPath !== artifact.artifactName ||
      path.basename(artifact.artifactPath ?? "") !== artifact.artifactPath
    ) {
      errors.push(`Artifact path must be a bundle-relative filename for ${target}`);
    }
    if (!/^[a-f0-9]{64}$/.test(artifact.checksumSha256 ?? "")) {
      errors.push(`Invalid sha256 for ${target}`);
    }
    const artifactPath = path.join(distDir, path.basename(artifact.artifactPath ?? ""));
    if (!fs.existsSync(artifactPath)) {
      errors.push(`Artifact file missing for ${target}: ${artifact.artifactPath}`);
    } else {
      const bytes = fs.readFileSync(artifactPath);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (checksum !== artifact.checksumSha256) {
        errors.push(`Artifact checksum mismatch for ${target}`);
      }
      if (bytes.length !== artifact.sizeBytes) {
        errors.push(`Artifact size mismatch for ${target}`);
      }
    }
    artifacts[target] = artifact;
  }
}

const requiredTargets = (process.env.SIGNALS_REQUIRED_ARTIFACT_TARGETS ?? "")
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);
for (const target of requiredTargets) {
  if (!artifacts[target]) errors.push(`Missing required artifact target: ${target}`);
}

if (errors.length > 0) {
  console.error("Release manifest merge failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const merged = {
  ...Object.fromEntries(commonFields.map((field) => [field, first[field]])),
  artifacts: Object.fromEntries(
    Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right)),
  ),
  builtAt: new Date().toISOString(),
};
const outputPath = path.join(root, "marketplace", "release-manifest.json");
const signaturePath = path.join(root, "marketplace", "release-manifest.sig.json");
fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`);
fs.rmSync(signaturePath, { force: true });

console.log(
  `Wrote ${path.relative(root, outputPath)} (${Object.keys(artifacts).length} targets)`,
);
