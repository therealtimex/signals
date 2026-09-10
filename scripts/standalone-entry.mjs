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
// The instrumentation hook still runs boot backfills and seeding here, but
// RealTimeX owns scheduling for installed Local Apps (#478, #7).
process.env.SIGNALS_SCHEDULER_ENABLED ??= "0";

await import("./next-server.js");
