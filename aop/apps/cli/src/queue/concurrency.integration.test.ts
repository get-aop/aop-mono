import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createMockServerSync } from "../sync/test-utils.ts";
import { TaskStatus } from "../tasks/types.ts";
import { createQueueProcessor } from "./processor.ts";

describe("Concurrency Limit Enforcement Integration", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let testDir: string;

  const createRepoWithLimit = async (id: string, path: string, maxConcurrent: number) => {
    const repoPath = join(testDir, path);
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(join(repoPath, "openspec/changes"), { recursive: true });
    await ctx.repoRepository.create({
      id,
      path: repoPath,
      name: path,
      max_concurrent_tasks: maxConcurrent,
    });
    return repoPath;
  };

  const createReadyTask = async (
    id: string,
    repoId: string,
    changeName: string,
    readyAt: string,
  ) => {
    const repoData = await ctx.repoRepository.getById(repoId);
    if (!repoData) throw new Error(`Repo ${repoId} not found`);
    const changePath = join(repoData.path, "openspec/changes", changeName);
    mkdirSync(changePath, { recursive: true });

    await ctx.taskRepository.create({
      id,
      repo_id: repoId,
      change_path: changePath,
      status: TaskStatus.READY,
      ready_at: readyAt,
    });
  };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);

    testDir = join(
      tmpdir(),
      `concurrency-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(testDir, { recursive: true, force: true });
  });

  test("per-repo limit: blocks second task in same repo while first is WORKING", async () => {
    await createRepoWithLimit("repo-a", "repo-a", 1);

    await createReadyTask("task-a1", "repo-a", "feature-a1", "2024-01-15T10:00:00Z");
    await createReadyTask("task-a2", "repo-a", "feature-a2", "2024-01-15T11:00:00Z");

    await ctx.settingsRepository.set("max_concurrent_tasks", "5");

    const executedTasks: string[] = [];
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executedTasks.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.WORKING });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1"]);

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1"]);
  });

  test("per-repo limit: allows tasks from different repos concurrently", async () => {
    await createRepoWithLimit("repo-a", "repo-a", 1);
    await createRepoWithLimit("repo-b", "repo-b", 1);

    await createReadyTask("task-a1", "repo-a", "feature-a1", "2024-01-15T10:00:00Z");
    await createReadyTask("task-b1", "repo-b", "feature-b1", "2024-01-15T10:30:00Z");

    await ctx.settingsRepository.set("max_concurrent_tasks", "5");

    const executedTasks: string[] = [];
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executedTasks.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.WORKING });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();

    expect(executedTasks.sort()).toEqual(["task-a1", "task-b1"]);
  });

  test("global limit: blocks all repos when global limit reached", async () => {
    await createRepoWithLimit("repo-a", "repo-a", 5);
    await createRepoWithLimit("repo-b", "repo-b", 5);

    await createReadyTask("task-a1", "repo-a", "feature-a1", "2024-01-15T10:00:00Z");
    await createReadyTask("task-b1", "repo-b", "feature-b1", "2024-01-15T10:30:00Z");

    await ctx.settingsRepository.set("max_concurrent_tasks", "1");

    const executedTasks: string[] = [];
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executedTasks.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.WORKING });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1"]);

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1"]);
  });

  test("combined limits: respects both global and per-repo limits", async () => {
    await createRepoWithLimit("repo-a", "repo-a", 2);
    await createRepoWithLimit("repo-b", "repo-b", 2);

    await createReadyTask("task-a1", "repo-a", "feature-a1", "2024-01-15T10:00:00Z");
    await createReadyTask("task-a2", "repo-a", "feature-a2", "2024-01-15T10:10:00Z");
    await createReadyTask("task-a3", "repo-a", "feature-a3", "2024-01-15T10:20:00Z");
    await createReadyTask("task-b1", "repo-b", "feature-b1", "2024-01-15T10:30:00Z");

    await ctx.settingsRepository.set("max_concurrent_tasks", "3");

    const executedTasks: string[] = [];
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executedTasks.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.WORKING });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();

    expect(executedTasks).toEqual(["task-a1", "task-a2", "task-b1"]);

    const taskA3 = await ctx.taskRepository.get("task-a3");
    expect(taskA3?.status).toBe(TaskStatus.READY);
  });

  test("repo limit > global limit: global takes precedence", async () => {
    await createRepoWithLimit("repo-a", "repo-a", 10);

    await createReadyTask("task-a1", "repo-a", "feature-a1", "2024-01-15T10:00:00Z");
    await createReadyTask("task-a2", "repo-a", "feature-a2", "2024-01-15T10:10:00Z");
    await createReadyTask("task-a3", "repo-a", "feature-a3", "2024-01-15T10:20:00Z");

    await ctx.settingsRepository.set("max_concurrent_tasks", "2");

    const executedTasks: string[] = [];
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executedTasks.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.WORKING });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();

    expect(executedTasks).toEqual(["task-a1", "task-a2"]);
  });

  test("FIFO respected within concurrency constraints across multiple repos", async () => {
    await createRepoWithLimit("repo-a", "repo-a", 1);
    await createRepoWithLimit("repo-b", "repo-b", 1);

    await createReadyTask("task-a1", "repo-a", "feature-a1", "2024-01-15T10:00:00Z");
    await createReadyTask("task-b1", "repo-b", "feature-b1", "2024-01-15T10:05:00Z");
    await createReadyTask("task-a2", "repo-a", "feature-a2", "2024-01-15T10:10:00Z");
    await createReadyTask("task-b2", "repo-b", "feature-b2", "2024-01-15T10:15:00Z");

    await ctx.settingsRepository.set("max_concurrent_tasks", "4");

    const executedTasks: string[] = [];
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executedTasks.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.WORKING });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();

    expect(executedTasks).toEqual(["task-a1", "task-b1"]);

    await ctx.taskRepository.update("task-a1", { status: TaskStatus.DONE });
    await processor.processOnce();

    expect(executedTasks).toEqual(["task-a1", "task-b1", "task-a2"]);

    await ctx.taskRepository.update("task-b1", { status: TaskStatus.DONE });
    await processor.processOnce();

    expect(executedTasks).toEqual(["task-a1", "task-b1", "task-a2", "task-b2"]);
  });

  test("slot frees up when task moves to DONE", async () => {
    await createRepoWithLimit("repo-a", "repo-a", 1);

    await createReadyTask("task-a1", "repo-a", "feature-a1", "2024-01-15T10:00:00Z");
    await createReadyTask("task-a2", "repo-a", "feature-a2", "2024-01-15T11:00:00Z");

    await ctx.settingsRepository.set("max_concurrent_tasks", "5");

    const executedTasks: string[] = [];
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executedTasks.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.WORKING });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1"]);

    await ctx.taskRepository.update("task-a1", { status: TaskStatus.DONE });

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1", "task-a2"]);
  });

  test("slot frees up when task moves to BLOCKED", async () => {
    await createRepoWithLimit("repo-a", "repo-a", 1);

    await createReadyTask("task-a1", "repo-a", "feature-a1", "2024-01-15T10:00:00Z");
    await createReadyTask("task-a2", "repo-a", "feature-a2", "2024-01-15T11:00:00Z");

    await ctx.settingsRepository.set("max_concurrent_tasks", "5");

    const executedTasks: string[] = [];
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executedTasks.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.WORKING });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1"]);

    await ctx.taskRepository.update("task-a1", { status: TaskStatus.BLOCKED });

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1", "task-a2"]);
  });

  test("no tasks executed when all repos at per-repo limit", async () => {
    await createRepoWithLimit("repo-a", "repo-a", 1);
    await createRepoWithLimit("repo-b", "repo-b", 1);

    await createReadyTask("task-a1", "repo-a", "feature-a1", "2024-01-15T10:00:00Z");
    await createReadyTask("task-a2", "repo-a", "feature-a2", "2024-01-15T10:05:00Z");
    await createReadyTask("task-b1", "repo-b", "feature-b1", "2024-01-15T10:10:00Z");
    await createReadyTask("task-b2", "repo-b", "feature-b2", "2024-01-15T10:15:00Z");

    await ctx.settingsRepository.set("max_concurrent_tasks", "10");

    const executedTasks: string[] = [];
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executedTasks.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.WORKING });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();

    expect(executedTasks).toEqual(["task-a1", "task-b1"]);

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1", "task-b1"]);

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-a1", "task-b1"]);
  });
});
