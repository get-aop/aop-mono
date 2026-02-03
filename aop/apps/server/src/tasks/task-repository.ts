import type { Kysely } from "kysely";
import type { Database, NewTask, Task, TaskUpdate } from "../db/schema.ts";

export interface TaskRepository {
  findById: (id: string) => Promise<Task | null>;
  upsert: (task: NewTask) => Promise<Task>;
  update: (id: string, update: TaskUpdate) => Promise<Task | null>;
  countWorkingByClient: (clientId: string) => Promise<number>;
}

export const createTaskRepository = (db: Kysely<Database>): TaskRepository => ({
  findById: async (id: string): Promise<Task | null> => {
    const task = await db.selectFrom("tasks").selectAll().where("id", "=", id).executeTakeFirst();
    return task ?? null;
  },

  upsert: async (task: NewTask): Promise<Task> => {
    return db
      .insertInto("tasks")
      .values(task)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          status: task.status,
          synced_at: task.synced_at,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  update: async (id: string, update: TaskUpdate): Promise<Task | null> => {
    const updated = await db
      .updateTable("tasks")
      .set(update)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return updated ?? null;
  },

  countWorkingByClient: async (clientId: string): Promise<number> => {
    const result = await db
      .selectFrom("tasks")
      .select((eb) => eb.fn.count<number>("id").as("count"))
      .where("client_id", "=", clientId)
      .where("status", "=", "WORKING")
      .executeTakeFirstOrThrow();
    return Number(result.count);
  },
});
