import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

export const createStepExecutionsMigration: Migration = {
  name: "006-create-step-executions",
  up: async (db: Kysely<Database>) => {
    await sql`
      CREATE TYPE step_status AS ENUM ('pending', 'running', 'success', 'failure')
    `.execute(db);

    await sql`
      CREATE TABLE step_executions (
        id VARCHAR(255) PRIMARY KEY,
        client_id VARCHAR(255) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        execution_id VARCHAR(255) NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
        step_type VARCHAR(255) NOT NULL,
        prompt_template TEXT NOT NULL,
        status step_status NOT NULL,
        error_code VARCHAR(255),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_step_executions_client_id ON step_executions (client_id)
    `.execute(db);

    await sql`
      CREATE INDEX idx_step_executions_execution_id ON step_executions (execution_id)
    `.execute(db);

    await sql`
      CREATE INDEX idx_step_executions_status ON step_executions (status)
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`DROP TABLE IF EXISTS step_executions`.execute(db);
    await sql`DROP TYPE IF EXISTS step_status`.execute(db);
  },
};
