import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "./connection.ts";
import type { Database } from "./schema.ts";

export const createTestDb = async (): Promise<Kysely<Database>> => {
  const uri = process.env.TEST_DATABASE_URL;
  if (!uri) {
    throw new Error(
      "TEST_DATABASE_URL is required. Start the database with: docker compose up -d postgres",
    );
  }
  const db = createDatabase(uri);
  await runMigrations(db);
  return db;
};

export const cleanupTestDb = async (db: Kysely<Database>): Promise<void> => {
  await sql`TRUNCATE TABLE step_executions, executions, tasks, repos, workflows, clients CASCADE`.execute(
    db,
  );
};

export const createTestClient = async (
  db: Kysely<Database>,
  overrides: {
    id?: string;
    apiKey?: string;
    maxConcurrentTasks?: number;
  } = {},
): Promise<{ id: string; apiKey: string }> => {
  const id = overrides.id ?? `client-${Date.now()}`;
  const apiKey = overrides.apiKey ?? `test-key-${Date.now()}`;

  await db
    .insertInto("clients")
    .values({
      id,
      api_key: apiKey,
      max_concurrent_tasks: overrides.maxConcurrentTasks ?? 5,
    })
    .execute();

  return { id, apiKey };
};

const SIMPLE_WORKFLOW_DEFINITION = {
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

export const createTestWorkflow = async (
  db: Kysely<Database>,
  overrides: {
    id?: string;
    name?: string;
    definition?: string;
  } = {},
): Promise<{ id: string; name: string }> => {
  const id = overrides.id ?? `workflow-${Date.now()}`;
  const name = overrides.name ?? "test-workflow";

  await db
    .insertInto("workflows")
    .values({
      id,
      name,
      definition: overrides.definition ?? JSON.stringify({ steps: [] }),
    })
    .execute();

  return { id, name };
};

export const createSimpleWorkflow = async (
  db: Kysely<Database>,
): Promise<{ id: string; name: string }> => {
  const id = "workflow_simple";
  const name = "simple";

  await db
    .insertInto("workflows")
    .values({
      id,
      name,
      definition: JSON.stringify(SIMPLE_WORKFLOW_DEFINITION),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  return { id, name };
};

const RALPH_LOOP_WORKFLOW_DEFINITION = {
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

export const createRalphLoopWorkflow = async (
  db: Kysely<Database>,
): Promise<{ id: string; name: string }> => {
  const id = "workflow_ralph_loop";
  const name = "ralph-loop";

  await db
    .insertInto("workflows")
    .values({
      id,
      name,
      definition: JSON.stringify(RALPH_LOOP_WORKFLOW_DEFINITION),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  return { id, name };
};
