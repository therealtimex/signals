#!/usr/bin/env node
/**
 * Stage @realtimex/signals-pp-cli platform packages + main launcher for npm publish.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BIN_ROOT = path.join(ROOT, "tools", "signals-pp-cli", "bin");
const NPM_SRC = path.join(ROOT, "tools", "signals-pp-cli", "npm");
const OUT_ROOT = path.join(ROOT, "dist", "npm");

const PLATFORMS = [
  { npmOs: "darwin", npmCpu: "arm64" },
  { npmOs: "darwin", npmCpu: "x64" },
  { npmOs: "linux", npmCpu: "arm64" },
  { npmOs: "linux", npmCpu: "x64" },
  { npmOs: "win32", npmCpu: "x64" },
  { npmOs: "win32", npmCpu: "arm64" },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const version = String(readJson(path.join(ROOT, "package.json")).version || "").trim();
  if (!version) throw new Error("package.json version missing");
  if (!fs.existsSync(BIN_ROOT)) {
    throw new Error("Missing tools/signals-pp-cli/bin — run: npm run build:signals-pp-cli");
  }

  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUT_ROOT, { recursive: true });

  const optionalDependencies = {};
  const publishedPlatforms = [];

  for (const platform of PLATFORMS) {
    const binaryName = platform.npmOs === "win32" ? "signals-pp-cli.exe" : "signals-pp-cli";
    const binarySrc = path.join(BIN_ROOT, `${platform.npmOs}-${platform.npmCpu}`, binaryName);
    if (!fs.existsSync(binarySrc)) {
      console.warn(`[signals-pp-cli npm] skip ${platform.npmOs}-${platform.npmCpu}: missing ${binarySrc}`);
      continue;
    }

    const packageName = `@realtimex/signals-pp-cli-${platform.npmOs}-${platform.npmCpu}`;
    const pkgDir = path.join(OUT_ROOT, packageName);
    const binDest = path.join(pkgDir, "bin", binaryName);
    copyFile(binarySrc, binDest);
    if (platform.npmOs !== "win32") {
      fs.chmodSync(binDest, 0o755);
    }

    writeJson(path.join(pkgDir, "package.json"), {
      name: packageName,
      version,
      description: `Signals Printing Press CLI binary (${platform.npmOs}-${platform.npmCpu})`,
      license: "MIT",
      os: [platform.npmOs],
      cpu: [platform.npmCpu],
      files: ["bin"],
      publishConfig: { access: "public" },
    });

    optionalDependencies[packageName] = version;
    publishedPlatforms.push(packageName);
    console.log(`[signals-pp-cli npm] staged ${packageName}@${version}`);
  }

  if (publishedPlatforms.length === 0) {
    throw new Error("No platform binaries found to stage for npm publish");
  }

  const mainDir = path.join(OUT_ROOT, "@realtimex", "signals-pp-cli");
  fs.mkdirSync(path.join(mainDir, "bin"), { recursive: true });
  copyFile(path.join(NPM_SRC, "bin", "signals-pp-cli.js"), path.join(mainDir, "bin", "signals-pp-cli.js"));
  fs.chmodSync(path.join(mainDir, "bin", "signals-pp-cli.js"), 0o755);
  copyFile(path.join(NPM_SRC, "README.md"), path.join(mainDir, "README.md"));

  writeJson(path.join(mainDir, "package.json"), {
    name: "@realtimex/signals-pp-cli",
    version,
    description: "Signals Printing Press CLI for terminal agents",
    license: "MIT",
    bin: {
      "signals-pp-cli": "./bin/signals-pp-cli.js",
    },
    files: ["bin", "README.md"],
    optionalDependencies,
    publishConfig: { access: "public" },
  });

  writeJson(path.join(OUT_ROOT, "publish-order.json"), {
    version,
    packages: [...publishedPlatforms, "@realtimex/signals-pp-cli"],
  });

  console.log(
    `[signals-pp-cli npm] staged @realtimex/signals-pp-cli@${version} with ${publishedPlatforms.length} platform package(s)`,
  );
}

main();
