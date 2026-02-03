import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

const SIMPLE_WORKFLOW_ID = "workflow_simple";

const simpleWorkflowDefinition = {
  version: 1,
  name: "simple",
  initialStep: "implement",
  steps: {
    implement: {
      id: "implement",
      type: "implement",
      promptTemplate: "implement.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "success", target: "__done__" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
  },
  terminalStates: ["__done__", "__blocked__"],
};

export const seedSimpleWorkflowMigration: Migration = {
  name: "008-seed-simple-workflow",
  up: async (db: Kysely<Database>) => {
    const definition = JSON.stringify(simpleWorkflowDefinition);
    await sql`
      INSERT INTO workflows (id, name, definition, version)
      VALUES (${SIMPLE_WORKFLOW_ID}, 'simple', ${definition}::jsonb, 1)
      ON CONFLICT (id) DO NOTHING
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`
      DELETE FROM workflows WHERE id = ${SIMPLE_WORKFLOW_ID}
    `.execute(db);
  },
};
