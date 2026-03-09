import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const addStepIdMigration: Migration = {
  name: "014-add-step-id",
  up: async (db: Kysely<Database>) => {
    await sql`
      ALTER TABLE step_executions
      ADD COLUMN step_id VARCHAR(255)
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`ALTER TABLE step_executions DROP COLUMN IF EXISTS step_id`.execute(db);
  },
};
