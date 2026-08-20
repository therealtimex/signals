import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSignalsNodeRuntimeCompatibility } from "./node-runtime-contract.mjs";

const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));
assertSignalsNodeRuntimeCompatibility({ label: "Signals standalone runtime" });
process.env.SIGNALS_MIGRATIONS_DIR ??= path.join(
  runtimeRoot,
  "resources",
  "migrations",
);

await import("./next-server.js");
