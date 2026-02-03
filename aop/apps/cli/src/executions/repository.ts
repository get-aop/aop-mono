import type { Kysely } from "kysely";
import type {
  Database,
  Execution,
  ExecutionUpdate,
  NewExecution,
  NewStepExecution,
  StepExecution,
  StepExecutionUpdate,
} from "../db/schema.ts";

export interface ExecutionRepository {
  createExecution: (execution: NewExecution) => Promise<Execution>;
  getExecution: (id: string) => Promise<Execution | null>;
  updateExecution: (id: string, updates: ExecutionUpdate) => Promise<Execution | null>;
  getExecutionsByTaskId: (taskId: string) => Promise<Execution[]>;

  createStepExecution: (step: NewStepExecution) => Promise<StepExecution>;
  getStepExecution: (id: string) => Promise<StepExecution | null>;
  updateStepExecution: (id: string, updates: StepExecutionUpdate) => Promise<StepExecution | null>;
  getStepExecutionsByExecutionId: (executionId: string) => Promise<StepExecution[]>;
  getLatestStepExecution: (taskId: string) => Promise<StepExecution | null>;
}

export const createExecutionRepository = (db: Kysely<Database>): ExecutionRepository => ({
  createExecution: async (execution: NewExecution): Promise<Execution> => {
    await db.insertInto("executions").values(execution).execute();
    return db
      .selectFrom("executions")
      .selectAll()
      .where("id", "=", execution.id)
      .executeTakeFirstOrThrow();
  },

  getExecution: async (id: string): Promise<Execution | null> => {
    const execution = await db
      .selectFrom("executions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return execution ?? null;
  },

  updateExecution: async (id: string, updates: ExecutionUpdate): Promise<Execution | null> => {
    const existing = await db
      .selectFrom("executions")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();

    if (!existing) {
      return null;
    }

    await db.updateTable("executions").set(updates).where("id", "=", id).execute();

    return db.selectFrom("executions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  },

  getExecutionsByTaskId: async (taskId: string): Promise<Execution[]> => {
    return db
      .selectFrom("executions")
      .selectAll()
      .where("task_id", "=", taskId)
      .orderBy("started_at", "desc")
      .execute();
  },

  createStepExecution: async (step: NewStepExecution): Promise<StepExecution> => {
    await db.insertInto("step_executions").values(step).execute();
    return db
      .selectFrom("step_executions")
      .selectAll()
      .where("id", "=", step.id)
      .executeTakeFirstOrThrow();
  },

  getStepExecution: async (id: string): Promise<StepExecution | null> => {
    const step = await db
      .selectFrom("step_executions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return step ?? null;
  },

  updateStepExecution: async (
    id: string,
    updates: StepExecutionUpdate,
  ): Promise<StepExecution | null> => {
    const existing = await db
      .selectFrom("step_executions")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();

    if (!existing) {
      return null;
    }

    await db.updateTable("step_executions").set(updates).where("id", "=", id).execute();

    return db
      .selectFrom("step_executions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  },

  getStepExecutionsByExecutionId: async (executionId: string): Promise<StepExecution[]> => {
    return db
      .selectFrom("step_executions")
      .selectAll()
      .where("execution_id", "=", executionId)
      .orderBy("started_at", "asc")
      .execute();
  },

  getLatestStepExecution: async (taskId: string): Promise<StepExecution | null> => {
    const step = await db
      .selectFrom("step_executions")
      .innerJoin("executions", "executions.id", "step_executions.execution_id")
      .selectAll("step_executions")
      .where("executions.task_id", "=", taskId)
      .orderBy("step_executions.started_at", "desc")
      .limit(1)
      .executeTakeFirst();
    return step ?? null;
  },
});
