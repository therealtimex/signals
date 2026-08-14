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

CI runs `npm run check` on every pull request and push to `main` (see `.github/workflows/ci.yml`).

## Individual commands

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint only |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run test` | Vitest watch mode (development) |
| `npm run test:run` | Vitest single run (no coverage) |
| `npm run test:coverage` | Vitest with coverage thresholds (CI gate) |
| `npm run doctor` | React Doctor advisory scan (not part of gate) |

## CI data directory

GitHub Actions sets `SIGNALS_DATA_DIR` to `${{ github.workspace }}/.ci/signals-data` so boot and migrations stay inside the workspace.
