import { defineConfig } from "drizzle-kit";
import { join } from "path";
import { homedir } from "os";

const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: join(dataDir, "data.db"),
  },
});
