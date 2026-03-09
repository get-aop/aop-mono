import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const createReposMigration: Migration = {
  name: "003-create-repos",
  up: async (db: Kysely<Database>) => {
    await sql`
      CREATE TABLE repos (
        id VARCHAR(255) PRIMARY KEY,
        client_id VARCHAR(255) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        synced_at TIMESTAMPTZ NOT NULL
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_repos_client_id ON repos (client_id)
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`DROP TABLE IF EXISTS repos`.execute(db);
  },
};
