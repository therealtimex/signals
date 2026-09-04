# RealtimeX marketplace plugin (Signals)

Package and distribute Signals through the **RealtimeX marketplace** — not public npm.

**Platform dependency:** [RealtimeX #1614](https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/issues/1614) (marketplace install orchestration for target-specific local apps).

## What ships

| Artifact | Path | Purpose |
|----------|------|---------|
| Plugin zip | `dist/com.realtimex.signals-plugin.zip` | Workspace provision, skills, flows, config |
| Target runtime | `dist/signals-{version}-{platform}-{arch}.tar.gz` | Compiled Local App runtime for one native target |
| Release manifest | `marketplace/release-manifest.json` | Generated v2 platform map, runtime contract, sizes, and SHA-256 digests |
| Signature envelope | `marketplace/release-manifest.sig.json` | Generated detached Ed25519 signature over the exact release-manifest bytes |

Plugin id: `com.realtimex.signals`  
Local app id: `47e45f71-3279-42f5-8e95-731de01b6eae`

Version 0.2.12 fills the avatar cache on its own. A scheduled sweep works through contacts that
still lack a locally stored avatar, doing avatar work only — so it keeps running when profile
hydration or persona generation are unavailable, which previously stalled the whole pass. Contacts
whose photo comes from a platform CDN are taken first, since those hosts are unmetered and the
public avatar resolver is capped at roughly fifty requests a day; the sweep stands down for a while
once that resolver starts refusing, rather than spending the remaining allowance to no effect.
`signals-writing` stays at 1.1.0.

## Build

Dependency installation, release builds, and smoke tests require exact Node `22.16.0` (module ABI `127`), matching the RealtimeX plugin host. The installed runtime hard-fails on ABI mismatch but warns and continues on compatible Node 22 patch drift. This prevents native dependencies such as `better-sqlite3` from being published for the wrong ABI without making an otherwise compatible host patch a startup blocker.

The release manifest and signature are generated release outputs and are not tracked. A native artifact build creates a one-target manifest; release CI merges all six target manifests before signing and packaging.

```bash
nvm use
npm run verify:node-runtime
npm run verify:marketplace-versions

# Builds the current native target and a one-target release manifest.
npm run build:standalone-artifact
npm run test:standalone-artifact

# Plugin pack (installs signals-publish skill deps, runs validate-plugin.cjs)
npm run package:realtimex-plugin
npm run test:plugin-package
```

## CI / GitHub Releases

| Workflow | When | What |
|----------|------|------|
| `.github/workflows/pr-ci.yml` | Pull request | React Doctor, Node/runtime contract verification, app quality gate, fresh-import verification, and integration smoke |
| `.github/workflows/release.yml` | Push to `main` or tag `v*` | For a new version, repeat every gate, build all native targets, sign and package the Marketplace bundle, then publish |

**Release on merge (recommended):** bump `package.json` and `realtimex-plugin/realtimex.plugin.json` to the same version in your PR. After merge to `main`, the release plan checks whether that version already exists. New versions repeat React Doctor, the consolidated quality and integration gate, all native runtime tests, and Marketplace package validation before publishing. Existing versions stop after the release plan, so docs-only or CI-only merges do not spend time rebuilding artifacts.

Each target archive is a production-runtime allowlist: compiled Next.js output, traced runtime dependencies, public and guide assets, and database migration data. CI rejects raw application source, tests, coverage reports, build scripts, source maps, and nested archives, then boots the extracted artifact against a fresh database on the same operating system and architecture.

Pull requests do not build Marketplace artifacts. Publishable `main` and tag releases build and smoke-test `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`, and `win32-arm64`, then merge their target manifests. This target set maps 1:1 to the host packages published by `realtimex-sdk`. The marketplace selects exactly one artifact using `${process.platform}-${process.arch}`.

Release pushes require these repository settings:

- Secret `SIGNALS_RELEASE_SIGNING_PRIVATE_KEY_B64`: base64-encoded Ed25519 PKCS#8 PEM private key.
- Variable `SIGNALS_RELEASE_SIGNING_KEY_ID`: identifier for the corresponding public key pinned by the marketplace.

The private key never ships. RealtimeX must verify `release-manifest.sig.json` against its pinned publisher public key before parsing the manifest, then verify the selected artifact's SHA-256 before extraction.

One-time publisher setup (store the private file outside the repository):

```bash
openssl genpkey -algorithm Ed25519 -out signals-release-private.pem
openssl pkey -in signals-release-private.pem -pubout -out signals-release-public.pem
base64 < signals-release-private.pem | tr -d '\n' | gh secret set SIGNALS_RELEASE_SIGNING_PRIVATE_KEY_B64
gh variable set SIGNALS_RELEASE_SIGNING_KEY_ID --body signals-2026-01
```

Give `signals-release-public.pem` and the matching key id to the marketplace trust-store owner. Rotate by adding the new public key before changing the repository secret and key-id variable.

**Manual tag (optional):** pushing `vX.Y.Z` still triggers the same `release` job when the tag matches `package.json` and the release does not already exist.

```bash
# Optional manual path (same outcome as merge when version already bumped)
git tag v0.1.10
git push origin v0.1.10
```

Gate logic: `scripts/ci/should-publish-marketplace-release.mjs` (`--main` or `--tag=vX.Y.Z`).

Marketplace store upload remains manual until RealtimeX #1614 provides publisher automation.

Source layout: `realtimex-plugin/` (manifest, templates, marketplace specs). Three skills are copied from `.claude/skills/` at package time: `realtimex-signals`, `signals-writing`, and `signals-publish`. Signals Writing ships one zero-dependency CJS helper; its development reference corpus under `docs-dev/refs` is never packaged. The `signals-publish` skill's `x-publish.cjs` delegates to the host **`agent-browser` CLI** (locked external skill); the plugin zip contains **no** `node_modules`. Source `SKILL.md` paths stay under `.claude/skills/`; packaging rewrites them to `skills/` in the zip.

### 0.2.4 Personality migration

- Plugin 0.2.3 keeps `signals-writing` 1.0.0 in the legacy-unbound compatibility lane. Upgrading to
  0.2.4 activates the Personality-aware 1.1.0 gate; unbound workspaces can create only labelled,
  targetless, unaudited sketches until a binding is approved.
- Workspace provisioning manages `AGENTS.md`. Redeploying 0.2.4 can remove an older binding's
  dynamic Personality index span and temporarily report `drifted` / `index_pointer_missing`.
  Recover by approving one new Personality projection. The new static pointer is unmanaged and
  prevents later proposals from adding another dynamic index block.
- Existing variants without Personality lineage stay `legacy_unbound` and retain their original
  audit hashes; the upgrade does not backfill or revoke them.

Plugin validation uses `scripts/vendor/validate-plugin.cjs` (override with `REALTIMEX_PLUGIN_VALIDATOR`). Packaging fails if the validator is missing.

## Local dev install (before #1614 automation)

1. **Plugin:** RTX Admin → Plugins → Upload `dist/com.realtimex.signals-plugin.zip`, enable, configure, **Deploy** workspace provision.
2. **Verify provision (QA):** `node scripts/qa/verify-signals-plugin-provision.mjs` (after Deploy). Set `STORAGE_DIR` to the RealtimeX storage root when checking deployed skill files. Deploy is UI-only today — not on `realtimex-pp-cli`.
   - Confirms installed plugin id/version matches repo `package.json`
   - When workspace is deployed, compares deployed `x-publish.cjs` sha256 to repo source
3. **Publish QA (no public post):** `x-publish.cjs --dry-run` after `signals-publish` browser session is on an `https://x.com` tab.
4. **Local app (dev fallback):** register the private source checkout through **Settings → Local
   Apps**. If the existing canonical dev record is corrupted, recover it explicitly with
   `node scripts/qa/provision-signals-local-app.mjs --restore-canonical`; normal issue QA uses
   `scripts/qa/provision-signals-qa-local-app.mjs`. Use `npm run test:standalone-artifact` for
   extracted-archive QA.
5. **Flows:** Import `flows/*.agent-flow.json` from the plugin zip via Admin → Agent Flows (until platform auto-import lands).
6. Start Signals from **Settings → Local Apps**, open provisioned workspace terminal agent.

## Production path (after #1614)

1. User purchases bundled marketplace SKU.
2. Platform verifies the publisher signature, selects the host target, verifies its digest, extracts that runtime, registers the local app, and links entitlement.
3. User enables plugin → deploy workspace → start Local App (post-purchase wizard).

## Publisher checklist

1. Bump `package.json` version (plugin `realtimex.plugin.json` version should match).
2. Let gated release CI build and boot every supported target.
3. Confirm CI merged `marketplace/release-manifest.json` with all six target keys.
4. Confirm `marketplace/release-manifest.sig.json` verifies with the pinned publisher key.
5. Upload the plugin zip, six target archives, release manifest, and signature envelope.
6. Confirm the marketplace downloads only the artifact matching the installing host.

## Permissions

Declared in `rtx-manifest.json` and `realtimex-plugin/marketplace/local-app.manifest.json`:

- `credentials.list`, `credentials.use`, `webhook.trigger`
- `llm.embed`, `llm.chat`
- `desktop.browser`, `desktop.runtime-sessions`

## Related docs

- [`realtimex-local-app.md`](./realtimex-local-app.md) — architecture
- [`local-app.md`](./local-app.md) — startup contract (embedded vs standalone dev)
- [`flows/README.md`](../flows/README.md) — Agent Flow import
