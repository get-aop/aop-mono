import type { Kysely } from "kysely";
import type {
  Database,
  NewStepExecution,
  StepExecution,
  StepExecutionUpdate,
} from "../db/schema.ts";

export interface StepExecutionRepository {
  create: (stepExecution: NewStepExecution) => Promise<StepExecution>;
  update: (id: string, update: StepExecutionUpdate) => Promise<StepExecution | null>;
  findById: (id: string) => Promise<StepExecution | null>;
  findByIdForUpdate: (id: string) => Promise<StepExecution | null>;
  cancelRunningByExecution: (executionId: string) => Promise<number>;
}

export const createStepExecutionRepository = (db: Kysely<Database>): StepExecutionRepository => ({
  create: async (stepExecution: NewStepExecution): Promise<StepExecution> => {
    return db
      .insertInto("step_executions")
      .values(stepExecution)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  update: async (id: string, update: StepExecutionUpdate): Promise<StepExecution | null> => {
    const updated = await db
      .updateTable("step_executions")
      .set(update)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return updated ?? null;
  },

  findById: async (id: string): Promise<StepExecution | null> => {
    const stepExecution = await db
      .selectFrom("step_executions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return stepExecution ?? null;
  },

  findByIdForUpdate: async (id: string): Promise<StepExecution | null> => {
    const stepExecution = await db
      .selectFrom("step_executions")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    return stepExecution ?? null;
  },

  cancelRunningByExecution: async (executionId: string): Promise<number> => {
    const result = await db
      .updateTable("step_executions")
      .set({ status: "cancelled", ended_at: new Date() })
      .where("execution_id", "=", executionId)
      .where("status", "=", "running")
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0);
  },
});
