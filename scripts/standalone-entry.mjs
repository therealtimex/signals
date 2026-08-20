import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));
process.env.SIGNALS_MIGRATIONS_DIR ??= path.join(
  runtimeRoot,
  "resources",
  "migrations",
);

await import("./next-server.js");
