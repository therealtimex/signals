#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  applyMarketplaceManifestOverlay,
  releaseManifestToLocalAppArtifacts,
} from "./marketplace/repack-plugin-bundle.mjs";

const releaseManifest = {
  signalsVersion: "9.9.9",
  artifacts: {
    "darwin-arm64": {
      artifactName: "signals-9.9.9-darwin-arm64.tar.gz",
      checksumSha256: "a".repeat(64),
    },
    "darwin-x64": {
      artifactName: "signals-9.9.9-darwin-x64.tar.gz",
      checksumSha256: "b".repeat(64),
    },
    "linux-arm64": {
      artifactName: "signals-9.9.9-linux-arm64.tar.gz",
      checksumSha256: "c".repeat(64),
    },
    "linux-x64": {
      artifactName: "signals-9.9.9-linux-x64.tar.gz",
      checksumSha256: "d".repeat(64),
    },
    "win32-arm64": {
      artifactName: "signals-9.9.9-win32-arm64.tar.gz",
      checksumSha256: "e".repeat(64),
    },
    "win32-x64": {
      artifactName: "signals-9.9.9-win32-x64.tar.gz",
      checksumSha256: "f".repeat(64),
    },
  },
};

const plugin = {
  id: "com.realtimex.signals",
  version: "9.9.9",
  capabilities: { workspace_skills: [{ key: "realtimex-signals" }] },
};

const artifacts = releaseManifestToLocalAppArtifacts(releaseManifest, "9.9.9");
assert.equal(
  artifacts.darwin_arm64.path,
  "https://github.com/therealtimex/signals/releases/download/v9.9.9/signals-9.9.9-darwin-arm64.tar.gz"
);
assert.equal(artifacts.darwin_arm64.sha256, "a".repeat(64));

const patched = applyMarketplaceManifestOverlay(plugin, releaseManifest, "9.9.9");
assert.deepEqual(patched.capabilities.local_apps, ["signals"]);
assert.equal(patched.local_apps[0].key, "signals");
assert.equal(Object.keys(patched.local_apps[0].artifact).length, 6);
assert.equal(patched.capabilities.skills[0].directory, "skills/realtimex-signals");

console.log("OK marketplace repack overlay");
