import type { Kysely } from "kysely";
import type {
  Database,
  Execution,
  ExecutionUpdate,
  NewExecution,
  NewStepExecution,
  NewStepLog,
  StepExecution,
  StepExecutionUpdate,
  StepLog,
} from "../db/schema.ts";

export interface ExecutionRepository {
  createExecution: (execution: NewExecution) => Promise<Execution>;
  getExecution: (id: string) => Promise<Execution | null>;
  updateExecution: (id: string, updates: ExecutionUpdate) => Promise<Execution | null>;
  getExecutionsByTaskId: (taskId: string) => Promise<Execution[]>;
  cancelRunningExecutions: () => Promise<number>;

  createStepExecution: (step: NewStepExecution) => Promise<StepExecution>;
  getStepExecution: (id: string) => Promise<StepExecution | null>;
  updateStepExecution: (id: string, updates: StepExecutionUpdate) => Promise<StepExecution | null>;
  getStepExecutionsByExecutionId: (executionId: string) => Promise<StepExecution[]>;
  getLatestStepExecution: (taskId: string) => Promise<StepExecution | null>;
  cancelRunningStepExecutions: () => Promise<number>;
  getRunningStepExecutions: () => Promise<(StepExecution & { task_id: string })[]>;

  saveStepLogs: (logs: NewStepLog[]) => Promise<void>;
  getStepLogs: (stepExecutionId: string) => Promise<StepLog[]>;
  getStepLogCount: (stepExecutionId: string) => Promise<number>;
  getStepLogsByExecutionId: (executionId: string) => Promise<StepLog[]>;
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

  cancelRunningExecutions: async (): Promise<number> => {
    const running = await db
      .selectFrom("executions")
      .select("id")
      .where("status", "=", "running")
      .execute();

    if (running.length === 0) {
      return 0;
    }

    await db
      .updateTable("executions")
      .set({ status: "cancelled", completed_at: new Date().toISOString() })
      .where("status", "=", "running")
      .execute();

    return running.length;
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

  cancelRunningStepExecutions: async (): Promise<number> => {
    const running = await db
      .selectFrom("step_executions")
      .select("id")
      .where("status", "=", "running")
      .execute();

    if (running.length === 0) {
      return 0;
    }

    await db
      .updateTable("step_executions")
      .set({ status: "cancelled", ended_at: new Date().toISOString() })
      .where("status", "=", "running")
      .execute();

    return running.length;
  },

  getRunningStepExecutions: async (): Promise<(StepExecution & { task_id: string })[]> => {
    return db
      .selectFrom("step_executions")
      .innerJoin("executions", "executions.id", "step_executions.execution_id")
      .selectAll("step_executions")
      .select("executions.task_id")
      .where("step_executions.status", "=", "running")
      .execute();
  },

  saveStepLogs: async (logs: NewStepLog[]): Promise<void> => {
    if (logs.length === 0) return;
    await db.insertInto("step_logs").values(logs).execute();
  },

  getStepLogs: async (stepExecutionId: string): Promise<StepLog[]> => {
    return db
      .selectFrom("step_logs")
      .selectAll()
      .where("step_execution_id", "=", stepExecutionId)
      .orderBy("id", "asc")
      .execute();
  },

  getStepLogCount: async (stepExecutionId: string): Promise<number> => {
    const result = await db
      .selectFrom("step_logs")
      .select(db.fn.countAll<number>().as("count"))
      .where("step_execution_id", "=", stepExecutionId)
      .executeTakeFirstOrThrow();
    return Number(result.count);
  },

  getStepLogsByExecutionId: async (executionId: string): Promise<StepLog[]> => {
    return db
      .selectFrom("step_logs")
      .innerJoin("step_executions", "step_logs.step_execution_id", "step_executions.id")
      .selectAll("step_logs")
      .where("step_executions.execution_id", "=", executionId)
      .orderBy("step_logs.id", "asc")
      .execute();
  },
});
