import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const addIterationTrackingMigration: Migration = {
  name: "012-add-iteration-tracking",
  up: async (db: Kysely<Database>) => {
    await sql`
      ALTER TABLE executions
      ADD COLUMN iteration INTEGER NOT NULL DEFAULT 0
    `.execute(db);

    await sql`
      ALTER TABLE executions
      ADD COLUMN visited_steps TEXT NOT NULL DEFAULT '[]'
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`ALTER TABLE executions DROP COLUMN IF EXISTS visited_steps`.execute(db);
    await sql`ALTER TABLE executions DROP COLUMN IF EXISTS iteration`.execute(db);
  },
};
