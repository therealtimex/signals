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
];

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      include: COVERAGE_INCLUDE,
      exclude: ["**/*.test.ts"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 48,
        statements: 80,
      },
    },
  },
});
