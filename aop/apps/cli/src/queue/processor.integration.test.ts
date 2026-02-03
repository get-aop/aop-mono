import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { ExecutionStatus, StepExecutionStatus } from "../executions/types.ts";
import { createMockServerSync } from "../sync/test-utils.ts";
import { TaskStatus } from "../tasks/types.ts";
import { createQueueProcessor } from "./processor.ts";

describe("Queue Processor → Executor Integration", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let testDir: string;
  let changesDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);

    testDir = join(
      tmpdir(),
      `queue-executor-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    changesDir = join(testDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });

    await createTestRepo(db, "repo-1", testDir);
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(testDir, { recursive: true, force: true });
  });

  test("queue processor invokes executor callback with correct task", async () => {
    const executedTasks: Task[] = [];

    const changePath = join(changesDir, "test-feature");
    mkdirSync(changePath, { recursive: true });

    await ctx.taskRepository.create({
      id: "task-1",
      repo_id: "repo-1",
      change_path: changePath,
      status: TaskStatus.READY,
      ready_at: new Date().toISOString(),
    });

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: (task) => {
          executedTasks.push(task);
        },
      },
      { pollIntervalMs: 50 },
    );

    const task = await processor.processOnce();

    expect(task).not.toBeNull();
    expect(task?.id).toBe("task-1");
    expect(executedTasks).toHaveLength(1);
    expect(executedTasks[0]?.id).toBe("task-1");
    expect(executedTasks[0]?.change_path).toBe(changePath);
    expect(executedTasks[0]?.repo_id).toBe("repo-1");
  });

  test("executor callback can update task status to WORKING", async () => {
    const changePath = join(changesDir, "feature-working");
    mkdirSync(changePath, { recursive: true });

    await ctx.taskRepository.create({
      id: "task-work",
      repo_id: "repo-1",
      change_path: changePath,
      status: TaskStatus.READY,
      ready_at: new Date().toISOString(),
    });

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          await ctx.taskRepository.update(task.id, {
            status: TaskStatus.WORKING,
            worktree_path: join(testDir, ".worktrees", task.id),
          });
        },
      },
      { pollIntervalMs: 50 },
    );

    await processor.processOnce();

    await new Promise((r) => setTimeout(r, 50));

    const updatedTask = await ctx.taskRepository.get("task-work");
    expect(updatedTask?.status).toBe(TaskStatus.WORKING);
    expect(updatedTask?.worktree_path).toContain("task-work");
  });

  test("executor callback can create execution records", async () => {
    const changePath = join(changesDir, "feature-exec");
    mkdirSync(changePath, { recursive: true });

    await ctx.taskRepository.create({
      id: "task-exec",
      repo_id: "repo-1",
      change_path: changePath,
      status: TaskStatus.READY,
      ready_at: new Date().toISOString(),
    });

    let createdExecutionId: string | null = null;
    let createdStepId: string | null = null;

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          const execId = `exec_${Date.now()}`;
          const stepId = `step_${Date.now()}`;
          const now = new Date().toISOString();

          await ctx.executionRepository.createExecution({
            id: execId,
            task_id: task.id,
            status: ExecutionStatus.RUNNING,
            started_at: now,
          });

          await ctx.executionRepository.createStepExecution({
            id: stepId,
            execution_id: execId,
            status: StepExecutionStatus.RUNNING,
            started_at: now,
          });

          createdExecutionId = execId;
          createdStepId = stepId;
        },
      },
      { pollIntervalMs: 50 },
    );

    await processor.processOnce();

    await new Promise((r) => setTimeout(r, 50));

    expect(createdExecutionId).not.toBeNull();
    expect(createdStepId).not.toBeNull();

    if (!createdExecutionId || !createdStepId) {
      throw new Error("Execution or step ID not created");
    }

    const execution = await ctx.executionRepository.getExecution(createdExecutionId);
    expect(execution?.task_id).toBe("task-exec");
    expect(execution?.status).toBe(ExecutionStatus.RUNNING);

    const step = await ctx.executionRepository.getStepExecution(createdStepId);
    expect(step?.execution_id).toBe(createdExecutionId);
    expect(step?.status).toBe(StepExecutionStatus.RUNNING);
  });

  test("full execution lifecycle: READY → WORKING → DONE", async () => {
    const changePath = join(changesDir, "feature-full");
    mkdirSync(changePath, { recursive: true });

    await ctx.taskRepository.create({
      id: "task-full",
      repo_id: "repo-1",
      change_path: changePath,
      status: TaskStatus.READY,
      ready_at: new Date().toISOString(),
    });

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          const execId = `exec_full_${Date.now()}`;
          const stepId = `step_full_${Date.now()}`;
          const startTime = new Date().toISOString();

          await ctx.taskRepository.update(task.id, {
            status: TaskStatus.WORKING,
            worktree_path: join(testDir, ".worktrees", task.id),
          });

          await ctx.executionRepository.createExecution({
            id: execId,
            task_id: task.id,
            status: ExecutionStatus.RUNNING,
            started_at: startTime,
          });

          await ctx.executionRepository.createStepExecution({
            id: stepId,
            execution_id: execId,
            status: StepExecutionStatus.RUNNING,
            started_at: startTime,
          });

          const endTime = new Date().toISOString();
          await ctx.executionRepository.updateStepExecution(stepId, {
            status: StepExecutionStatus.SUCCESS,
            exit_code: 0,
            ended_at: endTime,
          });

          await ctx.executionRepository.updateExecution(execId, {
            status: ExecutionStatus.COMPLETED,
            completed_at: endTime,
          });

          await ctx.taskRepository.update(task.id, { status: TaskStatus.DONE });
        },
      },
      { pollIntervalMs: 50 },
    );

    await processor.processOnce();

    await new Promise((r) => setTimeout(r, 100));

    const finalTask = await ctx.taskRepository.get("task-full");
    expect(finalTask?.status).toBe(TaskStatus.DONE);
  });

  test("execution lifecycle with failure: READY → WORKING → BLOCKED", async () => {
    const changePath = join(changesDir, "feature-fail");
    mkdirSync(changePath, { recursive: true });

    await ctx.taskRepository.create({
      id: "task-fail",
      repo_id: "repo-1",
      change_path: changePath,
      status: TaskStatus.READY,
      ready_at: new Date().toISOString(),
    });

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          const execId = `exec_fail_${Date.now()}`;
          const stepId = `step_fail_${Date.now()}`;
          const startTime = new Date().toISOString();

          await ctx.taskRepository.update(task.id, {
            status: TaskStatus.WORKING,
          });

          await ctx.executionRepository.createExecution({
            id: execId,
            task_id: task.id,
            status: ExecutionStatus.RUNNING,
            started_at: startTime,
          });

          await ctx.executionRepository.createStepExecution({
            id: stepId,
            execution_id: execId,
            status: StepExecutionStatus.RUNNING,
            started_at: startTime,
          });

          const endTime = new Date().toISOString();
          await ctx.executionRepository.updateStepExecution(stepId, {
            status: StepExecutionStatus.FAILURE,
            exit_code: 1,
            error: "Agent execution failed",
            ended_at: endTime,
          });

          await ctx.executionRepository.updateExecution(execId, {
            status: ExecutionStatus.FAILED,
            completed_at: endTime,
          });

          await ctx.taskRepository.update(task.id, { status: TaskStatus.BLOCKED });
        },
      },
      { pollIntervalMs: 50 },
    );

    await processor.processOnce();

    await new Promise((r) => setTimeout(r, 100));

    const finalTask = await ctx.taskRepository.get("task-fail");
    expect(finalTask?.status).toBe(TaskStatus.BLOCKED);
  });

  test("queue processor respects FIFO ordering when invoking executor", async () => {
    const executionOrder: string[] = [];

    for (const suffix of ["c", "a", "b"]) {
      const changePath = join(changesDir, `feature-${suffix}`);
      mkdirSync(changePath, { recursive: true });
    }

    await ctx.taskRepository.create({
      id: "task-c",
      repo_id: "repo-1",
      change_path: join(changesDir, "feature-c"),
      status: TaskStatus.READY,
      ready_at: "2024-01-15T12:00:00Z",
    });
    await ctx.taskRepository.create({
      id: "task-a",
      repo_id: "repo-1",
      change_path: join(changesDir, "feature-a"),
      status: TaskStatus.READY,
      ready_at: "2024-01-15T10:00:00Z",
    });
    await ctx.taskRepository.create({
      id: "task-b",
      repo_id: "repo-1",
      change_path: join(changesDir, "feature-b"),
      status: TaskStatus.READY,
      ready_at: "2024-01-15T11:00:00Z",
    });

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        serverSync: createMockServerSync(),
        executeTask: async (task) => {
          executionOrder.push(task.id);
          await ctx.taskRepository.update(task.id, { status: TaskStatus.DONE });
        },
      },
      { pollIntervalMs: 10 },
    );

    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();
    await new Promise((r) => setTimeout(r, 20));
    await processor.processOnce();

    expect(executionOrder).toEqual(["task-a", "task-b", "task-c"]);
  });

  test("queue processor stops invoking executor at global limit", async () => {
    const executedTasks: string[] = [];

    await ctx.settingsRepository.set("max_concurrent_tasks", "1");

    for (const suffix of ["1", "2"]) {
      const changePath = join(changesDir, `feature-${suffix}`);
      mkdirSync(changePath, { recursive: true });

      await ctx.taskRepository.create({
        id: `task-${suffix}`,
        repo_id: "repo-1",
        change_path: changePath,
        status: TaskStatus.READY,
        ready_at: `2024-01-15T1${suffix}:00:00Z`,
      });
    }

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
    expect(executedTasks).toEqual(["task-1"]);

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-1"]);
  });

  test("queue processor resumes after task completes", async () => {
    const executedTasks: string[] = [];

    await ctx.settingsRepository.set("max_concurrent_tasks", "1");

    for (const suffix of ["1", "2"]) {
      const changePath = join(changesDir, `feature-resume-${suffix}`);
      mkdirSync(changePath, { recursive: true });

      await ctx.taskRepository.create({
        id: `task-resume-${suffix}`,
        repo_id: "repo-1",
        change_path: changePath,
        status: TaskStatus.READY,
        ready_at: `2024-01-15T1${suffix}:00:00Z`,
      });
    }

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
    expect(executedTasks).toEqual(["task-resume-1"]);

    await ctx.taskRepository.update("task-resume-1", { status: TaskStatus.DONE });

    await processor.processOnce();
    expect(executedTasks).toEqual(["task-resume-1", "task-resume-2"]);
  });
});
