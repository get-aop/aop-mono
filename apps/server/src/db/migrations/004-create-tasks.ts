import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const createTasksMigration: Migration = {
  name: "004-create-tasks",
  up: async (db: Kysely<Database>) => {
    await sql`
      CREATE TYPE task_status AS ENUM ('DRAFT', 'READY', 'WORKING', 'BLOCKED', 'DONE', 'REMOVED')
    `.execute(db);

    await sql`
      CREATE TABLE tasks (
        id VARCHAR(255) PRIMARY KEY,
        client_id VARCHAR(255) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        repo_id VARCHAR(255) NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        status task_status NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_tasks_client_id ON tasks (client_id)
    `.execute(db);

    await sql`
      CREATE INDEX idx_tasks_repo_id ON tasks (repo_id)
    `.execute(db);

    await sql`
      CREATE INDEX idx_tasks_status ON tasks (status)
    `.execute(db);

    await sql`
      CREATE INDEX idx_tasks_client_status ON tasks (client_id, status)
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`DROP TABLE IF EXISTS tasks`.execute(db);
    await sql`DROP TYPE IF EXISTS task_status`.execute(db);
  },
};
