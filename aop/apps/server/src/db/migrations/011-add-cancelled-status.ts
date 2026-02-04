import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const addCancelledStatusMigration: Migration = {
  name: "011-add-cancelled-status",
  up: async (db: Kysely<Database>) => {
    await sql`ALTER TYPE execution_status ADD VALUE 'cancelled'`.execute(db);
    await sql`ALTER TYPE step_status ADD VALUE 'cancelled'`.execute(db);
  },
  down: async (_db: Kysely<Database>) => {
    // Note: Postgres doesn't support removing enum values directly.
    // This would require recreating the enum type and updating all columns.
    // For simplicity, this down migration is a no-op.
  },
};
