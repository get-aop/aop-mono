import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const addPauseContextMigration: Migration = {
  name: "013-add-pause-context",
  up: async (db: Kysely<Database>) => {
    await sql`ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'PAUSED' BEFORE 'BLOCKED'`.execute(db);
    await sql`ALTER TYPE step_status ADD VALUE IF NOT EXISTS 'awaiting_input'`.execute(db);
    await sql`
      ALTER TABLE step_executions
      ADD COLUMN pause_context TEXT
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`ALTER TABLE step_executions DROP COLUMN IF EXISTS pause_context`.execute(db);
  },
};
