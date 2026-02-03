import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database, NewTask, Task, TaskUpdate } from "../db/schema.ts";
import type { TaskStatus } from "./types.ts";

export interface ListFilters {
  status?: TaskStatus;
  repo_id?: string;
  orderByReadyAt?: "asc" | "desc";
}

export interface ConcurrencyLimits {
  globalMax: number;
  getRepoMax: (repoId: string) => Promise<number>;
}

export interface TaskRepository {
  create: (task: NewTask) => Promise<Task>;
  createIdempotent: (task: NewTask) => Promise<Task | null>;
  get: (id: string) => Promise<Task | null>;
  getByChangePath: (repoId: string, changePath: string) => Promise<Task | null>;
  update: (id: string, updates: TaskUpdate) => Promise<Task | null>;
  markRemoved: (id: string) => Promise<boolean>;
  list: (filters?: ListFilters) => Promise<Task[]>;
  countWorking: (repoId?: string) => Promise<number>;
  getNextExecutable: (limits: ConcurrencyLimits) => Promise<Task | null>;
}

export const createTaskRepository = (db: Kysely<Database>): TaskRepository => ({
  create: async (task: NewTask): Promise<Task> => {
    return db.insertInto("tasks").values(task).returningAll().executeTakeFirstOrThrow();
  },

  createIdempotent: async (task: NewTask): Promise<Task | null> => {
    const result = await db
      .insertInto("tasks")
      .values(task)
      .onConflict((oc) =>
        oc.columns(["repo_id", "change_path"]).doUpdateSet({ repo_id: task.repo_id }),
      )
      .returningAll()
      .executeTakeFirst();
    return result ?? null;
  },

  get: async (id: string): Promise<Task | null> => {
    const task = await db.selectFrom("tasks").selectAll().where("id", "=", id).executeTakeFirst();
    return task ?? null;
  },

  getByChangePath: async (repoId: string, changePath: string): Promise<Task | null> => {
    const task = await db
      .selectFrom("tasks")
      .selectAll()
      .where("repo_id", "=", repoId)
      .where("change_path", "=", changePath)
      .executeTakeFirst();
    return task ?? null;
  },

  update: async (id: string, updates: TaskUpdate): Promise<Task | null> => {
    const existing = await db
      .selectFrom("tasks")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();

    if (!existing) {
      return null;
    }

    await db
      .updateTable("tasks")
      .set({
        ...updates,
        updated_at: sql`datetime('now')`,
      })
      .where("id", "=", id)
      .execute();

    return db.selectFrom("tasks").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  },

  markRemoved: async (id: string): Promise<boolean> => {
    const existing = await db
      .selectFrom("tasks")
      .select(["id", "status"])
      .where("id", "=", id)
      .executeTakeFirst();

    if (!existing || existing.status === "WORKING") {
      return false;
    }

    await db
      .updateTable("tasks")
      .set({
        status: "REMOVED",
        updated_at: sql`datetime('now')`,
      })
      .where("id", "=", id)
      .where("status", "!=", "WORKING")
      .execute();

    return true;
  },

  list: async (filters?: ListFilters): Promise<Task[]> => {
    let query = db.selectFrom("tasks").selectAll();

    if (filters?.status) {
      query = query.where("status", "=", filters.status);
    }
    if (filters?.repo_id) {
      query = query.where("repo_id", "=", filters.repo_id);
    }
    if (filters?.orderByReadyAt) {
      query = query.orderBy("ready_at", filters.orderByReadyAt);
    }

    return query.execute();
  },

  countWorking: async (repoId?: string): Promise<number> => {
    let query = db
      .selectFrom("tasks")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("status", "=", "WORKING");

    if (repoId) {
      query = query.where("repo_id", "=", repoId);
    }

    const result = await query.executeTakeFirstOrThrow();
    return result.count;
  },

  getNextExecutable: async (limits: ConcurrencyLimits): Promise<Task | null> => {
    const globalWorking = await db
      .selectFrom("tasks")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("status", "=", "WORKING")
      .executeTakeFirstOrThrow();

    if (globalWorking.count >= limits.globalMax) {
      return null;
    }

    const readyTasks = await db
      .selectFrom("tasks")
      .selectAll()
      .where("status", "=", "READY")
      .orderBy("ready_at", "asc")
      .execute();

    for (const task of readyTasks) {
      const repoWorking = await db
        .selectFrom("tasks")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("status", "=", "WORKING")
        .where("repo_id", "=", task.repo_id)
        .executeTakeFirstOrThrow();

      const repoMax = await limits.getRepoMax(task.repo_id);

      if (repoWorking.count < repoMax) {
        return task;
      }
    }

    return null;
  },
});
