#!/usr/bin/env node
import { createHash, createPrivateKey, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(
  process.argv[2] ?? path.join(root, "marketplace", "release-manifest.json"),
);
const signaturePath = path.resolve(
  process.argv[3] ?? path.join(root, "marketplace", "release-manifest.sig.json"),
);
const encodedPrivateKey = process.env.SIGNALS_RELEASE_SIGNING_PRIVATE_KEY_B64;
const keyId = process.env.SIGNALS_RELEASE_SIGNING_KEY_ID;

if (!encodedPrivateKey || !keyId) {
  console.error(
    "SIGNALS_RELEASE_SIGNING_PRIVATE_KEY_B64 and SIGNALS_RELEASE_SIGNING_KEY_ID are required",
  );
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId)) {
  console.error("SIGNALS_RELEASE_SIGNING_KEY_ID must be a safe, non-empty key identifier");
  process.exit(1);
}
if (!fs.existsSync(manifestPath)) {
  console.error(`Release manifest not found: ${manifestPath}`);
  process.exit(1);
}
if (manifestPath === signaturePath) {
  console.error("Release manifest and signature output paths must be different");
  process.exit(1);
}

let privateKey;
try {
  privateKey = createPrivateKey(
    Buffer.from(encodedPrivateKey.replace(/\s/g, ""), "base64").toString("utf8"),
  );
} catch (error) {
  console.error(`Invalid release signing private key: ${error.message}`);
  process.exit(1);
}
if (privateKey.asymmetricKeyType !== "ed25519") {
  console.error(
    `Release signing key must be Ed25519, received ${privateKey.asymmetricKeyType ?? "unknown"}`,
  );
  process.exit(1);
}

const manifestBytes = fs.readFileSync(manifestPath);
const envelope = {
  schemaVersion: 1,
  algorithm: "Ed25519",
  keyId,
  manifest: path.basename(manifestPath),
  manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  signatureBase64: sign(null, manifestBytes, privateKey).toString("base64"),
};

fs.writeFileSync(signaturePath, `${JSON.stringify(envelope, null, 2)}\n`);
console.log(`Signed ${path.basename(manifestPath)} with key ${keyId}`);
