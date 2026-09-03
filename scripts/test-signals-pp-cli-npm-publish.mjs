#!/usr/bin/env node
/**
 * Pin the resume rule for `publish:signals-pp-cli-npm`.
 *
 * v0.2.8 published every npm package and then lost the artifact upload to an
 * ECONNRESET, so the GitHub Release never happened — and the re-run died on npm's
 * 403 for republishing the same version. The only escape was another version
 * bump. These assertions exist so that stays fixed: an exact version already on
 * the registry is skipped, and nothing else is.
 */
import assert from "node:assert/strict";
import { publishedVersionExists } from "./publish-signals-pp-cli-npm.mjs";

function runner(stdout, status = 0) {
  return () => ({ status, stdout });
}

function main() {
  assert.equal(
    publishedVersionExists("@realtimex/signals-pp-cli", "0.2.8", runner("0.2.8\n")),
    true,
    "an exact version echoed back is already published",
  );

  assert.equal(
    publishedVersionExists("@realtimex/signals-pp-cli", "0.2.9", runner("0.2.8\n")),
    false,
    "a different version on the registry must not suppress the publish",
  );

  // `npm view` exits non-zero for both an unknown package and an unknown
  // version. Neither may be read as "already there".
  assert.equal(
    publishedVersionExists("@realtimex/signals-pp-cli-win32-x64", "0.2.8", runner("", 1)),
    false,
    "a package missing from the registry is not published",
  );

  // A registry outage looks like a non-zero exit too, and must fail loudly at
  // the publish step rather than silently skipping a real release.
  assert.equal(
    publishedVersionExists("@realtimex/signals-pp-cli", "0.2.8", runner("network error", 1)),
    false,
    "a failed lookup never counts as published",
  );

  assert.equal(
    publishedVersionExists("@realtimex/signals-pp-cli", "0.2.8", runner("  0.2.8  ")),
    true,
    "surrounding whitespace from npm view is tolerated",
  );

  console.log("ok: signals-pp-cli npm publish skips only exact already-published versions");
}

main();
