import "./setup-env";
import { runMigrations } from "@/lib/db/migrate";
import { ensureContactScalarColumns } from "@/lib/db/migrate-contact-scalars";

runMigrations(process.env.SIGNALS_DATA_DIR);
ensureContactScalarColumns();
