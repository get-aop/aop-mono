import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const createClientsMigration: Migration = {
  name: "001-create-clients",
  up: async (db: Kysely<Database>) => {
    await sql`
      CREATE TABLE clients (
        id VARCHAR(255) PRIMARY KEY,
        api_key VARCHAR(255) NOT NULL UNIQUE,
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 5,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_clients_api_key ON clients (api_key)
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`DROP TABLE IF EXISTS clients`.execute(db);
  },
};
