#!/usr/bin/env node
/**
 * Submit a marketplace plugin release (and optionally approve/publish as admin).
 *
 * Requires Keycloak password grant via KC_USER and KC_PASS (use rtxexec with
 * secret://marketplace-info@realtimex.co or equivalent publisher login).
 *
 * Usage:
 *   npm run repack:marketplace-plugin
 *   rtxexec --env KC_USER=secret://...#username --env KC_PASS=secret://...#password -- \\
 *     node scripts/marketplace/publish-release.mjs --submit --approve --publish
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MARKETPLACE_API,
  KEYCLOAK_CLIENT_ID,
  KEYCLOAK_TOKEN_URL,
  SIGNALS_MARKETPLACE_PLUGIN_ID,
  SIGNALS_PLUGIN_SLUG,
} from "./constants.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  const options = {
    bundle: path.join(root, "dist/com.realtimex.signals-plugin.marketplace.zip"),
    pluginId: SIGNALS_MARKETPLACE_PLUGIN_ID,
    apiBase: DEFAULT_MARKETPLACE_API,
    version: null,
    submit: false,
    approve: false,
    publish: false,
    amountMinor: null,
    currency: "USD",
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--bundle") options.bundle = path.resolve(argv[++i]);
    else if (arg === "--plugin-id") options.pluginId = argv[++i];
    else if (arg === "--api-base") options.apiBase = argv[++i].replace(/\/+$/, "");
    else if (arg === "--version") options.version = argv[++i];
    else if (arg === "--amount-minor") options.amountMinor = Number(argv[++i]);
    else if (arg === "--currency") options.currency = argv[++i];
    else if (arg === "--submit") options.submit = true;
    else if (arg === "--approve") options.approve = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/marketplace/publish-release.mjs [options]

Options:
  --bundle <path>     Marketplace repacked zip (default: dist/...marketplace.zip)
  --plugin-id <uuid>  Marketplace plugin id (default: Signals product id)
  --api-base <url>    Marketplace API base (default: ${DEFAULT_MARKETPLACE_API})
  --version <ver>     Release version (default: read from bundle manifest)
  --amount-minor <n>  Price in cents for new plugins only (existing price kept if omitted)
  --currency <code>   ISO currency (default: USD)
  --submit            Submit release for review after upload
  --approve           Admin: approve the review (requires --submit)
  --publish           Admin: publish after approve (requires --approve)

Environment:
  KC_USER, KC_PASS    Publisher Keycloak credentials (realtimex-app client)
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if ((options.approve || options.publish) && !options.submit) {
    throw new Error("--approve and --publish require --submit");
  }
  if (options.publish && !options.approve) {
    throw new Error("--publish requires --approve");
  }
  return options;
}

async function getAccessToken() {
  const username = process.env.KC_USER;
  const password = process.env.KC_PASS;
  if (!username || !password) {
    throw new Error("Set KC_USER and KC_PASS (for example via rtxexec --env)");
  }
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: KEYCLOAK_CLIENT_ID,
    username,
    password,
    scope: "openid profile email",
  });
  const res = await fetch(KEYCLOAK_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Keycloak token request failed: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function api(token, apiBase, pathname, { method = "GET", body } = {}) {
  const res = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      `${method} ${pathname} -> ${res.status}: ${text.slice(0, 500)}`
    );
    err.status = res.status;
    throw err;
  }
  return json;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readVersionFromBundle(bundlePath) {
  const manifestJson = execFileSync(
    "unzip",
    ["-p", bundlePath, "realtimex.plugin.json"],
    { encoding: "utf8" }
  );
  const manifest = JSON.parse(manifestJson);
  if (!manifest.version) throw new Error("Bundle manifest has no version");
  return manifest.version;
}

async function uploadArtifact(token, apiBase, releaseId, filePath) {
  const filename = path.basename(filePath);
  const byte_size = fs.statSync(filePath).size;
  const sha256 = sha256File(filePath);
  const init = await api(token, apiBase, "/v1/publisher/artifact-uploads", {
    method: "POST",
    body: {
      release_id: releaseId,
      filename,
      byte_size,
      sha256,
      media_type: "application/zip",
      platform: "any",
      architecture: "any",
    },
  });
  const putRes = await fetch(init.upload_url, {
    method: "PUT",
    headers: init.headers ?? {},
    body: fs.readFileSync(filePath),
  });
  if (!putRes.ok) {
    throw new Error(`Artifact upload failed (${putRes.status})`);
  }
  await api(
    token,
    apiBase,
    `/v1/publisher/artifact-uploads/${init.id}/complete`,
    { method: "POST", body: {} }
  );
  return { uploadId: init.id, sha256, byte_size };
}

async function main() {
  const options = parseArgs(process.argv);
  if (!fs.existsSync(options.bundle)) {
    throw new Error(
      `Bundle not found: ${options.bundle}\nRun: npm run repack:marketplace-plugin`
    );
  }

  const version = options.version ?? readVersionFromBundle(options.bundle);
  const token = await getAccessToken();
  const access = await api(token, options.apiBase, "/v1/me/marketplace-access");

  const releaseManifest = JSON.parse(
    execFileSync(
      "unzip",
      ["-p", options.bundle, "marketplace/release-manifest.json"],
      { encoding: "utf8" }
    )
  );

  const release = await api(
    token,
    options.apiBase,
    `/v1/publisher/plugins/${options.pluginId}/releases`,
    {
      method: "POST",
      body: { version, manifest: releaseManifest },
    }
  );
  console.log(`Release ${release.id} (${version}) ready for artifact upload`);

  await uploadArtifact(token, options.apiBase, release.id, options.bundle);
  console.log("Artifact uploaded and verified");

  if (!options.submit) {
    console.log("Upload complete (draft). Pass --submit to send for review.");
    return;
  }

  const review = await api(
    token,
    options.apiBase,
    `/v1/publisher/releases/${release.id}/submit`,
    { method: "POST", body: {} }
  );
  console.log(`Submitted review ${review.id} (${review.status})`);

  if (options.approve) {
    if (!access.is_marketplace_admin) {
      throw new Error("Account is not marketplace admin; cannot --approve");
    }
    await api(token, options.apiBase, `/v1/admin/reviews/${review.id}/approve`, {
      method: "POST",
      body: {
        reason: `Approve Signals v${version} marketplace release`,
        findings: [],
      },
    });
    console.log("Review approved");
  }

  if (options.publish) {
    await api(token, options.apiBase, `/v1/admin/reviews/${review.id}/publish`, {
      method: "POST",
      body: {
        reason: `Publish Signals v${version} to catalog`,
        findings: [],
      },
    });
    console.log("Review published");
  }

  const catalog = await fetch(
    `${options.apiBase}/v1/plugins/${SIGNALS_PLUGIN_SLUG}`
  ).then((r) => r.json());
  console.log(`Catalog latest_version: ${catalog.latest_version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
