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
          include: ["src/**/*.test.ts"],
          exclude: [
            "**/node_modules/**",
            "**/e2e/**",
            "src/**/*.latency.test.ts",
            "src/**/*.import-safety.test.ts",
            "src/**/*.embedded.test.ts",
          ],
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
    ],
  },
});
