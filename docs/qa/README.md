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

Never repoint the manually managed **Signals** Local App for issue QA. Create a disposable,
issue-scoped app instead:

```bash
node scripts/qa/provision-signals-qa-local-app.mjs \
  --issue 356 \
  --worktree /absolute/path/to/the/issue-worktree \
  --loop-id loop-issue-356-example
```

The command uses the supported `realtimex-pp-cli` Local Apps API, creates
`Signals issue-356 QA`, starts it with `npm run dev` in the supplied worktree, and records the
generated app id in the platform temp directory (`/private/tmp` on macOS, `/tmp` on Linux) as
`signals-qa-local-app-issue-356.json`. The app and its data are tagged and isolated from the
canonical Signals record. It targets the Dev API at `3101` by default and does not inherit an
ambient production `REALTIMEX_BASE_URL`; use `--base-url` only for a deliberate alternate Dev
runtime.

After evidence capture, teardown is mandatory:

```bash
node scripts/qa/cleanup-signals-qa-local-app.mjs --issue 356
REALTIMEX_RUNTIME=dev node scripts/qa/verify-signals-local-app-hygiene.mjs --issue 356
```

Cleanup refuses the canonical app id and any record missing the expected issue name and safety
tags. The verifier reads the authoritative dev SQLite record and fails if the canonical app uses
an ephemeral data directory/worktree command or if the issue QA record still exists.

`scripts/qa/provision-signals-local-app.mjs` is incident recovery for the canonical record, not a
QA provisioner. It requires the explicit `--restore-canonical` guard and defaults to the dev
database; a different database must be supplied explicitly with `--db` or `RTX_DB_PATH`.

## CI data directory

GitHub Actions sets `SIGNALS_DATA_DIR` to `${{ github.workspace }}/.ci/signals-data` so boot and migrations stay inside the workspace.
