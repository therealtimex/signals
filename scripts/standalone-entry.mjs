import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSignalsNodeRuntime } from "./runtime-contract.mjs";

const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));
assertSignalsNodeRuntime({ label: "Signals standalone runtime" });
process.env.SIGNALS_MIGRATIONS_DIR ??= path.join(
  runtimeRoot,
  "resources",
  "migrations",
);

await import("./next-server.js");
