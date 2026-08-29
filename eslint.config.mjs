import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "node_modules/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React 19 compiler rules — too strict for existing patterns; tighten in #16.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/*.test", "**/*.test.ts", "**/*.test.tsx"],
              message:
                "Import shared fixtures from src/test/*, never from another *.test file: importing a test module re-registers its suites in the importer (#370).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
