import { join } from "node:path";
import { AOP_URLS } from "@aop/common";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { parseWorkflowYaml } from "../workflow/yaml-parser.ts";
import { createDatabase, runMigrations } from "./connection.ts";
import type { Database } from "./schema.ts";

const WORKFLOWS_DIR = join(import.meta.dir, "../../workflows");

export const createTestDb = async (): Promise<Kysely<Database>> => {
  const db = createDatabase(AOP_URLS.DATABASE_TEST);
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
      signals: [
        { name: "TASK_COMPLETE", description: "task is fully complete" },
        { name: "NEEDS_REVIEW", description: "implementation is ready for review" },
      ],
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

const PAUSED_WORKFLOW_DEFINITION = {
  version: 1,
  name: "paused-test",
  initialStep: "plan",
  steps: {
    plan: {
      id: "plan",
      type: "iterate",
      promptTemplate: "plan-implementation.md.hbs",
      maxAttempts: 1,
      signals: [
        { name: "PLAN_READY", description: "plan is ready for implementation" },
        { name: "REQUIRES_INPUT", description: "needs user input to proceed" },
      ],
      transitions: [
        { condition: "PLAN_READY", target: "implement" },
        { condition: "REQUIRES_INPUT", target: "__paused__" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
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
  terminalStates: ["__done__", "__blocked__", "__paused__"],
};

export const createPausedWorkflow = async (
  db: Kysely<Database>,
): Promise<{ id: string; name: string }> => {
  const id = "workflow_paused_test";
  const name = "paused-test";

  await db
    .insertInto("workflows")
    .values({
      id,
      name,
      definition: JSON.stringify(PAUSED_WORKFLOW_DEFINITION),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  return { id, name };
};

const REVIEW_WORKFLOW_DEFINITION = {
  version: 1,
  name: "review-test",
  initialStep: "plan",
  steps: {
    plan: {
      id: "plan",
      type: "iterate",
      promptTemplate: "plan-implementation.md.hbs",
      maxAttempts: 1,
      signals: [
        { name: "PLAN_READY", description: "plan is ready for review" },
        { name: "PLAN_APPROVED", description: "plan approved, proceed" },
        { name: "REQUIRES_INPUT", description: "needs user input" },
      ],
      transitions: [
        { condition: "PLAN_READY", target: "__paused__" },
        { condition: "PLAN_APPROVED", target: "implement" },
        { condition: "REQUIRES_INPUT", target: "__paused__" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
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
  terminalStates: ["__done__", "__blocked__", "__paused__"],
};

export const createReviewWorkflow = async (
  db: Kysely<Database>,
): Promise<{ id: string; name: string }> => {
  const id = "workflow_review_test";
  const name = "review-test";

  await db
    .insertInto("workflows")
    .values({
      id,
      name,
      definition: JSON.stringify(REVIEW_WORKFLOW_DEFINITION),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  return { id, name };
};

const loadWorkflowYaml = async (filename: string) => {
  const content = await Bun.file(join(WORKFLOWS_DIR, filename)).text();
  return parseWorkflowYaml(content);
};

export const createAopDefaultWorkflow = async (
  db: Kysely<Database>,
): Promise<{ id: string; name: string }> => {
  const workflow = await loadWorkflowYaml("aop-default.yaml");
  const id = "workflow_aop_default";

  await db
    .insertInto("workflows")
    .values({
      id,
      name: workflow.name,
      definition: JSON.stringify(workflow),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  return { id, name: workflow.name };
};
