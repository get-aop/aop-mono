import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const seedTestClientMigration: Migration = {
  name: "007-seed-test-client",
  up: async (db: Kysely<Database>) => {
    await sql`
      INSERT INTO clients (id, api_key, max_concurrent_tasks)
      VALUES ('client_test_dev', 'aop_test_key_dev', 5)
      ON CONFLICT (id) DO NOTHING
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`
      DELETE FROM clients WHERE id = 'client_test_dev'
    `.execute(db);
  },
};
