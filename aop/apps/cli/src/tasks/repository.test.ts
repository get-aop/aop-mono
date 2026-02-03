import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/index.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createTaskRepository } from "./repository.ts";
import { TaskStatus } from "./types.ts";

describe("TaskRepository", () => {
  let db: Kysely<Database>;
  let repository: ReturnType<typeof createTaskRepository>;

  beforeEach(async () => {
    db = await createTestDb();
    repository = createTaskRepository(db);
    await createTestRepo(db, "repo-1", "/home/user/project");
    await createTestRepo(db, "repo-2", "/home/user/project-b");
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("create", () => {
    test("creates a new task with required fields", async () => {
      const task = await repository.create({
        id: "add-auth",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
      });

      expect(task.id).toBe("add-auth");
      expect(task.repo_id).toBe("repo-1");
      expect(task.change_path).toBe("openspec/changes/add-auth");
      expect(task.status).toBe(TaskStatus.DRAFT);
      expect(task.worktree_path).toBeNull();
      expect(task.ready_at).toBeNull();
      expect(task.created_at).toBeDefined();
      expect(task.updated_at).toBeDefined();
    });

    test("creates a task with optional fields", async () => {
      const task = await repository.create({
        id: "add-auth",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.WORKING,
        worktree_path: ".worktrees/add-auth",
        ready_at: "2024-01-15T10:00:00Z",
      });

      expect(task.worktree_path).toBe(".worktrees/add-auth");
      expect(task.ready_at).toBe("2024-01-15T10:00:00Z");
    });
  });

  describe("createIdempotent", () => {
    test("creates a new task when none exists", async () => {
      const task = await repository.createIdempotent({
        id: "add-auth",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
      });

      expect(task).not.toBeNull();
      expect(task?.id).toBe("add-auth");
      expect(task?.status).toBe(TaskStatus.DRAFT);
    });

    test("returns existing task when duplicate repo_id+change_path", async () => {
      await repository.create({
        id: "original",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.WORKING,
      });

      const task = await repository.createIdempotent({
        id: "duplicate",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
      });

      expect(task?.id).toBe("original");
      expect(task?.status).toBe(TaskStatus.WORKING);
    });

    test("does not update existing task on conflict", async () => {
      await repository.create({
        id: "original",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });

      await repository.createIdempotent({
        id: "duplicate",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
        ready_at: null,
      });

      const task = await repository.get("original");
      expect(task?.status).toBe(TaskStatus.READY);
      expect(task?.ready_at).toBe("2024-01-15T10:00:00Z");
    });
  });

  describe("get", () => {
    test("returns task by id", async () => {
      await repository.create({
        id: "add-auth",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
      });

      const task = await repository.get("add-auth");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("add-auth");
    });

    test("returns null for non-existent task", async () => {
      const task = await repository.get("non-existent");

      expect(task).toBeNull();
    });
  });

  describe("getByChangePath", () => {
    test("returns task by repo_id and change_path", async () => {
      await repository.create({
        id: "add-auth",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
      });

      const task = await repository.getByChangePath("repo-1", "openspec/changes/add-auth");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("add-auth");
    });

    test("returns null for non-existent combination", async () => {
      await repository.create({
        id: "add-auth",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
      });

      const task = await repository.getByChangePath("repo-2", "openspec/changes/add-auth");

      expect(task).toBeNull();
    });
  });

  describe("update", () => {
    test("updates task fields", async () => {
      await repository.create({
        id: "add-auth",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
      });

      const updated = await repository.update("add-auth", {
        status: TaskStatus.WORKING,
        worktree_path: ".worktrees/add-auth",
      });

      expect(updated?.status).toBe(TaskStatus.WORKING);
      expect(updated?.worktree_path).toBe(".worktrees/add-auth");
    });

    test("sets updated_at on update", async () => {
      await repository.create({
        id: "add-auth",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
      });

      const updated = await repository.update("add-auth", {
        status: TaskStatus.WORKING,
      });

      expect(updated?.updated_at).toBeDefined();
      expect(typeof updated?.updated_at).toBe("string");
    });

    test("returns null for non-existent task", async () => {
      const updated = await repository.update("non-existent", {
        status: TaskStatus.WORKING,
      });

      expect(updated).toBeNull();
    });
  });

  describe("markRemoved", () => {
    test("marks DRAFT task as REMOVED", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });

      const result = await repository.markRemoved("task-1");

      expect(result).toBe(true);
      const task = await repository.get("task-1");
      expect(task?.status).toBe(TaskStatus.REMOVED);
    });

    test("marks READY task as REMOVED", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.READY,
      });

      const result = await repository.markRemoved("task-1");

      expect(result).toBe(true);
      const task = await repository.get("task-1");
      expect(task?.status).toBe(TaskStatus.REMOVED);
    });

    test("marks BLOCKED task as REMOVED", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.BLOCKED,
      });

      const result = await repository.markRemoved("task-1");

      expect(result).toBe(true);
      const task = await repository.get("task-1");
      expect(task?.status).toBe(TaskStatus.REMOVED);
    });

    test("does not mark WORKING task as REMOVED", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.WORKING,
      });

      const result = await repository.markRemoved("task-1");

      expect(result).toBe(false);
      const task = await repository.get("task-1");
      expect(task?.status).toBe(TaskStatus.WORKING);
    });

    test("returns false for non-existent task", async () => {
      const result = await repository.markRemoved("non-existent");

      expect(result).toBe(false);
    });
  });

  describe("list", () => {
    test("returns all tasks", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });
      await repository.create({
        id: "task-2",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-2",
        status: TaskStatus.WORKING,
      });

      const tasks = await repository.list();

      expect(tasks).toHaveLength(2);
    });

    test("returns empty array when no tasks", async () => {
      const tasks = await repository.list();

      expect(tasks).toHaveLength(0);
    });

    test("filters by status", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });
      await repository.create({
        id: "task-2",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-2",
        status: TaskStatus.WORKING,
      });
      await repository.create({
        id: "task-3",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-3",
        status: TaskStatus.WORKING,
      });

      const workingTasks = await repository.list({ status: TaskStatus.WORKING });

      expect(workingTasks).toHaveLength(2);
      expect(workingTasks.every((t) => t.status === TaskStatus.WORKING)).toBe(true);
    });

    test("filters by repo_id", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });
      await repository.create({
        id: "task-2",
        repo_id: "repo-2",
        change_path: "openspec/changes/task-2",
        status: TaskStatus.DRAFT,
      });

      const tasks = await repository.list({ repo_id: "repo-1" });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.id).toBe("task-1");
    });

    test("orders by ready_at ascending for FIFO queue", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T12:00:00Z",
      });
      await repository.create({
        id: "task-2",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-2",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });
      await repository.create({
        id: "task-3",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-3",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T11:00:00Z",
      });

      const tasks = await repository.list({ status: TaskStatus.READY, orderByReadyAt: "asc" });

      expect(tasks).toHaveLength(3);
      expect(tasks[0]?.id).toBe("task-2");
      expect(tasks[1]?.id).toBe("task-3");
      expect(tasks[2]?.id).toBe("task-1");
    });
  });

  describe("countWorking", () => {
    test("returns 0 when no working tasks", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });

      const count = await repository.countWorking();

      expect(count).toBe(0);
    });

    test("returns global working count", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.WORKING,
      });
      await repository.create({
        id: "task-2",
        repo_id: "repo-2",
        change_path: "openspec/changes/task-2",
        status: TaskStatus.WORKING,
      });

      const count = await repository.countWorking();

      expect(count).toBe(2);
    });

    test("returns working count for specific repo", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.WORKING,
      });
      await repository.create({
        id: "task-2",
        repo_id: "repo-2",
        change_path: "openspec/changes/task-2",
        status: TaskStatus.WORKING,
      });

      const count = await repository.countWorking("repo-1");

      expect(count).toBe(1);
    });
  });

  describe("getNextExecutable", () => {
    const defaultLimits = {
      globalMax: 3,
      getRepoMax: async () => 2,
    };

    test("returns null when no READY tasks", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });

      const task = await repository.getNextExecutable(defaultLimits);

      expect(task).toBeNull();
    });

    test("returns first READY task by ready_at (FIFO)", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T12:00:00Z",
      });
      await repository.create({
        id: "task-2",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-2",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });

      const task = await repository.getNextExecutable(defaultLimits);

      expect(task?.id).toBe("task-2");
    });

    test("returns null when global limit reached", async () => {
      await repository.create({
        id: "work-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/work-1",
        status: TaskStatus.WORKING,
      });
      await repository.create({
        id: "work-2",
        repo_id: "repo-1",
        change_path: "openspec/changes/work-2",
        status: TaskStatus.WORKING,
      });
      await repository.create({
        id: "work-3",
        repo_id: "repo-2",
        change_path: "openspec/changes/work-3",
        status: TaskStatus.WORKING,
      });
      await repository.create({
        id: "ready-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/ready-1",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });

      const task = await repository.getNextExecutable(defaultLimits);

      expect(task).toBeNull();
    });

    test("skips task when repo limit reached", async () => {
      await repository.create({
        id: "work-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/work-1",
        status: TaskStatus.WORKING,
      });
      await repository.create({
        id: "work-2",
        repo_id: "repo-1",
        change_path: "openspec/changes/work-2",
        status: TaskStatus.WORKING,
      });
      await repository.create({
        id: "ready-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/ready-1",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });
      await repository.create({
        id: "ready-2",
        repo_id: "repo-2",
        change_path: "openspec/changes/ready-2",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T11:00:00Z",
      });

      const task = await repository.getNextExecutable(defaultLimits);

      expect(task?.id).toBe("ready-2");
    });

    test("respects per-repo limit from callback", async () => {
      await repository.create({
        id: "work-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/work-1",
        status: TaskStatus.WORKING,
      });
      await repository.create({
        id: "ready-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/ready-1",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });

      const limits = {
        globalMax: 3,
        getRepoMax: async (repoId: string) => (repoId === "repo-1" ? 1 : 2),
      };

      const task = await repository.getNextExecutable(limits);

      expect(task).toBeNull();
    });
  });

  describe("sync fields (remoteId, syncedAt)", () => {
    test("creates task with sync fields as null by default", async () => {
      const task = await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });

      expect(task.remote_id).toBeNull();
      expect(task.synced_at).toBeNull();
    });

    test("creates task with sync fields populated", async () => {
      const syncedAt = "2026-02-02T10:00:00Z";
      const task = await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
        remote_id: "remote_abc123",
        synced_at: syncedAt,
      });

      expect(task.remote_id).toBe("remote_abc123");
      expect(task.synced_at).toBe(syncedAt);
    });

    test("updates remoteId field", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });

      const updated = await repository.update("task-1", {
        remote_id: "remote_xyz789",
      });

      expect(updated?.remote_id).toBe("remote_xyz789");
    });

    test("updates syncedAt field", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });

      const syncedAt = "2026-02-02T15:30:00Z";
      const updated = await repository.update("task-1", {
        synced_at: syncedAt,
      });

      expect(updated?.synced_at).toBe(syncedAt);
    });

    test("updates both sync fields together", async () => {
      await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
      });

      const syncedAt = "2026-02-02T15:30:00Z";
      const updated = await repository.update("task-1", {
        remote_id: "remote_abc123",
        synced_at: syncedAt,
      });

      expect(updated?.remote_id).toBe("remote_abc123");
      expect(updated?.synced_at).toBe(syncedAt);
    });

    test("clears sync fields by setting to null", async () => {
      const task = await repository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.DRAFT,
        remote_id: "remote_abc123",
        synced_at: "2026-02-02T10:00:00Z",
      });

      expect(task.remote_id).toBe("remote_abc123");

      const updated = await repository.update("task-1", {
        remote_id: null,
        synced_at: null,
      });

      expect(updated?.remote_id).toBeNull();
      expect(updated?.synced_at).toBeNull();
    });
  });
});
