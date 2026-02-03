import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus, StepExecutionStatus } from "../executions/types.ts";
import {
  buildContext,
  createExecutionRecords,
  finalizeExecutionAndGetNextStep,
  markTaskWorking,
} from "./executor.ts";

describe("finalizeExecution", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  const taskId = "task_finalize";
  const execId = "exec_finalize";
  const stepId = "step_finalize";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo_finalize", "/test/repo");
    await createTestTask(db, taskId, "repo_finalize", "test-change", "WORKING");

    const now = new Date().toISOString();
    await ctx.executionRepository.createExecution({
      id: execId,
      task_id: taskId,
      status: ExecutionStatus.RUNNING,
      started_at: now,
    });

    await ctx.executionRepository.createStepExecution({
      id: stepId,
      execution_id: execId,
      status: StepExecutionStatus.RUNNING,
      started_at: now,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("marks task and execution as successful on success result", async () => {
    await finalizeExecutionAndGetNextStep(ctx, taskId, execId, stepId, {
      exitCode: 0,
      status: "success",
    });

    const task = await ctx.taskRepository.get(taskId);
    const exec = await ctx.executionRepository.getExecution(execId);
    const step = await ctx.executionRepository.getStepExecution(stepId);

    expect(task?.status).toBe("DONE");
    expect(exec?.status).toBe(ExecutionStatus.COMPLETED);
    expect(step?.status).toBe(StepExecutionStatus.SUCCESS);
    expect(step?.exit_code).toBe(0);
    expect(step?.error).toBeNull();
  });

  test("marks task as BLOCKED on failure result", async () => {
    await finalizeExecutionAndGetNextStep(ctx, taskId, execId, stepId, {
      exitCode: 1,
      status: "failure",
    });

    const task = await ctx.taskRepository.get(taskId);
    const exec = await ctx.executionRepository.getExecution(execId);
    const step = await ctx.executionRepository.getStepExecution(stepId);

    expect(task?.status).toBe("BLOCKED");
    expect(exec?.status).toBe(ExecutionStatus.FAILED);
    expect(step?.status).toBe(StepExecutionStatus.FAILURE);
    expect(step?.exit_code).toBe(1);
  });

  test("sets timeout error message on timeout result", async () => {
    await finalizeExecutionAndGetNextStep(ctx, taskId, execId, stepId, {
      exitCode: -1,
      status: "timeout",
    });

    const step = await ctx.executionRepository.getStepExecution(stepId);

    expect(step?.status).toBe(StepExecutionStatus.FAILURE);
    expect(step?.error).toBe("Inactivity timeout");
  });

  test("sets ended_at timestamp on step execution", async () => {
    await finalizeExecutionAndGetNextStep(ctx, taskId, execId, stepId, {
      exitCode: 0,
      status: "success",
    });

    const step = await ctx.executionRepository.getStepExecution(stepId);

    expect(step?.ended_at).toBeDefined();
  });

  test("sets completed_at timestamp on execution", async () => {
    await finalizeExecutionAndGetNextStep(ctx, taskId, execId, stepId, {
      exitCode: 0,
      status: "success",
    });

    const exec = await ctx.executionRepository.getExecution(execId);

    expect(exec?.completed_at).toBeDefined();
  });
});

describe("buildContext", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let tempDir: string;
  const repoId = "repo_context";
  const taskId = "task_context";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    tempDir = await mkdtemp(join(tmpdir(), "executor-context-test-"));
    await createTestRepo(db, repoId, tempDir);
    await createTestTask(db, taskId, repoId, "changes/test-change", "READY");
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("builds context with correct paths", async () => {
    const task = (await ctx.taskRepository.get(taskId)) as Task;
    const logsDir = join(tempDir, "logs");

    const executorCtx = await buildContext(ctx, task, logsDir);

    expect(executorCtx.task.id).toBe(taskId);
    expect(executorCtx.repoPath).toBe(tempDir);
    expect(executorCtx.changePath).toBe(join(tempDir, "changes/test-change"));
    expect(executorCtx.worktreePath).toBe(join(tempDir, ".worktrees", taskId));
    expect(executorCtx.logsDir).toBe(logsDir);
    expect(executorCtx.timeoutSecs).toBe(1800);
  });

  test("throws error when repo not found", async () => {
    const now = new Date().toISOString();
    const task: Task = {
      id: "task_no_repo",
      repo_id: "nonexistent_repo",
      change_path: "test-change",
      status: "READY",
      worktree_path: null,
      created_at: now,
      updated_at: now,
      ready_at: null,
      remote_id: null,
      synced_at: null,
      preferred_workflow: null,
    };
    const logsDir = join(tempDir, "logs");

    await expect(buildContext(ctx, task, logsDir)).rejects.toThrow("Repo not found");
  });

  test("creates logs directory if not exists", async () => {
    const task = (await ctx.taskRepository.get(taskId)) as Task;
    const logsDir = join(tempDir, "new-logs");

    expect(existsSync(logsDir)).toBe(false);

    await buildContext(ctx, task, logsDir);

    expect(existsSync(logsDir)).toBe(true);
  });
});

describe("markTaskWorking", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  const repoId = "repo_mark";
  const taskId = "task_mark";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, repoId, "/test/repo");
    await createTestTask(db, taskId, repoId, "test-change", "READY");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("updates task status to WORKING with worktree path", async () => {
    const task = (await ctx.taskRepository.get(taskId)) as Task;
    const worktreePath = "/test/repo/.worktrees/task_mark";

    await markTaskWorking(ctx, task, worktreePath);

    const updated = await ctx.taskRepository.get(taskId);
    expect(updated?.status).toBe("WORKING");
    expect(updated?.worktree_path).toBe(worktreePath);
  });
});

describe("createExecutionRecords", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  const repoId = "repo_records";
  const taskId = "task_records";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, repoId, "/test/repo");
    await createTestTask(db, taskId, repoId, "test-change", "READY");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates execution and step execution records", async () => {
    const { executionId, stepId } = await createExecutionRecords(ctx, taskId);

    expect(executionId).toMatch(/^exec_/);
    expect(stepId).toMatch(/^step_/);

    const exec = await ctx.executionRepository.getExecution(executionId);
    const step = await ctx.executionRepository.getStepExecution(stepId);

    expect(exec?.task_id).toBe(taskId);
    expect(exec?.status).toBe(ExecutionStatus.RUNNING);
    expect(step?.execution_id).toBe(executionId);
    expect(step?.status).toBe(StepExecutionStatus.RUNNING);
  });

  test("generates unique IDs for each call", async () => {
    const first = await createExecutionRecords(ctx, taskId);
    const second = await createExecutionRecords(ctx, taskId);

    expect(first.executionId).not.toBe(second.executionId);
    expect(first.stepId).not.toBe(second.stepId);
  });
});

describe("finalizeExecution edge cases", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo_edge", "/test/repo");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("handles task not found during finalization", async () => {
    const taskId = "nonexistent_task";
    const execId = "exec_edge";
    const stepId = "step_edge";

    await createTestTask(db, "temp_task", "repo_edge", "test-change", "WORKING");
    const now = new Date().toISOString();
    await ctx.executionRepository.createExecution({
      id: execId,
      task_id: "temp_task",
      status: ExecutionStatus.RUNNING,
      started_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId,
      execution_id: execId,
      status: StepExecutionStatus.RUNNING,
      started_at: now,
    });

    await expect(
      finalizeExecutionAndGetNextStep(ctx, taskId, execId, stepId, {
        exitCode: 0,
        status: "success",
      }),
    ).resolves.toBeNull();

    const exec = await ctx.executionRepository.getExecution(execId);
    expect(exec?.status).toBe(ExecutionStatus.COMPLETED);
  });
});
