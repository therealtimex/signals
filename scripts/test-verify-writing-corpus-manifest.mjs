#!/usr/bin/env node
/**
 * Regression: the writing-corpus manifest validator must pass on the committed manifest and must
 * fail on drift (a skill missing from the manifest, a dangling reference without a disposition,
 * a vendor assumption without a replacement, an un-namespaced formula id).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/verify-writing-corpus-manifest.mjs");
const manifestPath = path.join(root, "docs-dev/refs/manifest.json");

function runValidator(args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

function expectFailure(label, mutate) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  mutate(manifest);
  const tmp = path.join(os.tmpdir(), `writing-corpus-manifest-${process.pid}-${label}.json`);
  fs.writeFileSync(tmp, JSON.stringify(manifest));
  try {
    const result = runValidator(["--manifest", tmp]);
    if (result.status === 0) {
      console.error(`expected validator to fail for "${label}" but it passed:\n${result.stdout}`);
      process.exit(1);
    }
    if (!/error\(s\)/.test(result.stderr)) {
      console.error(`unexpected validator output for "${label}":\n${result.stderr}`);
      process.exit(1);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const ok = runValidator([]);
if (ok.status !== 0) {
  console.error("committed manifest failed validation:", ok.stdout, ok.stderr);
  process.exit(1);
}
if (!/writing-corpus manifest: OK \(63 skills, 177 files/.test(ok.stdout)) {
  console.error("unexpected summary line:", ok.stdout);
  process.exit(1);
}

expectFailure("missing-skill", (m) => m.skills.splice(0, 1));
expectFailure("missing-ref-disposition", (m) => {
  const entry = m.skills.find((s) => s.missingReferences.length > 0);
  entry.missingReferences[0].disposition = null;
});
expectFailure("vendor-without-replacement", (m) => {
  const entry = m.skills.find((s) => s.vendorAssumptions.length > 0);
  entry.vendorAssumptions[0].replacement = "";
});
expectFailure("unnamespaced-formula", (m) => {
  const entry = m.skills.find((s) => (s.formulaMap ?? []).some((f) => f.adoptedAs));
  entry.formulaMap.find((f) => f.adoptedAs).adoptedAs = "X1";
});
expectFailure("cleared-license-without-declaration", (m) => {
  m.families[0].redistribution = "cleared";
});
expectFailure("file-drift", (m) => m.skills[0].files.push("references/does-not-exist.md"));

console.log("verify-writing-corpus-manifest smoke: OK");
