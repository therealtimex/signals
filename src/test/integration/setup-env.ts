import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const metaPath = join(process.cwd(), ".ci", "integration-server.json");

if (!existsSync(metaPath)) {
  throw new Error(
    "Missing .ci/integration-server.json — run npm run test:integration (requires globalSetup and a prior npm run build)"
  );
}

const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { baseURL: string };
process.env.SMOKE_BASE_URL = meta.baseURL;
