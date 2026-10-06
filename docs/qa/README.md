# Signals QA

## Quality gate (required before merge)

Run the full gate locally:

```bash
npm run check
```

`npm run gate` is an alias for the same command.

The gate runs, in order:

1. **Typecheck** — `tsc --noEmit`
2. **Lint** — `eslint . --max-warnings 0` (ESLint CLI; Next.js 16 removed `next lint`)
3. **Unit tests + coverage** — `vitest run --coverage` (80% line threshold on core `src/lib` modules; see `vitest.config.ts`)
4. **Migrations** — `drizzle-kit migrate` (ensures schema before production build)
5. **Production build** — `next build`

CI also runs **`verify:fresh-import`** and **`test:integration`** in the same
quality job, reusing the production build produced by `npm run check`. See
[smoke-tests.md](./smoke-tests.md).

Pull requests run the fast quality workflow in `.github/workflows/pr-ci.yml`.
Publishable versions repeat the full gate before release in
`.github/workflows/release.yml`.

## Individual commands

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint only |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run test` | Vitest watch mode (development) |
| `npm run test:run` | Vitest single run (no coverage) |
| `npm run test:coverage` | Vitest with coverage thresholds (CI gate) |
| `npm run test:integration` | Integration smoke tests (Vitest + production server; see [smoke-tests.md](./smoke-tests.md)) |
| Local App bootstrap | See [local-app.md](./local-app.md) |
| `npm run doctor` | React Doctor advisory scan (not part of gate) |

## Isolated RealTimeX Local App QA

Never repoint the canonical **Signals** Local App, and never create QA apps on the installed
RealTimeX app. Run the checkout under test as its own **Signals Dev** app on the RealTimeX Dev host
(#541, [`specs/signals-dev-local-app.md`](../../specs/signals-dev-local-app.md)):

```bash
QA=/Users/realtimex/github/signals/scripts/qa/qa-local-app.mjs
node "$QA" up --cli <wrapper> --issue 356 --loop-id loop-issue-356-example
node "$QA" down     # before the QA handoff: stop + port, Dev-host, and installed-app checks
node "$QA" remove   # at loop close
```

`up` creates `Signals Dev · <slot>` through the supported `realtimex-pp-cli` Local Apps API on
`3101`, pins its port (3300–3499), data (`~/.signals-dev/<slot>`), and workspace
(`signals-dev-<slot>`), and runs it with `SIGNALS_INSTANCE=dev`, so Signals refuses to publish, send,
or connect accounts. Its receipt lives in `~/.signals-dev/<slot>/.launcher/receipt.json`. `down`
keeps the app and its permission grants for the next round; `remove` deletes both. Every command
refuses the canonical app and any app that lost its slot tags.

`scripts/qa/verify-signals-local-app-hygiene.mjs` exposes the same checks for loop gates:
`--dev-db` (no Dev app points at `~/.signals` or pins `3010`) and `--packaged-db [--snapshot]` (the
installed app's canonical record keeps its shape; nothing was added or changed since `up`).

`scripts/qa/provision-signals-local-app.mjs --restore-canonical` only undoes the slice-1 migration
(`scripts/qa/migrate-dev-signals-row.mjs`); it is not a QA provisioner.

## CI data directory

GitHub Actions sets `SIGNALS_DATA_DIR` to `${{ github.workspace }}/.ci/signals-data` so boot and migrations stay inside the workspace.
