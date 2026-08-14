import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dataDir =
  process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ??
  join(homedir(), ".signals");

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}
