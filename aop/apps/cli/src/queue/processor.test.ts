import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createRepoRepository, type RepoRepository } from "../repos/repository.ts";
import { createSettingsRepository, type SettingsRepository } from "../settings/repository.ts";
import { createMockServerSync } from "../sync/test-utils.ts";
import { createTaskRepository, type TaskRepository } from "../tasks/repository.ts";
import { TaskStatus } from "../tasks/types.ts";
import { createQueueProcessor } from "./processor.ts";

describe("QueueProcessor", () => {
  let db: Kysely<Database>;
  let taskRepository: TaskRepository;
  let repoRepository: RepoRepository;
  let settingsRepository: SettingsRepository;
  let executedTasks: Task[];

  beforeEach(async () => {
    db = await createTestDb();
    taskRepository = createTaskRepository(db);
    repoRepository = createRepoRepository(db);
    settingsRepository = createSettingsRepository(db);
    executedTasks = [];
    await createTestRepo(db, "repo-1", "/home/user/project-a");
    await createTestRepo(db, "repo-2", "/home/user/project-b");
  });

  afterEach(async () => {
    await db.destroy();
  });

  const createProcessor = (pollIntervalMs = 100) => {
    return createQueueProcessor(
      {
        taskRepository,
        repoRepository,
        settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: (task) => {
          executedTasks.push(task);
        },
      },
      { pollIntervalMs },
    );
  };

  describe("processOnce", () => {
    test("executes next READY task when capacity available", async () => {
      await taskRepository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });

      const processor = createProcessor();
      const task = await processor.processOnce();

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
      expect(executedTasks).toHaveLength(1);
      expect(executedTasks[0]?.id).toBe("task-1");
    });

    test("returns null when no READY tasks", async () => {
      await taskRepository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/add-auth",
        status: TaskStatus.DRAFT,
      });

      const processor = createProcessor();
      const task = await processor.processOnce();

      expect(task).toBeNull();
      expect(executedTasks).toHaveLength(0);
    });

    test("selects tasks in FIFO order by ready_at", async () => {
      await taskRepository.create({
        id: "task-later",
        repo_id: "repo-1",
        change_path: "openspec/changes/later",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T12:00:00Z",
      });
      await taskRepository.create({
        id: "task-first",
        repo_id: "repo-1",
        change_path: "openspec/changes/first",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });

      const processor = createProcessor();
      const task = await processor.processOnce();

      expect(task?.id).toBe("task-first");
    });

    test("respects global concurrency limit", async () => {
      await settingsRepository.set("max_concurrent_tasks", "1");

      await taskRepository.create({
        id: "working-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/working",
        status: TaskStatus.WORKING,
      });
      await taskRepository.create({
        id: "ready-1",
        repo_id: "repo-2",
        change_path: "openspec/changes/ready",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });

      const processor = createProcessor();
      const task = await processor.processOnce();

      expect(task).toBeNull();
      expect(executedTasks).toHaveLength(0);
    });

    test("respects per-repo concurrency limit", async () => {
      await db
        .updateTable("repos")
        .set({ max_concurrent_tasks: 1 })
        .where("id", "=", "repo-1")
        .execute();

      await taskRepository.create({
        id: "working-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/working",
        status: TaskStatus.WORKING,
      });
      await taskRepository.create({
        id: "ready-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/ready",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });

      const processor = createProcessor();
      const task = await processor.processOnce();

      expect(task).toBeNull();
    });

    test("skips repo at limit and executes from another repo", async () => {
      await settingsRepository.set("max_concurrent_tasks", "3");
      await db
        .updateTable("repos")
        .set({ max_concurrent_tasks: 1 })
        .where("id", "=", "repo-1")
        .execute();

      await taskRepository.create({
        id: "working-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/working",
        status: TaskStatus.WORKING,
      });
      await taskRepository.create({
        id: "ready-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/ready-1",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });
      await taskRepository.create({
        id: "ready-2",
        repo_id: "repo-2",
        change_path: "openspec/changes/ready-2",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T11:00:00Z",
      });

      const processor = createProcessor();
      const task = await processor.processOnce();

      expect(task?.id).toBe("ready-2");
    });
  });

  describe("start/stop lifecycle", () => {
    test("isRunning returns false before start", () => {
      const processor = createProcessor();
      expect(processor.isRunning()).toBe(false);
    });

    test("isRunning returns true after start", async () => {
      const processor = createProcessor();
      await processor.start();
      expect(processor.isRunning()).toBe(true);
      processor.stop();
    });

    test("isRunning returns false after stop", async () => {
      const processor = createProcessor();
      await processor.start();
      processor.stop();
      expect(processor.isRunning()).toBe(false);
    });

    test("processes tasks in loop until stopped", async () => {
      await taskRepository.create({
        id: "task-1",
        repo_id: "repo-1",
        change_path: "openspec/changes/task-1",
        status: TaskStatus.READY,
        ready_at: "2024-01-15T10:00:00Z",
      });

      const processor = createProcessor(50);
      await processor.start();

      await Bun.sleep(80);

      processor.stop();

      expect(executedTasks.length).toBeGreaterThanOrEqual(1);
      expect(executedTasks[0]?.id).toBe("task-1");
    });
  });

  describe("poll interval", () => {
    test("uses config pollIntervalMs when provided", async () => {
      const processor = createProcessor(200);
      await processor.start();

      expect(processor.isRunning()).toBe(true);

      processor.stop();
    });

    test("reads poll interval from settings when config not provided", async () => {
      await settingsRepository.set("queue_poll_interval_secs", "2");

      const processor = createQueueProcessor({
        taskRepository,
        repoRepository,
        settingsRepository,
        executeTask: (task) => {
          executedTasks.push(task);
        },
      });

      await processor.start();
      expect(processor.isRunning()).toBe(true);
      processor.stop();
    });
  });
});
