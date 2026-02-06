import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database, NewTask, Task, TaskUpdate } from "../db/schema.ts";
import type { TaskEventEmitter } from "../events/task-events.ts";
import { toSSETask } from "../status/handlers.ts";
import type { TaskStatus } from "./types.ts";

export interface ListFilters {
  status?: TaskStatus;
  repo_id?: string;
  orderByReadyAt?: "asc" | "desc";
  excludeRemoved?: boolean;
}

export interface TaskMetrics {
  total: number;
  byStatus: Record<TaskStatus, number>;
  successRate: number;
  avgDurationMs: number;
  avgFailedDurationMs: number;
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
  resetStaleWorkingTasks: () => Promise<number>;
  getMetrics: (repoId?: string) => Promise<TaskMetrics>;
}

export interface TaskRepositoryOptions {
  eventEmitter?: TaskEventEmitter;
}

export const createTaskRepository = (
  db: Kysely<Database>,
  options: TaskRepositoryOptions = {},
): TaskRepository => {
  const { eventEmitter } = options;

  const getLatestExecution = async (taskId: string) => {
    const execution = await db
      .selectFrom("executions")
      .selectAll()
      .where("task_id", "=", taskId)
      .orderBy("started_at", "desc")
      .limit(1)
      .executeTakeFirst();
    return execution ?? null;
  };

  const emitTaskCreated = (task: Task): void => {
    eventEmitter?.emit({ type: "task-created", task: toSSETask(task) });
  };

  const emitStatusChanged = async (task: Task, previousStatus: TaskStatus): Promise<void> => {
    if (task.status !== previousStatus) {
      const execution = await getLatestExecution(task.id);
      eventEmitter?.emit({
        type: "task-status-changed",
        taskId: task.id,
        previousStatus,
        newStatus: task.status as TaskStatus,
        task: toSSETask(task, execution),
      });
    }
  };

  const emitTaskRemoved = async (task: Task): Promise<void> => {
    const execution = await getLatestExecution(task.id);
    eventEmitter?.emit({ type: "task-removed", taskId: task.id, task: toSSETask(task, execution) });
  };

  return {
    create: async (task: NewTask): Promise<Task> => {
      const created = await db
        .insertInto("tasks")
        .values(task)
        .returningAll()
        .executeTakeFirstOrThrow();
      emitTaskCreated(created);
      return created;
    },

    createIdempotent: async (task: NewTask): Promise<Task | null> => {
      const existing = await db
        .selectFrom("tasks")
        .selectAll()
        .where("repo_id", "=", task.repo_id)
        .where("change_path", "=", task.change_path)
        .executeTakeFirst();

      if (existing) {
        return existing;
      }

      const result = await db
        .insertInto("tasks")
        .values(task)
        .onConflict((oc) =>
          oc.columns(["repo_id", "change_path"]).doUpdateSet({ repo_id: task.repo_id }),
        )
        .returningAll()
        .executeTakeFirst();

      if (result) {
        emitTaskCreated(result);
      }
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
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      if (!existing) {
        return null;
      }

      const previousStatus = existing.status as TaskStatus;

      await db
        .updateTable("tasks")
        .set({
          ...updates,
          updated_at: sql`datetime('now')`,
        })
        .where("id", "=", id)
        .execute();

      const updated = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      if (updates.status) {
        await emitStatusChanged(updated, previousStatus);
      }

      return updated;
    },

    markRemoved: async (id: string): Promise<boolean> => {
      const existing = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      if (!existing || existing.status === "WORKING") {
        return false;
      }

      const previousStatus = existing.status as TaskStatus;

      await db
        .updateTable("tasks")
        .set({
          status: "REMOVED",
          updated_at: sql`datetime('now')`,
        })
        .where("id", "=", id)
        .where("status", "!=", "WORKING")
        .execute();

      const updated = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      await emitStatusChanged(updated, previousStatus);
      await emitTaskRemoved(updated);

      return true;
    },

    list: async (filters?: ListFilters): Promise<Task[]> => {
      let query = db.selectFrom("tasks").selectAll();

      if (filters?.status) {
        query = query.where("status", "=", filters.status);
      }
      if (filters?.excludeRemoved) {
        query = query.where("status", "!=", "REMOVED");
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

      // Join with repos to exclude orphaned tasks whose repo was deleted
      const readyTasks = await db
        .selectFrom("tasks")
        .innerJoin("repos", "tasks.repo_id", "repos.id")
        .selectAll("tasks")
        .where("tasks.status", "=", "READY")
        .orderBy("tasks.ready_at", "asc")
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

    resetStaleWorkingTasks: async (): Promise<number> => {
      const workingTasks = await db
        .selectFrom("tasks")
        .selectAll()
        .where("status", "=", "WORKING")
        .execute();

      if (workingTasks.length === 0) {
        return 0;
      }

      await db
        .updateTable("tasks")
        .set({
          status: "READY",
          updated_at: sql`datetime('now')`,
        })
        .where("status", "=", "WORKING")
        .execute();

      for (const task of workingTasks) {
        const updated = await db
          .selectFrom("tasks")
          .selectAll()
          .where("id", "=", task.id)
          .executeTakeFirstOrThrow();
        await emitStatusChanged(updated, "WORKING");
      }

      return workingTasks.length;
    },

    getMetrics: async (repoId?: string): Promise<TaskMetrics> => {
      let baseQuery = db.selectFrom("tasks");
      if (repoId) {
        baseQuery = baseQuery.where("repo_id", "=", repoId);
      }

      const tasks = await baseQuery.selectAll().execute();

      const byStatus: Record<TaskStatus, number> = {
        DRAFT: 0,
        READY: 0,
        WORKING: 0,
        BLOCKED: 0,
        DONE: 0,
        REMOVED: 0,
      };

      for (const task of tasks) {
        byStatus[task.status as TaskStatus]++;
      }

      const total = tasks.length;
      const doneCount = byStatus.DONE;
      const blockedCount = byStatus.BLOCKED;
      const successRate = doneCount + blockedCount > 0 ? doneCount / (doneCount + blockedCount) : 0;

      let completedDurationQuery = db
        .selectFrom("executions")
        .innerJoin("tasks", "tasks.id", "executions.task_id")
        .select(
          sql<number>`AVG((julianday(executions.completed_at) - julianday(executions.started_at)) * 86400000)`.as(
            "avg_duration",
          ),
        )
        .where("executions.status", "=", "completed");

      let failedDurationQuery = db
        .selectFrom("executions")
        .innerJoin("tasks", "tasks.id", "executions.task_id")
        .select(
          sql<number>`AVG((julianday(executions.completed_at) - julianday(executions.started_at)) * 86400000)`.as(
            "avg_duration",
          ),
        )
        .where("executions.status", "=", "failed");

      if (repoId) {
        completedDurationQuery = completedDurationQuery.where("tasks.repo_id", "=", repoId);
        failedDurationQuery = failedDurationQuery.where("tasks.repo_id", "=", repoId);
      }

      const completedDuration = await completedDurationQuery.executeTakeFirst();
      const failedDuration = await failedDurationQuery.executeTakeFirst();

      return {
        total,
        byStatus,
        successRate,
        avgDurationMs: completedDuration?.avg_duration ?? 0,
        avgFailedDurationMs: failedDuration?.avg_duration ?? 0,
      };
    },
  };
};
