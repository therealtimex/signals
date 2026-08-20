#!/usr/bin/env node
/**
 * Validate and boot the release-ready Signals native-platform runtime archive.
 * Usage: node scripts/test-standalone-artifact.mjs [path-to-tar.gz]
 */
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SIGNALS_NODE_VERSION,
  assertSignalsNodeRuntime,
} from "./node-runtime-contract.mjs";

assertSignalsNodeRuntime({ label: "Standalone artifact smoke test" });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const hostTarget = `${process.platform}-${process.arch}`;
const archivePath =
  process.argv[2] ??
  path.join(root, `dist/signals-${packageJson.version}-${hostTarget}.tar.gz`);
const releaseManifestPath = path.join(root, "marketplace/release-manifest.json");

if (!existsSync(archivePath)) {
  console.error(`Standalone archive not found: ${archivePath}`);
  console.error("Run: npm run build:standalone-artifact");
  process.exit(1);
}

const entries = execFileSync("tar", ["-tzf", archivePath], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
})
  .split("\n")
  .map((entry) => entry.trim().replace(/^\.\//, ""))
  .filter((entry) => entry && !entry.endsWith("/"));
const errors = [];

const requiredEntries = [
  "server.js",
  "next-server.js",
  "package.json",
  "LICENSE",
  "node-runtime-contract.mjs",
  ".next/BUILD_ID",
  ".next/required-server-files.json",
  "public/favicon.ico",
  "guide/index.md",
  "resources/migrations/0000_tired_thanos.sql",
  "resources/migrations/meta/_journal.json",
  "tools/signals-pp-cli/bin/signals-pp-cli.js",
];
for (const entry of requiredEntries) {
  if (!entries.includes(entry)) errors.push(`Missing runtime entry: ${entry}`);
}
const hostCliExecutable =
  process.platform === "win32" ? "signals-pp-cli.exe" : "signals-pp-cli";
const hostCliBinary = `tools/signals-pp-cli/bin/${hostTarget}/${hostCliExecutable}`;
if (!entries.includes(hostCliBinary)) {
  errors.push(`Missing runtime entry: ${hostCliBinary}`);
}
for (const [prefix, label] of [
  [".next/server/", "compiled Next.js server"],
  [".next/static/", "Next.js static assets"],
  ["node_modules/next/", "Next.js runtime dependency"],
  ["node_modules/better-sqlite3/", "SQLite runtime dependency"],
]) {
  if (!entries.some((entry) => entry.startsWith(prefix))) {
    errors.push(`Missing ${label}: ${prefix}`);
  }
}

const allowedRootFiles = new Set([
  "LICENSE",
  "next-server.js",
  "package.json",
  "node-runtime-contract.mjs",
  "server.js",
]);
const allowedRootDirectories = new Set([
  ".next",
  "guide",
  "node_modules",
  "public",
  "resources",
  "tools",
]);
for (const entry of entries) {
  const [rootSegment] = entry.split("/");
  if (
    (entry.includes("/") && !allowedRootDirectories.has(rootSegment)) ||
    (!entry.includes("/") && !allowedRootFiles.has(entry))
  ) {
    errors.push(`Unexpected release entry: ${entry}`);
  }
  if (
    entry.startsWith("resources/") &&
    !/^resources\/migrations\/(?:[^/]+\.sql|meta\/[^/]+\.json)$/.test(entry)
  ) {
    errors.push(`Unexpected runtime resource: ${entry}`);
  }
  if (
    entry.startsWith("tools/") &&
    !/^tools\/signals-pp-cli\/bin\/(?:signals-pp-cli\.js|(?:darwin|linux)-[a-z0-9]+\/signals-pp-cli|win32-[a-z0-9]+\/signals-pp-cli\.exe)$/.test(
      entry,
    )
  ) {
    errors.push(`Unexpected tools entry: ${entry}`);
  }
  if (entry.endsWith(".map")) errors.push(`Source map: ${entry}`);
  if (/\.(?:zip|tgz|tar|tar\.gz)$/.test(entry)) errors.push(`Nested archive: ${entry}`);
  if (/^(?!node_modules\/).*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry)) {
    errors.push(`Test source: ${entry}`);
  }
  if (
    !entry.startsWith("node_modules/") &&
    !entry.startsWith(".next/node_modules/") &&
    /\.[cm]?tsx?$/.test(entry)
  ) {
    errors.push(`TypeScript source: ${entry}`);
  }
}

if (!existsSync(releaseManifestPath)) {
  errors.push(`Release manifest not found: ${releaseManifestPath}`);
} else {
  const releaseManifest = JSON.parse(readFileSync(releaseManifestPath, "utf8"));
  if (releaseManifest.schemaVersion !== 2 || releaseManifest.proprietary !== true) {
    errors.push("Release manifest must use proprietary artifact contract v2");
  }
  if (
    releaseManifest.runtime?.kind !== "node" ||
    releaseManifest.runtime?.version !== SIGNALS_NODE_VERSION ||
    releaseManifest.runtime?.managedBy !== "realtimex"
  ) {
    errors.push(
      `Release manifest does not require managed Node ${SIGNALS_NODE_VERSION}`,
    );
  }
  const artifact = Object.values(releaseManifest.artifacts ?? {}).find(
    (candidate) => candidate.artifactName === path.basename(archivePath),
  );
  const checksum = createHash("sha256")
    .update(readFileSync(archivePath))
    .digest("hex");
  if (!artifact) {
    errors.push(`Release manifest does not select ${path.basename(archivePath)}`);
  } else if (artifact.checksumSha256 !== checksum) {
    errors.push("Release manifest checksum does not match standalone artifact");
  } else if (artifact.sizeBytes !== statSync(archivePath).size) {
    errors.push("Release manifest size does not match standalone artifact");
  }
  const selected = releaseManifest.artifacts?.[hostTarget];
  if (selected?.artifactName !== path.basename(archivePath)) {
    errors.push(`Release manifest does not map host target ${hostTarget} to archive`);
  } else if (`${selected.platform}-${selected.arch}` !== hostTarget) {
    errors.push(`Release manifest selector fields do not match ${hostTarget}`);
  }
}

if (errors.length) {
  console.error("Standalone artifact validation failed:");
  for (const error of errors.slice(0, 50)) console.error(`  - ${error}`);
  if (errors.length > 50) console.error(`  - ...and ${errors.length - 50} more`);
  process.exit(1);
}

const tempRoot = mkdtempSync(path.join(tmpdir(), "signals-standalone-test-"));
const extractDir = path.join(tempRoot, "artifact");
const dataDir = path.join(tempRoot, "data");
let child;
let logs = "";

try {
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", extractDir]);

  const artifactPackage = JSON.parse(
    readFileSync(path.join(extractDir, "package.json"), "utf8"),
  );
  if (artifactPackage.private !== true || artifactPackage.license !== "UNLICENSED") {
    throw new Error("Runtime package is not marked private and UNLICENSED");
  }
  const license = readFileSync(path.join(extractDir, "LICENSE"), "utf8");
  if (!license.includes("All rights reserved") || license.includes("Apache License")) {
    throw new Error("Runtime artifact does not contain the proprietary license notice");
  }
  const port = await reservePort();
  child = spawn(process.execPath, ["server.js"], {
    cwd: extractDir,
    env: {
      ...process.env,
      CI: "true",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      SIGNALS_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    logs = appendLogs(logs, chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs = appendLogs(logs, chunk);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealthyServer(child, `${baseUrl}/api/health`);
  const guideAsset = await fetch(`${baseUrl}/api/guide/assets/dashboard-overview.png`);
  if (!guideAsset.ok) {
    throw new Error(`Guide asset request failed (${guideAsset.status})`);
  }
  const optimizedImage = await fetch(
    `${baseUrl}/_next/image?url=%2Fandroid-chrome-192x192.png&w=64&q=75`,
  );
  if (!optimizedImage.ok) {
    throw new Error(`Native image optimization failed (${optimizedImage.status})`);
  }
  if (!existsSync(path.join(dataDir, "data.db"))) {
    throw new Error("Fresh runtime boot did not create the Signals database");
  }

  console.log(
    `OK: ${archivePath} (${entries.length} entries, ${formatBytes(statSync(archivePath).size)})`,
  );
  console.log("OK: extracted runtime booted, migrated a fresh database, and served guide assets");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (logs.trim()) console.error(`Standalone runtime output:\n${logs.trim()}`);
  process.exitCode = 1;
} finally {
  await stopChild(child);
  rmSync(tempRoot, { recursive: true, force: true });
}

function appendLogs(current, chunk) {
  return (current + String(chunk)).slice(-32_000);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error("Failed to reserve a local port");
  return port;
}

async function waitForHealthyServer(server, healthUrl, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Standalone runtime exited before becoming healthy (${server.exitCode})`);
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Standalone runtime did not become healthy at ${healthUrl}`);
}

async function stopChild(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
      resolve();
    }, 5_000);
    server.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
