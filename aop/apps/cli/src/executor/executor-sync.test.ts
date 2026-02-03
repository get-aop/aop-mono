import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus, StepExecutionStatus } from "../executions/types.ts";
import {
  finalizeExecutionAndGetNextStep,
  markTaskWorking,
  runAgentWithTimeout,
} from "./executor.ts";
import {
  createMockCompleteStep,
  createSpyServerSync,
  TestClaudeCodeProvider,
} from "./test-utils.ts";

describe("markTaskWorking with serverSync", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  const repoId = "repo_mark_sync";
  const taskId = "task_mark_sync";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, repoId, "/test/repo");
    await createTestTask(db, taskId, repoId, "test-change", "READY");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("syncs task status with server when serverSync provided", async () => {
    const serverSync = createSpyServerSync();
    const task = (await ctx.taskRepository.get(taskId)) as Task;
    const worktreePath = "/test/repo/.worktrees/task_mark_sync";

    await markTaskWorking(ctx, task, worktreePath, serverSync);

    expect(serverSync.syncTask).toHaveBeenCalledWith(taskId, repoId, "WORKING");
  });

  test("does not fail when server sync fails", async () => {
    const serverSync = createSpyServerSync({
      syncTask: mock(async () => {
        throw new Error("Network error");
      }),
    });
    const task = (await ctx.taskRepository.get(taskId)) as Task;
    const worktreePath = "/test/repo/.worktrees/task_mark_sync";

    await markTaskWorking(ctx, task, worktreePath, serverSync);

    const updated = await ctx.taskRepository.get(taskId);
    expect(updated?.status).toBe("WORKING");
  });
});

describe("finalizeExecution with serverSync", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  const taskId = "task_finalize_sync";
  const execId = "exec_finalize_sync";
  const stepId = "step_finalize_sync";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo_finalize_sync", "/test/repo");
    await createTestTask(db, taskId, "repo_finalize_sync", "test-change", "WORKING");

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

  test("syncs task status on success without server step info", async () => {
    const serverSync = createSpyServerSync();

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: 0, status: "success" },
      serverSync,
    );

    expect(serverSync.syncTask).toHaveBeenCalledWith(taskId, "repo_finalize_sync", "DONE");
  });

  test("syncs task status on failure without server step info", async () => {
    const serverSync = createSpyServerSync();

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: 1, status: "failure" },
      serverSync,
    );

    expect(serverSync.syncTask).toHaveBeenCalledWith(taskId, "repo_finalize_sync", "BLOCKED");
  });

  test("handles server sync failure gracefully", async () => {
    const serverSync = createSpyServerSync({
      syncTask: mock(async () => {
        throw new Error("Server unavailable");
      }),
    });

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: 0, status: "success" },
      serverSync,
    );

    const task = await ctx.taskRepository.get(taskId);
    expect(task?.status).toBe("DONE");
  });
});

describe("finalizeExecution with serverStepInfo", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  const taskId = "task_server_step";
  const execId = "exec_server_step";
  const stepId = "step_server_step";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo_server_step", "/test/repo");
    await createTestTask(db, taskId, "repo_server_step", "test-change", "WORKING");

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

  test("calls completeStep on server and uses returned taskStatus", async () => {
    const serverSync = createSpyServerSync({
      completeStep: createMockCompleteStep({
        taskStatus: "WORKING",
        step: { id: "next_step", type: "test", promptTemplate: "Test", attempt: 1 },
      }),
    });

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: 0, status: "success" },
      serverSync,
      { serverStepId: "server_step_1", serverExecutionId: "server_exec_1", attempt: 1 },
    );

    expect(serverSync.completeStep).toHaveBeenCalledWith("server_step_1", {
      executionId: "server_exec_1",
      attempt: 1,
      status: "success",
      error: undefined,
      durationMs: 0,
    });

    const task = await ctx.taskRepository.get(taskId);
    expect(task?.status).toBe("WORKING");
  });

  test("includes timeout error info when agent times out", async () => {
    const completeStepMock = createMockCompleteStep({ taskStatus: "BLOCKED", step: null });
    const serverSync = createSpyServerSync({ completeStep: completeStepMock });

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: -1, status: "timeout" },
      serverSync,
      { serverStepId: "server_step_1", serverExecutionId: "server_exec_1", attempt: 2 },
    );

    expect(completeStepMock).toHaveBeenCalledWith("server_step_1", {
      executionId: "server_exec_1",
      attempt: 2,
      status: "failure",
      error: { code: "agent_timeout", message: "Agent timed out" },
      durationMs: 0,
    });
  });

  test("includes crash error info when agent fails", async () => {
    const completeStepMock = createMockCompleteStep({ taskStatus: "BLOCKED", step: null });
    const serverSync = createSpyServerSync({ completeStep: completeStepMock });

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: 42, status: "failure" },
      serverSync,
      { serverStepId: "server_step_1", serverExecutionId: "server_exec_1", attempt: 1 },
    );

    expect(completeStepMock).toHaveBeenCalledWith("server_step_1", {
      executionId: "server_exec_1",
      attempt: 1,
      status: "failure",
      error: { code: "agent_crash", message: "Agent exited with code 42" },
      durationMs: 0,
    });
  });

  test("falls back to local task status when server completion fails", async () => {
    const serverSync = createSpyServerSync({
      completeStep: mock(async () => {
        throw new Error("Server error");
      }),
      syncTask: mock(async () => {}),
    });

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: 0, status: "success" },
      serverSync,
      { serverStepId: "server_step_1", serverExecutionId: "server_exec_1", attempt: 1 },
    );

    const task = await ctx.taskRepository.get(taskId);
    expect(task?.status).toBe("DONE");
    expect(serverSync.syncTask).toHaveBeenCalled();
  });

  test("skips server completion when serverStepId is missing", async () => {
    const serverSync = createSpyServerSync();

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: 0, status: "success" },
      serverSync,
      { serverExecutionId: "server_exec_1", attempt: 1 },
    );

    expect(serverSync.completeStep).not.toHaveBeenCalled();
    expect(serverSync.syncTask).toHaveBeenCalled();
  });

  test("skips server completion when serverExecutionId is missing", async () => {
    const serverSync = createSpyServerSync();

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: 0, status: "success" },
      serverSync,
      { serverStepId: "server_step_1", attempt: 1 },
    );

    expect(serverSync.completeStep).not.toHaveBeenCalled();
    expect(serverSync.syncTask).toHaveBeenCalled();
  });

  test("uses default attempt 1 when attempt not provided", async () => {
    const completeStepMock = createMockCompleteStep({ taskStatus: "DONE", step: null });
    const serverSync = createSpyServerSync({ completeStep: completeStepMock });

    await finalizeExecutionAndGetNextStep(
      ctx,
      taskId,
      execId,
      stepId,
      { exitCode: 0, status: "success" },
      serverSync,
      { serverStepId: "server_step_1", serverExecutionId: "server_exec_1" },
    );

    expect(completeStepMock).toHaveBeenCalledTimes(1);
    expect(completeStepMock).toHaveBeenCalledWith(
      "server_step_1",
      expect.objectContaining({ attempt: 1 }),
    );
  });
});

describe("runAgentWithTimeout", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let tempDir: string;
  const repoId = "repo_agent";
  const taskId = "task_agent";
  const execId = "exec_agent";
  const stepId = "step_agent";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    tempDir = await mkdtemp(join(tmpdir(), "executor-agent-test-"));
    mkdirSync(join(tempDir, "logs"), { recursive: true });
    await createTestRepo(db, repoId, tempDir);
    await createTestTask(db, taskId, repoId, "test-change", "WORKING");

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
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns success for command that exits 0", async () => {
    const executorCtx = {
      task: { id: taskId } as Task,
      repoPath: tempDir,
      changePath: tempDir,
      worktreePath: tempDir,
      logsDir: join(tempDir, "logs"),
      timeoutSecs: 10,
    };

    const provider = new TestClaudeCodeProvider(["echo", '{"message": "done"}']);

    const result = await runAgentWithTimeout({
      ctx,
      executorCtx,
      prompt: "test",
      stepId,
      provider,
    });

    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
  });

  test("returns failure for command that exits non-zero", async () => {
    const executorCtx = {
      task: { id: taskId } as Task,
      repoPath: tempDir,
      changePath: tempDir,
      worktreePath: tempDir,
      logsDir: join(tempDir, "logs"),
      timeoutSecs: 10,
    };

    const provider = new TestClaudeCodeProvider(["bash", "-c", "exit 1"]);

    const result = await runAgentWithTimeout({
      ctx,
      executorCtx,
      prompt: "test",
      stepId,
      provider,
    });

    expect(result.status).toBe("failure");
    expect(result.exitCode).toBe(1);
  });

  test("extracts session_id from output and updates step", async () => {
    const executorCtx = {
      task: { id: taskId } as Task,
      repoPath: tempDir,
      changePath: tempDir,
      worktreePath: tempDir,
      logsDir: join(tempDir, "logs"),
      timeoutSecs: 10,
    };

    const provider = new TestClaudeCodeProvider(["echo", '{"session_id": "sess_test123"}']);

    const result = await runAgentWithTimeout({
      ctx,
      executorCtx,
      prompt: "test",
      stepId,
      provider,
    });

    expect(result.status).toBe("success");
    expect(result.sessionId).toBe("sess_test123");

    const step = await ctx.executionRepository.getStepExecution(stepId);
    expect(step?.session_id).toBe("sess_test123");
  });

  test("writes output to log file", async () => {
    const executorCtx = {
      task: { id: taskId } as Task,
      repoPath: tempDir,
      changePath: tempDir,
      worktreePath: tempDir,
      logsDir: join(tempDir, "logs"),
      timeoutSecs: 10,
    };

    const provider = new TestClaudeCodeProvider(["echo", '{"logged": true}']);

    await runAgentWithTimeout({
      ctx,
      executorCtx,
      prompt: "test",
      stepId,
      provider,
    });

    const logFile = join(tempDir, "logs", `${taskId}.jsonl`);
    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain('"logged": true');
  });

  test("does not update session_id when not provided in result", async () => {
    const executorCtx = {
      task: { id: taskId } as Task,
      repoPath: tempDir,
      changePath: tempDir,
      worktreePath: tempDir,
      logsDir: join(tempDir, "logs"),
      timeoutSecs: 10,
    };

    const provider = new TestClaudeCodeProvider(["echo", '{"result": "ok"}']);

    const result = await runAgentWithTimeout({
      ctx,
      executorCtx,
      prompt: "test",
      stepId,
      provider,
    });

    expect(result.sessionId).toBeUndefined();

    const step = await ctx.executionRepository.getStepExecution(stepId);
    expect(step?.session_id).toBeNull();
  });
});
