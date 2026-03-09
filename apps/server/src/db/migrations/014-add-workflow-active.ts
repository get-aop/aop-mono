import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const addWorkflowActiveMigration: Migration = {
  name: "014-add-workflow-active",
  up: async (db: Kysely<Database>) => {
    await sql`ALTER TABLE workflows ADD COLUMN active BOOLEAN NOT NULL DEFAULT true`.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`ALTER TABLE workflows DROP COLUMN active`.execute(db);
  },
};
