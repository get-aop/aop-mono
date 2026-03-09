import type { Kysely } from "kysely";
import type { Database, Execution, ExecutionUpdate, NewExecution } from "../db/schema.ts";

export interface ExecutionRepository {
  create: (execution: NewExecution) => Promise<Execution>;
  update: (id: string, update: ExecutionUpdate) => Promise<Execution | null>;
  findActiveByTask: (taskId: string) => Promise<Execution | null>;
  findById: (id: string) => Promise<Execution | null>;
  findLatestByTask: (taskId: string) => Promise<Execution | null>;
  cancelActiveByTask: (taskId: string) => Promise<Execution | null>;
}

export const createExecutionRepository = (db: Kysely<Database>): ExecutionRepository => ({
  create: async (execution: NewExecution): Promise<Execution> => {
    return db.insertInto("executions").values(execution).returningAll().executeTakeFirstOrThrow();
  },

  update: async (id: string, update: ExecutionUpdate): Promise<Execution | null> => {
    const updated = await db
      .updateTable("executions")
      .set(update)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return updated ?? null;
  },

  findActiveByTask: async (taskId: string): Promise<Execution | null> => {
    const execution = await db
      .selectFrom("executions")
      .selectAll()
      .where("task_id", "=", taskId)
      .where("status", "=", "running")
      .executeTakeFirst();
    return execution ?? null;
  },

  findById: async (id: string): Promise<Execution | null> => {
    const execution = await db
      .selectFrom("executions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return execution ?? null;
  },

  findLatestByTask: async (taskId: string): Promise<Execution | null> => {
    const execution = await db
      .selectFrom("executions")
      .selectAll()
      .where("task_id", "=", taskId)
      .orderBy("started_at", "desc")
      .limit(1)
      .executeTakeFirst();
    return execution ?? null;
  },

  cancelActiveByTask: async (taskId: string): Promise<Execution | null> => {
    const active = await db
      .selectFrom("executions")
      .selectAll()
      .where("task_id", "=", taskId)
      .where("status", "=", "running")
      .executeTakeFirst();

    if (!active) {
      return null;
    }

    const cancelled = await db
      .updateTable("executions")
      .set({ status: "cancelled", completed_at: new Date() })
      .where("id", "=", active.id)
      .returningAll()
      .executeTakeFirst();

    return cancelled ?? null;
  },
});
