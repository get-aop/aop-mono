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

const withNull = <T>(value: T | null | undefined): T | null => value ?? null;

const toStepExecutionRecord = (step: NewStepExecution): StepExecution => {
  return {
    ...step,
    step_id: withNull(step.step_id),
    step_type: withNull(step.step_type),
    agent_pid: withNull(step.agent_pid),
    session_id: withNull(step.session_id),
    exit_code: withNull(step.exit_code),
    signal: withNull(step.signal),
    pause_context: withNull(step.pause_context),
    error: withNull(step.error),
    attempt: withNull(step.attempt),
    iteration: withNull(step.iteration),
    signals_json: withNull(step.signals_json),
    ended_at: withNull(step.ended_at),
  };
};

export interface ExecutionRepository {
  createExecution: (execution: NewExecution) => Promise<Execution>;
  getExecution: (id: string) => Promise<Execution | null>;
  updateExecution: (id: string, updates: ExecutionUpdate) => Promise<Execution | null>;
  getExecutionsByTaskId: (taskId: string) => Promise<Execution[]>;
  getLatestExecutionByTaskId: (taskId: string) => Promise<Execution | null>;
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

export const createExecutionRepository = (db: Kysely<Database>): ExecutionRepository => {
  const createExecutionRecord = async (execution: NewExecution): Promise<Execution> => {
    const record: Execution = {
      ...execution,
      workflow_id: execution.workflow_id ?? "aop-default",
      visited_steps: execution.visited_steps ?? "[]",
      iteration: execution.iteration ?? 0,
      completed_at: execution.completed_at ?? null,
    };
    await db.insertInto("executions").values(record).execute();
    return record;
  };

  return {
    createExecution: createExecutionRecord,

    getExecution: async (id: string): Promise<Execution | null> =>
      (await db.selectFrom("executions").selectAll().where("id", "=", id).executeTakeFirst()) ?? null,

    updateExecution: async (id: string, updates: ExecutionUpdate): Promise<Execution | null> => {
      const existing = await db
        .selectFrom("executions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      await db.updateTable("executions").set(updates).where("id", "=", id).execute();
      return updated;
    },

    getExecutionsByTaskId: async (taskId: string): Promise<Execution[]> =>
      db
        .selectFrom("executions")
        .selectAll()
        .where("task_id", "=", taskId)
        .orderBy("started_at", "desc")
        .execute(),

    getLatestExecutionByTaskId: async (taskId: string): Promise<Execution | null> =>
      (await db
        .selectFrom("executions")
        .selectAll()
        .where("task_id", "=", taskId)
        .orderBy("started_at", "desc")
        .executeTakeFirst()) ?? null,

    cancelRunningExecutions: async (): Promise<number> => {
      const running = await db
        .selectFrom("executions")
        .select("id")
        .where("status", "=", "running")
        .execute();
      const now = new Date().toISOString();
      for (const execution of running) {
        await db
          .updateTable("executions")
          .set({ status: "cancelled", completed_at: now })
          .where("id", "=", execution.id)
          .execute();
      }
      return running.length;
    },

    createStepExecution: async (step: NewStepExecution): Promise<StepExecution> => {
      const record = toStepExecutionRecord(step);
      await db.insertInto("step_executions").values(record).execute();
      return record;
    },

    getStepExecution: async (id: string): Promise<StepExecution | null> =>
      (await db
        .selectFrom("step_executions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst()) ?? null,

    updateStepExecution: async (
      id: string,
      updates: StepExecutionUpdate,
    ): Promise<StepExecution | null> => {
      const existing = await db
        .selectFrom("step_executions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      await db.updateTable("step_executions").set(updates).where("id", "=", id).execute();
      return updated;
    },

    getStepExecutionsByExecutionId: async (executionId: string): Promise<StepExecution[]> =>
      db
        .selectFrom("step_executions")
        .selectAll()
        .where("execution_id", "=", executionId)
        .orderBy("started_at", "asc")
        .execute(),

    getLatestStepExecution: async (taskId: string): Promise<StepExecution | null> => {
      return (
        (await db
          .selectFrom("step_executions")
          .innerJoin("executions", "executions.id", "step_executions.execution_id")
          .selectAll("step_executions")
          .where("executions.task_id", "=", taskId)
          .orderBy("step_executions.started_at", "desc")
          .executeTakeFirst()) ?? null
      );
    },

    cancelRunningStepExecutions: async (): Promise<number> => {
      const running = await db
        .selectFrom("step_executions")
        .select("id")
        .where("status", "=", "running")
        .execute();
      const now = new Date().toISOString();
      for (const step of running) {
        await db
          .updateTable("step_executions")
          .set({ status: "cancelled", ended_at: now })
          .where("id", "=", step.id)
          .execute();
      }
      return running.length;
    },

    getRunningStepExecutions: async (): Promise<(StepExecution & { task_id: string })[]> => {
      return db
        .selectFrom("step_executions")
        .innerJoin("executions", "executions.id", "step_executions.execution_id")
        .select([
          "step_executions.id",
          "step_executions.execution_id",
          "step_executions.step_id",
          "step_executions.step_type",
          "step_executions.agent_pid",
          "step_executions.session_id",
          "step_executions.status",
          "step_executions.exit_code",
          "step_executions.signal",
          "step_executions.pause_context",
          "step_executions.error",
          "step_executions.attempt",
          "step_executions.iteration",
          "step_executions.signals_json",
          "step_executions.started_at",
          "step_executions.ended_at",
          "executions.task_id as task_id",
        ])
        .where("step_executions.status", "=", "running")
        .execute() as Promise<(StepExecution & { task_id: string })[]>;
    },

    saveStepLogs: async (entries: NewStepLog[]): Promise<void> => {
      if (entries.length === 0) {
        return;
      }
      await db.insertInto("step_logs").values(entries).execute();
    },

    getStepLogs: async (stepExecutionId: string): Promise<StepLog[]> =>
      db
        .selectFrom("step_logs")
        .selectAll()
        .where("step_execution_id", "=", stepExecutionId)
        .orderBy("id", "asc")
        .execute(),

    getStepLogCount: async (stepExecutionId: string): Promise<number> =>
      Number(
        (
          await db
            .selectFrom("step_logs")
            .select((eb) => eb.fn.count("id").as("count"))
            .where("step_execution_id", "=", stepExecutionId)
            .executeTakeFirst()
        )?.count ?? 0,
      ),

    getStepLogsByExecutionId: async (executionId: string): Promise<StepLog[]> => {
      return db
        .selectFrom("step_logs")
        .innerJoin("step_executions", "step_executions.id", "step_logs.step_execution_id")
        .selectAll("step_logs")
        .where("step_executions.execution_id", "=", executionId)
        .orderBy("step_executions.started_at", "asc")
        .orderBy("step_logs.id", "asc")
        .execute();
    },
  };
};
