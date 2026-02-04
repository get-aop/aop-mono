import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createTaskRepository, type TaskRepository } from "./repository.ts";

describe("task/repository", () => {
  let db: Kysely<Database>;
  let repo: TaskRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createTaskRepository(db);
    await createTestRepo(db, "repo-1", "/test/repo");
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("create", () => {
    test("creates a task", async () => {
      const now = new Date().toISOString();
      const task = await repo.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      expect(task.id).toBe("task-1");
      expect(task.repo_id).toBe("repo-1");
      expect(task.change_path).toBe("changes/feat-1");
      expect(task.status).toBe("DRAFT");
    });
  });

  describe("createIdempotent", () => {
    test("creates a new task when it does not exist", async () => {
      const now = new Date().toISOString();
      const task = await repo.createIdempotent({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns existing task when duplicate key", async () => {
      const now = new Date().toISOString();
      await repo.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      const duplicateTask = await repo.createIdempotent({
        id: "task-2",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "READY",
        created_at: now,
        updated_at: now,
      });

      expect(duplicateTask?.id).toBe("task-1");
      expect(duplicateTask?.status).toBe("DRAFT");
    });
  });

  describe("get", () => {
    test("returns task by id", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const task = await repo.get("task-1");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns null when task not found", async () => {
      const task = await repo.get("non-existent");

      expect(task).toBeNull();
    });
  });

  describe("getByChangePath", () => {
    test("returns task by repo_id and change_path", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const task = await repo.getByChangePath("repo-1", "changes/feat-1");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
      expect(task?.change_path).toBe("changes/feat-1");
    });

    test("returns null when task not found", async () => {
      const task = await repo.getByChangePath("repo-1", "non-existent");

      expect(task).toBeNull();
    });

    test("returns null when repo_id does not match", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const task = await repo.getByChangePath("other-repo", "changes/feat-1");

      expect(task).toBeNull();
    });
  });

  describe("update", () => {
    test("updates task fields", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const updated = await repo.update("task-1", { status: "READY" });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe("READY");
    });

    test("returns null when task not found", async () => {
      const updated = await repo.update("non-existent", { status: "READY" });

      expect(updated).toBeNull();
    });

    test("updates multiple fields", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const updated = await repo.update("task-1", {
        status: "WORKING",
        worktree_path: "/path/to/worktree",
      });

      expect(updated?.status).toBe("WORKING");
      expect(updated?.worktree_path).toBe("/path/to/worktree");
    });
  });

  describe("markRemoved", () => {
    test("marks task as removed", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const result = await repo.markRemoved("task-1");

      expect(result).toBe(true);

      const task = await repo.get("task-1");
      expect(task?.status).toBe("REMOVED");
    });

    test("returns false for non-existent task", async () => {
      const result = await repo.markRemoved("non-existent");

      expect(result).toBe(false);
    });

    test("returns false for WORKING task", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const result = await repo.markRemoved("task-1");

      expect(result).toBe(false);

      const task = await repo.get("task-1");
      expect(task?.status).toBe("WORKING");
    });

    test("marks READY task as removed", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const result = await repo.markRemoved("task-1");

      expect(result).toBe(true);
    });
  });

  describe("list", () => {
    test("returns all tasks without filters", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const tasks = await repo.list();

      expect(tasks).toHaveLength(2);
    });

    test("filters by status", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const tasks = await repo.list({ status: "READY" });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.status).toBe("READY");
    });

    test("excludes REMOVED tasks", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "REMOVED");

      const tasks = await repo.list({ excludeRemoved: true });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.id).toBe("task-1");
    });

    test("filters by repo_id", async () => {
      await createTestRepo(db, "repo-2", "/test/repo2");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-2", "changes/feat-2", "DRAFT");

      const tasks = await repo.list({ repo_id: "repo-1" });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.repo_id).toBe("repo-1");
    });

    test("orders by ready_at ascending", async () => {
      const now = new Date();
      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "changes/feat-1",
          status: "READY",
          ready_at: new Date(now.getTime() + 1000).toISOString(),
        })
        .execute();
      await db
        .insertInto("tasks")
        .values({
          id: "task-2",
          repo_id: "repo-1",
          change_path: "changes/feat-2",
          status: "READY",
          ready_at: new Date(now.getTime() - 1000).toISOString(),
        })
        .execute();

      const tasks = await repo.list({ orderByReadyAt: "asc" });

      expect(tasks[0]?.id).toBe("task-2");
      expect(tasks[1]?.id).toBe("task-1");
    });

    test("orders by ready_at descending", async () => {
      const now = new Date();
      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "changes/feat-1",
          status: "READY",
          ready_at: new Date(now.getTime() - 1000).toISOString(),
        })
        .execute();
      await db
        .insertInto("tasks")
        .values({
          id: "task-2",
          repo_id: "repo-1",
          change_path: "changes/feat-2",
          status: "READY",
          ready_at: new Date(now.getTime() + 1000).toISOString(),
        })
        .execute();

      const tasks = await repo.list({ orderByReadyAt: "desc" });

      expect(tasks[0]?.id).toBe("task-2");
      expect(tasks[1]?.id).toBe("task-1");
    });
  });

  describe("countWorking", () => {
    test("returns count of working tasks", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "WORKING");
      await createTestTask(db, "task-3", "repo-1", "changes/feat-3", "READY");

      const count = await repo.countWorking();

      expect(count).toBe(2);
    });

    test("returns count for specific repo", async () => {
      await createTestRepo(db, "repo-2", "/test/repo2");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await createTestTask(db, "task-2", "repo-2", "changes/feat-2", "WORKING");

      const count = await repo.countWorking("repo-1");

      expect(count).toBe(1);
    });

    test("returns 0 when no working tasks", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const count = await repo.countWorking();

      expect(count).toBe(0);
    });
  });

  describe("getNextExecutable", () => {
    test("returns first READY task when under global limit", async () => {
      const now = new Date();
      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "changes/feat-1",
          status: "READY",
          ready_at: now.toISOString(),
        })
        .execute();

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 2,
      };

      const task = await repo.getNextExecutable(limits);

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns null when global limit reached", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const limits = {
        globalMax: 1,
        getRepoMax: async () => 2,
      };

      const task = await repo.getNextExecutable(limits);

      expect(task).toBeNull();
    });

    test("returns null when no READY tasks", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 2,
      };

      const task = await repo.getNextExecutable(limits);

      expect(task).toBeNull();
    });

    test("respects repo concurrency limit", async () => {
      await createTestRepo(db, "repo-2", "/test/repo2");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const now = new Date();
      await db
        .insertInto("tasks")
        .values({
          id: "task-2",
          repo_id: "repo-1",
          change_path: "changes/feat-2",
          status: "READY",
          ready_at: new Date(now.getTime() - 1000).toISOString(),
        })
        .execute();
      await db
        .insertInto("tasks")
        .values({
          id: "task-3",
          repo_id: "repo-2",
          change_path: "changes/feat-3",
          status: "READY",
          ready_at: new Date(now.getTime() + 1000).toISOString(),
        })
        .execute();

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 1,
      };

      const task = await repo.getNextExecutable(limits);

      expect(task?.id).toBe("task-3");
    });

    test("orders READY tasks by ready_at ascending", async () => {
      const now = new Date();
      await db
        .insertInto("tasks")
        .values({
          id: "task-1",
          repo_id: "repo-1",
          change_path: "changes/feat-1",
          status: "READY",
          ready_at: new Date(now.getTime() + 1000).toISOString(),
        })
        .execute();
      await db
        .insertInto("tasks")
        .values({
          id: "task-2",
          repo_id: "repo-1",
          change_path: "changes/feat-2",
          status: "READY",
          ready_at: new Date(now.getTime() - 1000).toISOString(),
        })
        .execute();

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 2,
      };

      const task = await repo.getNextExecutable(limits);

      expect(task?.id).toBe("task-2");
    });

    test("skips repos at their limit and tries next READY task", async () => {
      await createTestRepo(db, "repo-2", "/test/repo2");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const now = new Date();
      await db
        .insertInto("tasks")
        .values({
          id: "task-2",
          repo_id: "repo-1",
          change_path: "changes/feat-2",
          status: "READY",
          ready_at: new Date(now.getTime() - 2000).toISOString(),
        })
        .execute();
      await db
        .insertInto("tasks")
        .values({
          id: "task-3",
          repo_id: "repo-2",
          change_path: "changes/feat-3",
          status: "READY",
          ready_at: new Date(now.getTime() - 1000).toISOString(),
        })
        .execute();

      const limits = {
        globalMax: 5,
        getRepoMax: async (repoId: string) => (repoId === "repo-1" ? 1 : 2),
      };

      const task = await repo.getNextExecutable(limits);

      expect(task?.id).toBe("task-3");
    });
  });

  describe("resetStaleWorkingTasks", () => {
    test("resets WORKING tasks to READY", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "WORKING");
      await createTestTask(db, "task-3", "repo-1", "changes/feat-3", "READY");

      const count = await repo.resetStaleWorkingTasks();

      expect(count).toBe(2);

      const task1 = await repo.get("task-1");
      const task2 = await repo.get("task-2");
      const task3 = await repo.get("task-3");

      expect(task1?.status).toBe("READY");
      expect(task2?.status).toBe("READY");
      expect(task3?.status).toBe("READY");
    });

    test("returns 0 when no WORKING tasks exist", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "DRAFT");

      const count = await repo.resetStaleWorkingTasks();

      expect(count).toBe(0);
    });
  });
});
