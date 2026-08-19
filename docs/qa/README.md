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

## CI data directory

GitHub Actions sets `SIGNALS_DATA_DIR` to `${{ github.workspace }}/.ci/signals-data` so boot and migrations stay inside the workspace.
