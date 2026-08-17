# RealtimeX marketplace plugin (Signals)

Package and distribute Signals through the **RealtimeX marketplace** — not public npm.

**Platform dependency:** [RealtimeX #1614](https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/issues/1614) (marketplace install orchestration for bundled local apps).

## What ships

| Artifact | Path | Purpose |
|----------|------|---------|
| Plugin zip | `dist/com.realtimex.signals-plugin.zip` | Workspace provision, skills, flows, config |
| Standalone zip | `dist/signals-{version}-standalone.zip` | Local App runtime (`node server.js`) |
| Release manifest | `marketplace/release-manifest.json` | Version coupling + sha256 checksum |

Plugin id: `com.realtimex.signals`  
Local app id: `47e45f71-3279-42f5-8e95-731de01b6eae`

## Build

```bash
npm run verify:marketplace-versions

# Standalone Local App artifact first (populates release-manifest checksum)
npm run build:standalone-artifact

# Plugin pack (installs signals-publish skill deps, runs validate-plugin.cjs)
npm run package:realtimex-plugin
npm run test:plugin-package
```

## CI / GitHub Releases

| Workflow | When | What |
|----------|------|------|
| `.github/workflows/ci.yml` | PR + `main` | App quality gate + Playwright smoke |
| `.github/workflows/plugin-release.yml` | PR + `main` | Standalone zip, plugin zip, `test:plugin-package` |
| `.github/workflows/plugin-release.yml` (`release` job) | Push tag `v*` | Same build + GitHub Release with plugin zip, standalone zip, `release-manifest.json` |

Before tagging, bump `package.json` and `realtimex.plugin.json` to the same version, then:

```bash
git tag v0.1.10
git push origin v0.1.10
```

Marketplace store upload remains manual until RealtimeX #1614 provides publisher automation.

Source layout: `realtimex-plugin/` (manifest, templates, marketplace specs). Skills are copied from `.claude/skills/` at package time. The `signals-publish` skill's `x-publish.cjs` delegates to the host **`agent-browser` CLI** (locked external skill); the plugin zip contains **no** `node_modules`. Source `SKILL.md` paths stay under `.claude/skills/`; packaging rewrites them to `skills/` in the zip.

Plugin validation uses `scripts/vendor/validate-plugin.cjs` (override with `REALTIMEX_PLUGIN_VALIDATOR`). Packaging fails if the validator is missing.

## Local dev install (before #1614 automation)

1. **Plugin:** RTX Admin → Plugins → Upload `dist/com.realtimex.signals-plugin.zip`, enable, configure, **Deploy** workspace provision.
2. **Verify provision (QA):** `node scripts/qa/verify-signals-plugin-provision.mjs` (after Deploy). Deploy is UI-only today — not on `realtimex-pp-cli`.
3. **Publish QA (no public post):** `x-publish.cjs --dry-run` after `signals-publish` browser session is on an `https://x.com` tab.
4. **Local app (dev fallback):** `node scripts/qa/provision-signals-local-app.mjs` or register manually with `marketplace/local-app.manifest.json` after extracting standalone zip.
5. **Flows:** Import `flows/*.agent-flow.json` from the plugin zip via Admin → Agent Flows (until platform auto-import lands).
6. Start Signals from **Settings → Local Apps**, open provisioned workspace terminal agent.

## Production path (after #1614)

1. User purchases bundled marketplace SKU.
2. Platform extracts plugin zip + standalone artifact, registers local app, links entitlement.
3. User enables plugin → deploy workspace → start Local App (post-purchase wizard).

## Publisher checklist

1. Bump `package.json` version (plugin `realtimex.plugin.json` version should match).
2. `npm run build:standalone-artifact`
3. `npm run package:realtimex-plugin`
4. Upload plugin zip + standalone zip + `marketplace/release-manifest.json` to marketplace store bundle.
5. Verify `checksumSha256` matches `dist/signals-*-standalone.zip`.

## Permissions

Declared in `rtx-manifest.json` and `realtimex-plugin/marketplace/local-app.manifest.json`:

- `credentials.list`, `credentials.use`, `webhook.trigger`
- `llm.embed`, `llm.chat`
- `desktop.browser`, `desktop.runtime-sessions`

## Related docs

- [`realtimex-local-app.md`](./realtimex-local-app.md) — architecture
- [`local-app.md`](./local-app.md) — startup contract (embedded vs standalone dev)
- [`flows/README.md`](../flows/README.md) — Agent Flow import
