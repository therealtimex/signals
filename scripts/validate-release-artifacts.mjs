#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNALS_NODE_VERSION } from "./node-runtime-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(
  process.argv[2] ?? path.join(root, "marketplace", "release-manifest.json"),
);
if (!fs.existsSync(manifestPath)) {
  console.error(`Release manifest not found: ${manifestPath}`);
  console.error("Run: npm run build:standalone-artifact");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const errors = [];

if (manifest.schemaVersion !== 2 || manifest.proprietary !== true) {
  errors.push("Release manifest must use proprietary artifact contract v2");
}
if (
  manifest.runtime?.kind !== "node" ||
  manifest.runtime?.version !== SIGNALS_NODE_VERSION ||
  manifest.runtime?.managedBy !== "realtimex"
) {
  errors.push(
    `Release manifest must require RealtimeX-managed Node ${SIGNALS_NODE_VERSION}`,
  );
}

const artifacts = Object.entries(manifest.artifacts ?? {});
if (artifacts.length === 0) errors.push("Release manifest has no artifacts");

for (const [target, artifact] of artifacts) {
  const expectedName = `signals-${manifest.signalsVersion}-${target}.tar.gz`;
  if (`${artifact.platform}-${artifact.arch}` !== target) {
    errors.push(`Artifact selector mismatch for ${target}`);
  }
  if (
    artifact.artifactName !== expectedName ||
    artifact.artifactPath !== expectedName
  ) {
    errors.push(`Artifact filename mismatch for ${target}`);
  }

  const runtimePath = path.join(root, "dist", expectedName);
  if (!fs.existsSync(runtimePath)) {
    errors.push(`Artifact file missing for ${target}: dist/${expectedName}`);
    continue;
  }
  const bytes = fs.readFileSync(runtimePath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== artifact.checksumSha256) {
    errors.push(`Artifact checksum mismatch for ${target}`);
  }
  if (bytes.length !== artifact.sizeBytes) {
    errors.push(`Artifact size mismatch for ${target}`);
  }
}

const requiredTargets = (process.env.SIGNALS_REQUIRED_ARTIFACT_TARGETS ?? "")
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);
for (const target of requiredTargets) {
  if (!manifest.artifacts?.[target]) {
    errors.push(`Missing required artifact target: ${target}`);
  }
}

if (errors.length > 0) {
  console.error("Release artifact validation failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`OK: release manifest references ${artifacts.length} verified artifact(s)`);
