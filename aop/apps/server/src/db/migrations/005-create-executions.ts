import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const createExecutionsMigration: Migration = {
  name: "005-create-executions",
  up: async (db: Kysely<Database>) => {
    await sql`
      CREATE TYPE execution_status AS ENUM ('running', 'completed', 'failed', 'aborted')
    `.execute(db);

    await sql`
      CREATE TABLE executions (
        id VARCHAR(255) PRIMARY KEY,
        client_id VARCHAR(255) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        task_id VARCHAR(255) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        workflow_id VARCHAR(255) NOT NULL REFERENCES workflows(id),
        status execution_status NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_executions_client_id ON executions (client_id)
    `.execute(db);

    await sql`
      CREATE INDEX idx_executions_task_id ON executions (task_id)
    `.execute(db);

    await sql`
      CREATE INDEX idx_executions_status ON executions (status)
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`DROP TABLE IF EXISTS executions`.execute(db);
    await sql`DROP TYPE IF EXISTS execution_status`.execute(db);
  },
};
