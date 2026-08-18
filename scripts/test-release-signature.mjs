#!/usr/bin/env node
import { generateKeyPairSync, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "signals-signature-test-"));
const manifestPath = path.join(tempDir, "release-manifest.json");
const signaturePath = path.join(tempDir, "release-manifest.sig.json");
const manifestBytes = Buffer.from('{"schemaVersion":2,"artifacts":{}}\n');
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

try {
  fs.writeFileSync(manifestPath, manifestBytes);
  const result = spawnSync(
    process.execPath,
    ["scripts/sign-release-manifest.mjs", manifestPath, signaturePath],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        SIGNALS_RELEASE_SIGNING_KEY_ID: "test-key",
        SIGNALS_RELEASE_SIGNING_PRIVATE_KEY_B64: Buffer.from(
          privateKey.export({ type: "pkcs8", format: "pem" }),
        ).toString("base64"),
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(`Signing command failed: ${result.stderr || result.stdout}`);
  }

  const envelope = JSON.parse(fs.readFileSync(signaturePath, "utf8"));
  const valid = verify(
    null,
    manifestBytes,
    publicKey,
    Buffer.from(envelope.signatureBase64, "base64"),
  );
  if (!valid || envelope.keyId !== "test-key") {
    throw new Error("Generated release signature did not verify");
  }
  console.log("release manifest signing smoke: OK");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
