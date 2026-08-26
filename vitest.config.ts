import { defineConfig } from "vitest/config";
import path from "path";

const COVERAGE_INCLUDE = [
  "src/lib/auth/crypto.ts",
  "src/lib/agents/router.ts",
  "src/lib/platforms/x/mappers.ts",
  "src/lib/platforms/linkedin/mappers.ts",
  "src/lib/workflows/format-error.ts",
  "src/lib/db/queries/contacts.ts",
  "src/lib/db/queries/goals.ts",
  "src/lib/rtx/env.ts",
  "src/lib/rtx/sdk.ts",
  "src/lib/rtx/bootstrap.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    setupFiles: ["./src/test/setup-env.ts", "./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: COVERAGE_INCLUDE,
      exclude: ["**/*.test.ts", "**/*.latency.test.ts"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 48,
        statements: 80,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // Fixture-heavy suites (300-contact profile-pipeline builds) run 1-2s uninstrumented and
          // several times that under coverage, which trips Vitest's 5s default on slower runners.
          testTimeout: 20_000,
          include: ["src/**/*.test.ts"],
          exclude: [
            "**/node_modules/**",
            "**/e2e/**",
            "src/**/*.latency.test.ts",
            "src/**/*.contract.test.ts",
            "src/**/*.import-safety.test.ts",
            "src/**/*.embedded.test.ts",
            "src/**/*.integration.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          // Contract probes assert against a *sibling repo's* runtime code, so no
          // default invocation may depend on whether that checkout exists or what
          // state it is in. `--project` is not enough: a bare `vitest run` executes
          // every configured project, so the include itself is gated on an explicit
          // opt-in. Without it this project matches nothing.
          name: "contract",
          include:
            process.env.SIGNALS_CONTRACT_PROBES === "1"
              ? ["src/**/*.contract.test.ts"]
              : [],
          exclude: ["**/node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "latency",
          include: ["src/**/*.latency.test.ts"],
          exclude: ["**/node_modules/**"],
          pool: "forks",
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
        },
      },
      {
        extends: true,
        test: {
          name: "import-safety",
          setupFiles: [],
          include: ["src/**/*.import-safety.test.ts"],
          exclude: ["**/node_modules/**"],
          pool: "forks",
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
        },
      },
      {
        extends: true,
        test: {
          name: "embedded",
          include: ["src/**/*.embedded.test.ts"],
          exclude: ["**/node_modules/**"],
          pool: "forks",
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          exclude: ["**/node_modules/**"],
          setupFiles: ["./src/test/integration/setup-env.ts"],
          globalSetup: ["./scripts/integration-global-setup.mjs"],
          pool: "forks",
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
