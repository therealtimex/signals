#!/usr/bin/env node
/**
 * Build a marketplace-upload plugin ZIP from the GitHub release plugin bundle.
 *
 * The release zip uses workspace_provisions + workspace_skills. Marketplace bundle
 * validation expects declared skill + local-app capabilities with HTTPS runtime
 * artifacts from the signed release manifest.
 *
 * Usage:
 *   node scripts/marketplace/repack-plugin-bundle.mjs
 *   node scripts/marketplace/repack-plugin-bundle.mjs \
 *     --zip dist/com.realtimex.signals-plugin.zip \
 *     --manifest marketplace/release-manifest.json \
 *     --out dist/com.realtimex.signals-plugin.marketplace.zip
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RELEASE_MANIFEST_TARGET_MAP,
  SIGNALS_PLUGIN_SLUG,
} from "./constants.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  const options = {
    zip: path.join(root, "dist/com.realtimex.signals-plugin.zip"),
    manifest: null,
    out: path.join(root, "dist/com.realtimex.signals-plugin.marketplace.zip"),
    version: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--zip") options.zip = path.resolve(argv[++i]);
    else if (arg === "--manifest") options.manifest = path.resolve(argv[++i]);
    else if (arg === "--out") options.out = path.resolve(argv[++i]);
    else if (arg === "--version") options.version = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/marketplace/repack-plugin-bundle.mjs [options]

Options:
  --zip <path>       Source plugin zip (default: dist/com.realtimex.signals-plugin.zip)
  --manifest <path>  release-manifest.json (default: read from zip marketplace/)
  --out <path>       Output marketplace zip (default: dist/...marketplace.zip)
  --version <ver>    Override version for GitHub download URLs (default: manifest/plugin)
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/**
 * @param {Record<string, unknown>} releaseManifest
 * @param {string} version
 */
export function releaseManifestToLocalAppArtifacts(releaseManifest, version) {
  const artifacts = releaseManifest.artifacts;
  if (!artifacts || typeof artifacts !== "object") {
    throw new Error("release-manifest.json must include an artifacts object");
  }
  const base = `https://github.com/therealtimex/signals/releases/download/v${version}/`;
  const artifact = {};
  for (const [key, spec] of Object.entries(artifacts)) {
    const target = RELEASE_MANIFEST_TARGET_MAP[key];
    if (!target) {
      throw new Error(`Unsupported release-manifest artifact key: ${key}`);
    }
    if (!spec || typeof spec !== "object") {
      throw new Error(`Invalid artifact spec for ${key}`);
    }
    const name = spec.artifactName;
    const sha256 = spec.checksumSha256;
    if (typeof name !== "string" || !name) {
      throw new Error(`artifactName missing for ${key}`);
    }
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`checksumSha256 missing or invalid for ${key}`);
    }
    artifact[target] = { path: base + name, sha256 };
  }
  const expected = Object.keys(RELEASE_MANIFEST_TARGET_MAP).length;
  if (Object.keys(artifact).length !== expected) {
    throw new Error(
      `Expected ${expected} platform artifacts in release manifest, got ${Object.keys(artifact).length}`
    );
  }
  return artifact;
}

/**
 * @param {Record<string, unknown>} pluginManifest
 * @param {Record<string, unknown>} releaseManifest
 * @param {string} version
 */
export function applyMarketplaceManifestOverlay(
  pluginManifest,
  releaseManifest,
  version
) {
  if (pluginManifest.id !== SIGNALS_PLUGIN_SLUG) {
    throw new Error(
      `Expected plugin id ${SIGNALS_PLUGIN_SLUG}, got ${pluginManifest.id}`
    );
  }
  if (pluginManifest.version !== version) {
    throw new Error(
      `Plugin manifest version ${pluginManifest.version} does not match ${version}`
    );
  }
  const artifact = releaseManifestToLocalAppArtifacts(releaseManifest, version);
  const capabilities = { ...(pluginManifest.capabilities || {}) };
  capabilities.skills = [
    { name: "realtimex-signals", directory: "skills/realtimex-signals" },
  ];
  capabilities.local_apps = ["signals"];
  return {
    ...pluginManifest,
    capabilities,
    local_apps: [
      {
        key: "signals",
        config: { command: "{runtime.executable}", args: ["server.js"] },
        artifact,
      },
    ],
  };
}

function readZipEntry(zipPath, entryPath) {
  return execFileSync("unzip", ["-p", zipPath, entryPath], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * @param {{ zipPath: string, releaseManifestPath?: string | null, outPath: string, version?: string | null }} opts
 */
export function repackPluginBundle(opts) {
  const { zipPath, outPath } = opts;
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Plugin zip not found: ${zipPath}`);
  }

  let releaseManifest;
  if (opts.releaseManifestPath) {
    releaseManifest = JSON.parse(
      fs.readFileSync(opts.releaseManifestPath, "utf8")
    );
  } else {
    releaseManifest = JSON.parse(
      readZipEntry(zipPath, "marketplace/release-manifest.json")
    );
  }

  const version =
    opts.version ||
    releaseManifest.signalsVersion ||
    releaseManifest.pluginVersion;
  if (!version) {
    throw new Error("Could not determine release version");
  }

  const plugin = JSON.parse(readZipEntry(zipPath, "realtimex.plugin.json"));
  const patched = applyMarketplaceManifestOverlay(
    plugin,
    releaseManifest,
    version
  );

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "signals-marketplace-repack-"));
  try {
    execFileSync("unzip", ["-q", zipPath, "-d", work]);
    fs.writeFileSync(
      path.join(work, "realtimex.plugin.json"),
      JSON.stringify(patched, null, 2) + "\n"
    );
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    execFileSync("zip", ["-qr", outPath, "."], { cwd: work });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  return { version, outPath, byteSize: fs.statSync(outPath).size };
}

function main() {
  const options = parseArgs(process.argv);
  const result = repackPluginBundle({
    zipPath: options.zip,
    releaseManifestPath: options.manifest,
    outPath: options.out,
    version: options.version,
  });
  console.log(
    `OK marketplace bundle ${result.outPath} (${result.byteSize} bytes, v${result.version})`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
