import { type Kysely, sql } from "kysely";
import type { Database } from "../schema.ts";
import type { Migration } from "./index.ts";

const RALPH_LOOP_WORKFLOW_ID = "workflow_ralph_loop";

const ralphLoopWorkflowDefinition = {
  version: 1,
  name: "ralph-loop",
  initialStep: "iterate",
  steps: {
    iterate: {
      id: "iterate",
      type: "iterate",
      promptTemplate: "iterate.md.hbs",
      maxAttempts: 1,
      signals: ["TASK_COMPLETE", "NEEDS_REVIEW"],
      transitions: [
        { condition: "TASK_COMPLETE", target: "__done__" },
        { condition: "NEEDS_REVIEW", target: "review" },
        { condition: "__none__", target: "iterate" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
    review: {
      id: "review",
      type: "review",
      promptTemplate: "review.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "success", target: "__done__" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
  },
  terminalStates: ["__done__", "__blocked__"],
};

export const seedRalphLoopWorkflowMigration: Migration = {
  name: "010-seed-ralph-loop-workflow",
  up: async (db: Kysely<Database>) => {
    const definition = JSON.stringify(ralphLoopWorkflowDefinition);
    await sql`
      INSERT INTO workflows (id, name, definition, version)
      VALUES (${RALPH_LOOP_WORKFLOW_ID}, 'ralph-loop', ${definition}::jsonb, 1)
      ON CONFLICT (id) DO NOTHING
    `.execute(db);
  },
  down: async (db: Kysely<Database>) => {
    await sql`
      DELETE FROM workflows WHERE id = ${RALPH_LOOP_WORKFLOW_ID}
    `.execute(db);
  },
};
