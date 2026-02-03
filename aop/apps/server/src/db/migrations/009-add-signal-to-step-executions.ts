import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const addSignalToStepExecutionsMigration: Migration = {
  name: "009-add-signal-to-step-executions",
  up: async (db: Kysely<Database>) => {
    await sql`
      ALTER TABLE step_executions
      ADD COLUMN signal VARCHAR(255)
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`
      ALTER TABLE step_executions
      DROP COLUMN signal
    `.execute(db);
  },
};
