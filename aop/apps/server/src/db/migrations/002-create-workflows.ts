import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const createWorkflowsMigration: Migration = {
  name: "002-create-workflows",
  up: async (db: Kysely<Database>) => {
    await sql`
      CREATE TABLE workflows (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        definition JSONB NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_workflows_name ON workflows (name)
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`DROP TABLE IF EXISTS workflows`.execute(db);
  },
};
