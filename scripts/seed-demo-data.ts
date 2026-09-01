/**
 * Seed a disposable Signals database with fictional demo data.
 *
 * Intended use is capturing the user-guide screenshots without publishing a real
 * CRM — see `scripts/app-automation/flows/capture-guide-assets.mjs`:
 *
 *   SIGNALS_DATA_DIR=/tmp/signals-demo npm run seed:demo
 *   SIGNALS_DATA_DIR=/tmp/signals-demo npm run dev
 *   npm run automation:capture-guide-assets -- --base-url http://127.0.0.1:3000
 *
 * Run through vite-node so `@/` resolves, matching
 * `scripts/qa/run-persona-agent-job-smoke.sh`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { checkDemoSeedTarget } from "@/lib/db/demo-seed-guard";

async function main(): Promise<void> {
  const json = process.argv.includes("--json");

  // Strictly before importing the seeder: importing it imports the db client,
  // which opens and migrates whatever `SIGNALS_DATA_DIR` currently points at.
  const verdict = checkDemoSeedTarget();
  if (!verdict.ok) {
    if (json) process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
    process.stderr.write(`${verdict.message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`${verdict.message}\n`);

  // Migrate from *inside* the guard, never before it. Chaining `npm run
  // db:migrate` ahead of this script in the package script meant drizzle-kit ran
  // against whatever SIGNALS_DATA_DIR pointed at — including the default — and
  // applied pending migrations to a real CRM before the refusal was ever
  // printed. The guard is worth nothing if something mutates the database ahead
  // of it.
  mkdirSync(verdict.dataDir!, { recursive: true });
  execFileSync("npx", ["drizzle-kit", "migrate"], {
    stdio: "inherit",
    env: { ...process.env, SIGNALS_DATA_DIR: verdict.dataDir! },
  });

  // `client.ts` applies migrations on import via `require("./migrate")`, a CJS
  // require of a TypeScript module that vite-node cannot resolve. The only flag
  // that skips it is `VITEST`, which gates nothing else outside the client
  // (`runner.ts` keys on VITEST_WORKER_ID/POOL_ID, not this). Migrations are run
  // ahead of us by the `seed:demo` script, so skipping here is correct rather
  // than merely convenient.
  process.env.VITEST = "true";

  const { seedDemoData } = await import("@/lib/db/seed-demo");
  const summary = seedDemoData();

  const result = { ok: true, dataDir: verdict.dataDir, ...summary };
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const [key, value] of Object.entries(summary)) {
      process.stdout.write(`${key.padEnd(18)} ${value}\n`);
    }
  }
}

await main();
