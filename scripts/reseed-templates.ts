/**
 * Re-run template seeding against a data directory, without restarting the app.
 *
 * `seedTemplates()` runs at boot, and the Next dev server hot-reloads code without re-running
 * instrumentation — so a seed edit looks as though it never landed until the Local App is
 * restarted. Nothing about the function needs boot: API routes already call it.
 *
 *   npm run reseed                              # against $SIGNALS_DATA_DIR (default ~/.signals)
 *   SIGNALS_DATA_DIR=/tmp/copy npm run reseed   # rehearse on a copy first
 *
 * Seeding is idempotent and updates in place, so running it against a live install is safe. It
 * does not migrate: an existing install is already migrated, and a script that quietly ran
 * migrations against whatever `SIGNALS_DATA_DIR` pointed at is the mistake `seed:demo` documents.
 */

// `client.ts` applies migrations on import through `require("./migrate")`, a CJS require of a
// TypeScript module that vite-node cannot resolve; `VITEST` is the only flag that skips it. Set
// before the dynamic import below, exactly as scripts/seed-demo-data.ts does.
process.env.VITEST = "true";

// Top-level await needs this file to be a module, and every import here is dynamic by design.
export {};

const dataDir = process.env.SIGNALS_DATA_DIR ?? "~/.signals";

const { sqlite } = await import("@/lib/db/client");
const { seedTemplates } = await import("@/lib/db/seed-templates");

function seedVersion(): string {
  const row = sqlite
    .prepare(
      `SELECT json_extract(config, '$._seedVersion') AS version
         FROM workflow_templates WHERE is_system = 1 LIMIT 1`,
    )
    .get() as { version?: unknown } | undefined;
  return String(row?.version ?? "none");
}

const before = seedVersion();
const result = seedTemplates();

process.stdout.write(
  `[reseed] ${dataDir}: seedVersion ${before} -> ${seedVersion()}, ` +
    `${result.seeded} seeded, ${result.updated} updated\n`,
);
