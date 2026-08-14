import { program } from "commander";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { mkdirSync, existsSync, readFileSync, unlinkSync, writeFileSync, cpSync } from "fs";
import { spawn } from "child_process";
import { createServer } from "net";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

const DEFAULT_PORT = 3000;
const DATA_DIR = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");

function resolveStartPort(requested: number): number {
  const rtxPort = process.env.RTX_PORT?.trim();
  if (rtxPort) {
    const parsed = Number.parseInt(rtxPort, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return requested;
}

function findLocalBin(name: string, fromDir: string): string {
  let dir = fromDir;
  while (dir !== dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin", name);
    if (existsSync(bin)) return bin;
    dir = dirname(dir);
  }
  return name; // fallback: rely on PATH
}

function ensureDataDir() {
  const dirs = [DATA_DIR, join(DATA_DIR, "sessions"), join(DATA_DIR, "media")];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`  Created ${dir}`);
    }
  }
}

function findAvailablePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(preferred, () => {
      server.close(() => resolve(preferred));
    });
    server.on("error", () => {
      resolve(findAvailablePort(preferred + 1));
    });
  });
}

async function startApp(port: number) {
  console.log("\n  🚀 Signals — Local-first Social GTM & Relationship Knowledge Graph\n");
  console.log(`  Version:  ${pkg.version}`);
  console.log(`  Data dir: ${DATA_DIR}`);
  if (process.env.RTX_APP_ID) {
    console.log(`  RTX mode: embedded (app id ${process.env.RTX_APP_ID})`);
  } else {
    console.log(`  RTX mode: standalone`);
  }

  // Ensure data directories exist
  ensureDataDir();

  // Run database migrations
  console.log("\n  Initializing database...");
  try {
    // Apply SQL migrations programmatically (works inside node_modules)
    const dbPath = join(DATA_DIR, "data.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    const migrationsDir = join(__dirname, "..", "src", "lib", "db", "migrations");
    migrate(db, { migrationsFolder: migrationsDir });
    sqlite.close();
    console.log("  Database ready ✓");

    // Run identity data migration (safe to call repeatedly)
    try {
      const { migrateContactIdentities } = await import("../src/lib/db/migrate-identities");
      const result = migrateContactIdentities();
      if (result.migrated > 0) {
        console.log(`  Migrated ${result.migrated} contact identities ✓`);
      }
    } catch {
      // Migration module may not be available in all contexts
    }

    // Run template user columns migration (idempotent)
    try {
      const { migrateTemplateUserColumns } = await import("../src/lib/db/migrations/add-template-user-columns");
      const migResult = migrateTemplateUserColumns();
      if (migResult.migrated) {
        console.log("  Migrated template user columns ✓");
      }
    } catch {
      // Migration module may not be available in all contexts
    }

    // Seed workflow templates (idempotent)
    try {
      const { seedTemplates } = await import("../src/lib/db/seed-templates");
      const seedResult = seedTemplates();
      if (seedResult.seeded > 0) {
        console.log(`  Seeded ${seedResult.seeded} workflow templates ✓`);
      }
    } catch {
      // Seed module may not be available in all contexts
    }
  } catch (e) {
    console.log("  Database initialization skipped (will retry on first request)");
  }

  // Find available port
  const requestedPort = resolveStartPort(port);
  const actualPort = await findAvailablePort(requestedPort);
  if (actualPort !== requestedPort) {
    console.log(`\n  Port ${requestedPort} in use, using ${actualPort}`);
  }

  // Check if Playwright Chromium browser is installed (needed for browser enrichment)
  try {
    const pwBrowsersPath = join(homedir(), ".cache", "ms-playwright");
    if (!existsSync(pwBrowsersPath)) {
      console.log("\n  Playwright browsers not found. Run `npx playwright install chromium` for browser enrichment.");
    }
  } catch {
    // Non-critical — skip silently
  }

  console.log(`\n  Starting server on http://localhost:${actualPort}...\n`);

  // Start Next.js dev server
  const appDir = join(__dirname, "..");

  // Ensure .npmrc exists for legacy-peer-deps (zod v3/v4 peer conflict)
  const npmrcPath = join(appDir, ".npmrc");
  if (!existsSync(npmrcPath)) {
    writeFileSync(npmrcPath, "legacy-peer-deps=true\n");
  }

  // When installed via npx, npm hoists dependencies above the package dir.
  // Turbopack can't resolve deps outside its project root and won't follow
  // directory symlinks. Strategy: copy source + config into the hoisted root
  // so Turbopack sees a normal project with node_modules in the same dir.
  const localNm = join(appDir, "node_modules");
  let effectiveCwd = appDir;

  if (!existsSync(join(localNm, "next", "package.json"))) {
    // Find the hoisted node_modules containing `next`
    let searchDir = dirname(appDir);
    while (searchDir !== dirname(searchDir)) {
      const candidate = join(searchDir, "node_modules", "next", "package.json");
      if (existsSync(candidate)) {
        const hoistedRoot = searchDir;

        // Copy source and config into hoisted root (fast — ~2MB of source files)
        for (const name of ["src", "public"]) {
          const dest = join(hoistedRoot, name);
          const src = join(appDir, name);
          if (!existsSync(dest) && existsSync(src)) {
            cpSync(src, dest, { recursive: true });
          }
        }
        for (const name of ["next.config.mjs", "tsconfig.json", "postcss.config.mjs", "package.json"]) {
          const dest = join(hoistedRoot, name);
          const src = join(appDir, name);
          if (!existsSync(dest) && existsSync(src)) {
            writeFileSync(dest, readFileSync(src));
          }
        }

        effectiveCwd = hoistedRoot;
        break;
      }
      searchDir = dirname(searchDir);
    }
  }

  const nextBin = findLocalBin("next", effectiveCwd);
  const child = spawn(nextBin, ["dev", "--turbopack", "--port", String(actualPort)], {
    cwd: effectiveCwd,
    stdio: "inherit",
    env: {
      ...process.env,
      SIGNALS_DATA_DIR: DATA_DIR,
      PORT: String(actualPort),
    },
  });

  // Open browser in standalone mode only (RTX shell embeds the UI).
  if (!process.env.RTX_APP_ID) {
    setTimeout(async () => {
      try {
        const open = (await import("open")).default;
        await open(`http://localhost:${actualPort}`);
      } catch {
        console.log(`  Open http://localhost:${actualPort} in your browser`);
      }
    }, 3000);
  }

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    child.kill("SIGINT");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
    process.exit(0);
  });
}

const FEATURES_HELP = `
Features:
  Contacts        Multi-platform CRM (X, LinkedIn, Gmail)
  Content         9 types: post, article, thread, reply,
                  image, video, email, dm, newsletter
  Automation      10 seed templates, 6 workflow types
                  (sync, enrich, search, prune, sequence, agent)
  AI Agents       8 tools: url-fetch, browser-scrape,
                  search-web, enrich-contact, archive-contact,
                  engage-post, save-draft, update-progress
  AI Chat         8 CRM tools, streaming, conversation history
  Analytics       5 tabs: Overview, Agents, Engagement,
                  Content, Sync Health
  Scheduling      Cron-based workflow scheduling

Getting started:
  1. Set ANTHROPIC_API_KEY in your environment
  2. Run npx @realtimex/signals (or npx signals)
  3. Connect X, LinkedIn, or Gmail in Settings > Platforms
  4. Sync contacts and run your first workflow

Data:
  Database        ~/.signals/data.db
  Config          ~/.signals/config.json
  Sessions        ~/.signals/sessions/
  Media           ~/.signals/media/

Environment variables:
  ANTHROPIC_API_KEY    Claude AI (required for agents + chat)
  SERPER_API_KEY       Serper Search (broad discovery)
  TAVILY_API_KEY       Tavily Search (deep research)
  SIGNALS_DATA_DIR     Data directory override (default: ~/.signals)
  RTX_APP_ID           RealTimeX Local App id (injected by RTX Electron)
  RTX_APP_NAME         RealTimeX Local App display name
  RTX_PORT             Preferred port when launched by RealTimeX
  SERVER_URL           RealTimeX Main App API base (inherited in RTX runtime)
`;

program
  .name("signals")
  .description("Signals — Local-first Social GTM & Relationship Knowledge Graph")
  .version(pkg.version)
  .addHelpText("after", FEATURES_HELP);

program
  .option("-p, --port <number>", "Port to start the server on", String(DEFAULT_PORT))
  .option("--reset", "Reset database (deletes all data)")
  .action(async (opts) => {
    if (opts.reset) {
      const dbPath = join(DATA_DIR, "data.db");
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
        // Also remove WAL and SHM files
        try { unlinkSync(dbPath + "-wal"); } catch {}
        try { unlinkSync(dbPath + "-shm"); } catch {}
        console.log("  Database reset ✓");
      } else {
        console.log("  No database to reset");
      }
      return;
    }

    await startApp(parseInt(opts.port, 10));
  });

program.parse();
