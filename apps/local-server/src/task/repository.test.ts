import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import type { TaskEvent, TaskEventEmitter } from "../events/task-events.ts";
import { createLinearStore, type LinearStore } from "../integrations/linear/store.ts";
import { createTaskRepository, type TaskRepository } from "./repository.ts";

describe("task/repository", () => {
  let db: Kysely<Database>;
  let repo: TaskRepository;
  let linearStore: LinearStore;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createTaskRepository(db);
    linearStore = createLinearStore(db);
    await createTestRepo(db, "repo-1", "/test/repo");
  });

  afterEach(async () => {
    await db.destroy();
  });

  const createReadyTask = async (
    id: string,
    repoId: string,
    changePath: string,
    readyAt: string,
  ): Promise<void> => {
    await createTestTask(db, id, repoId, changePath, "READY");
    await repo.update(id, { status: "READY", ready_at: readyAt });
  };

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
      expect(task.change_path).toBe("docs/tasks/feat-1");
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

    test("does not emit task-created when returning existing REMOVED task", async () => {
      const events: TaskEvent[] = [];
      const eventEmitter: TaskEventEmitter = {
        emit: (event) => events.push(event),
        subscribe: () => () => {},
        listenerCount: () => 0,
      };
      const repoWithEvents = createTaskRepository(db, { eventEmitter });

      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "REMOVED");
      await repoWithEvents.refresh();
      events.length = 0;

      const now = new Date().toISOString();
      const result = await repoWithEvents.createIdempotent({
        id: "task-2",
        repo_id: "repo-1",
        change_path: "changes/feat-1",
        status: "DRAFT",
        created_at: now,
        updated_at: now,
      });

      expect(result?.id).toBe("task-1");
      expect(result?.status).toBe("REMOVED");
      expect(events).toHaveLength(0);
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
      await createReadyTask(
        "task-1",
        "repo-1",
        "changes/feat-1",
        new Date(now.getTime() + 1000).toISOString(),
      );
      await createReadyTask(
        "task-2",
        "repo-1",
        "changes/feat-2",
        new Date(now.getTime() - 1000).toISOString(),
      );

      const tasks = await repo.list({ orderByReadyAt: "asc" });

      expect(tasks[0]?.id).toBe("task-2");
      expect(tasks[1]?.id).toBe("task-1");
    });

    test("orders by ready_at descending", async () => {
      const now = new Date();
      await createReadyTask(
        "task-1",
        "repo-1",
        "changes/feat-1",
        new Date(now.getTime() - 1000).toISOString(),
      );
      await createReadyTask(
        "task-2",
        "repo-1",
        "changes/feat-2",
        new Date(now.getTime() + 1000).toISOString(),
      );

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
      await createReadyTask("task-1", "repo-1", "changes/feat-1", now.toISOString());

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
      await createReadyTask(
        "task-2",
        "repo-1",
        "changes/feat-2",
        new Date(now.getTime() - 1000).toISOString(),
      );
      await createReadyTask(
        "task-3",
        "repo-2",
        "changes/feat-3",
        new Date(now.getTime() + 1000).toISOString(),
      );

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 1,
      };

      const task = await repo.getNextExecutable(limits);

      expect(task?.id).toBe("task-3");
    });

    test("orders READY tasks by ready_at ascending", async () => {
      const now = new Date();
      await createReadyTask(
        "task-1",
        "repo-1",
        "changes/feat-1",
        new Date(now.getTime() + 1000).toISOString(),
      );
      await createReadyTask(
        "task-2",
        "repo-1",
        "changes/feat-2",
        new Date(now.getTime() - 1000).toISOString(),
      );

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
      await createReadyTask(
        "task-2",
        "repo-1",
        "changes/feat-2",
        new Date(now.getTime() - 2000).toISOString(),
      );
      await createReadyTask(
        "task-3",
        "repo-2",
        "changes/feat-3",
        new Date(now.getTime() - 1000).toISOString(),
      );

      const limits = {
        globalMax: 5,
        getRepoMax: async (repoId: string) => (repoId === "repo-1" ? 1 : 2),
      };

      const task = await repo.getNextExecutable(limits);

      expect(task?.id).toBe("task-3");
    });

    test("excludes orphaned tasks whose repo no longer exists", async () => {
      // Create a READY task referencing a repo that doesn't exist
      const now = new Date();
      await createTestTask(db, "orphan-task", "deleted-repo", "changes/orphan", "READY");

      // Create a valid READY task
      await createReadyTask("valid-task", "repo-1", "changes/valid", now.toISOString());

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 2,
      };

      const task = await repo.getNextExecutable(limits);

      // Should return the valid task, not the orphan
      expect(task?.id).toBe("valid-task");
    });

    test("returns null when only orphaned tasks exist", async () => {
      await createTestTask(db, "orphan-task", "deleted-repo", "changes/orphan", "READY");

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 2,
      };

      const task = await repo.getNextExecutable(limits);

      expect(task).toBeNull();
    });

    test("skips READY tasks that are waiting on unfinished dependencies", async () => {
      const now = new Date();
      await createTestTask(db, "task-upstream", "repo-1", "changes/upstream", "WORKING");
      await createReadyTask(
        "task-blocked",
        "repo-1",
        "changes/blocked",
        new Date(now.getTime() - 2000).toISOString(),
      );
      await createReadyTask(
        "task-unrelated",
        "repo-1",
        "changes/unrelated",
        new Date(now.getTime() - 1000).toISOString(),
      );

      await linearStore.replaceTaskDependencies("task-blocked", ["task-upstream"]);

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 2,
      };

      const task = await repo.getNextExecutable(limits);

      expect(task?.id).toBe("task-unrelated");
    });

    test("returns null when every READY task is blocked by terminal dependencies", async () => {
      await createTestTask(db, "task-upstream", "repo-1", "changes/upstream", "BLOCKED");
      await createReadyTask("task-blocked", "repo-1", "changes/blocked", new Date().toISOString());
      await linearStore.replaceTaskDependencies("task-blocked", ["task-upstream"]);
      await linearStore.upsertTaskSource({
        taskId: "task-upstream",
        repoId: "repo-1",
        externalId: "lin_120",
        externalRef: "ABC-120",
        externalUrl: "https://linear.app/acme/issue/ABC-120/upstream",
        titleSnapshot: "Upstream task",
      });

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 2,
      };

      const task = await repo.getNextExecutable(limits);
      const dependencyState = await repo.getDependencyState("task-blocked");

      expect(task).toBeNull();
      expect(dependencyState).toEqual({
        dependencyState: "blocked",
        blockedByTaskIds: ["task-upstream"],
        blockedByRefs: ["ABC-120"],
      });
    });

    test("keeps dependent READY tasks waiting until DONE dependencies finish handoff", async () => {
      const now = new Date();
      await createTestTask(db, "task-upstream", "repo-1", "changes/upstream", "DONE");
      await repo.update("task-upstream", { worktree_path: "/tmp/aop/worktrees/task-upstream" });
      await createReadyTask(
        "task-blocked",
        "repo-1",
        "changes/blocked",
        new Date(now.getTime() - 2_000).toISOString(),
      );
      await createReadyTask(
        "task-unrelated",
        "repo-1",
        "changes/unrelated",
        new Date(now.getTime() - 1_000).toISOString(),
      );
      await linearStore.replaceTaskDependencies("task-blocked", ["task-upstream"]);

      const limits = {
        globalMax: 5,
        getRepoMax: async () => 2,
      };

      const task = await repo.getNextExecutable(limits);
      const dependencyState = await repo.getDependencyState("task-blocked");

      expect(task?.id).toBe("task-unrelated");
      expect(dependencyState).toEqual({
        dependencyState: "waiting",
        blockedByTaskIds: ["task-upstream"],
        blockedByRefs: [],
      });
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

  describe("getMetrics", () => {
    test("returns zero metrics when no tasks exist", async () => {
      const metrics = await repo.getMetrics();

      expect(metrics.total).toBe(0);
      expect(metrics.byStatus.DRAFT).toBe(0);
      expect(metrics.byStatus.READY).toBe(0);
      expect(metrics.byStatus.WORKING).toBe(0);
      expect(metrics.byStatus.BLOCKED).toBe(0);
      expect(metrics.byStatus.DONE).toBe(0);
      expect(metrics.byStatus.REMOVED).toBe(0);
      expect(metrics.successRate).toBe(0);
      expect(metrics.avgDurationMs).toBe(0);
      expect(metrics.avgFailedDurationMs).toBe(0);
    });

    test("counts tasks by status", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "DRAFT");
      await createTestTask(db, "task-3", "repo-1", "changes/feat-3", "READY");
      await createTestTask(db, "task-4", "repo-1", "changes/feat-4", "WORKING");
      await createTestTask(db, "task-5", "repo-1", "changes/feat-5", "DONE");
      await createTestTask(db, "task-6", "repo-1", "changes/feat-6", "DONE");
      await createTestTask(db, "task-7", "repo-1", "changes/feat-7", "DONE");
      await createTestTask(db, "task-8", "repo-1", "changes/feat-8", "BLOCKED");

      const metrics = await repo.getMetrics();

      expect(metrics.total).toBe(8);
      expect(metrics.byStatus.DRAFT).toBe(2);
      expect(metrics.byStatus.READY).toBe(1);
      expect(metrics.byStatus.WORKING).toBe(1);
      expect(metrics.byStatus.DONE).toBe(3);
      expect(metrics.byStatus.BLOCKED).toBe(1);
      expect(metrics.byStatus.REMOVED).toBe(0);
    });

    test("calculates success rate as DONE / (DONE + BLOCKED)", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DONE");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "DONE");
      await createTestTask(db, "task-3", "repo-1", "changes/feat-3", "DONE");
      await createTestTask(db, "task-4", "repo-1", "changes/feat-4", "BLOCKED");

      const metrics = await repo.getMetrics();

      expect(metrics.successRate).toBe(0.75);
    });

    test("returns success rate of 0 when no DONE or BLOCKED tasks", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const metrics = await repo.getMetrics();

      expect(metrics.successRate).toBe(0);
    });

    test("filters metrics by repoId", async () => {
      await createTestRepo(db, "repo-2", "/test/repo2");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DONE");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "DONE");
      await createTestTask(db, "task-3", "repo-2", "changes/feat-3", "DONE");
      await createTestTask(db, "task-4", "repo-2", "changes/feat-4", "BLOCKED");
      await createTestTask(db, "task-5", "repo-2", "changes/feat-5", "BLOCKED");

      const metricsRepo1 = await repo.getMetrics("repo-1");
      const metricsRepo2 = await repo.getMetrics("repo-2");

      expect(metricsRepo1.total).toBe(2);
      expect(metricsRepo1.byStatus.DONE).toBe(2);
      expect(metricsRepo1.successRate).toBe(1);

      expect(metricsRepo2.total).toBe(3);
      expect(metricsRepo2.byStatus.DONE).toBe(1);
      expect(metricsRepo2.byStatus.BLOCKED).toBe(2);
      expect(metricsRepo2.successRate).toBeCloseTo(0.333, 2);
    });

    test("keeps average duration at zero without persisted execution history", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DONE");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "DONE");

      const metrics = await repo.getMetrics();

      expect(metrics.avgDurationMs).toBe(0);
    });

    test("keeps failed average duration at zero without persisted execution history", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "BLOCKED");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "BLOCKED");

      const metrics = await repo.getMetrics();

      expect(metrics.avgFailedDurationMs).toBe(0);
    });

    test("reports zero execution durations for each repo", async () => {
      await createTestRepo(db, "repo-2", "/test/repo2");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DONE");
      await createTestTask(db, "task-2", "repo-2", "changes/feat-2", "DONE");

      const metricsRepo1 = await repo.getMetrics("repo-1");
      const metricsRepo2 = await repo.getMetrics("repo-2");

      expect(metricsRepo1.avgDurationMs).toBe(0);
      expect(metricsRepo2.avgDurationMs).toBe(0);
    });
  });
});
