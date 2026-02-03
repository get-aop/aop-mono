import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepCompleteResponse } from "@aop/common/protocol";
import { cleanupTestRepos, createTestRepo as createGitTestRepo } from "@aop/git-manager/test-utils";
import { ClaudeCodeProvider } from "@aop/llm-provider";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus, StepExecutionStatus } from "../executions/types.ts";
import { executeTask } from "./executor.ts";
import { createSpyServerSync } from "./test-utils.ts";

describe("Executor Integration", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let tempDir: string;
  const repoId = "repo_exec_test";
  const taskId = "task_exec_test";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    tempDir = await mkdtemp(join(tmpdir(), "executor-test-"));
    await createTestRepo(db, repoId, tempDir);
    await createTestTask(db, taskId, repoId, "test-change", "READY");
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("execution records are created with correct status", async () => {
    const now = new Date().toISOString();
    const execId = "exec_test123";
    const stepId = "step_test123";

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

    const exec = await ctx.executionRepository.getExecution(execId);
    const step = await ctx.executionRepository.getStepExecution(stepId);

    expect(exec?.status).toBe(ExecutionStatus.RUNNING);
    expect(step?.status).toBe(StepExecutionStatus.RUNNING);
  });

  test("task status can be updated to WORKING", async () => {
    const task = await ctx.taskRepository.get(taskId);
    expect(task?.status).toBe("READY");

    await ctx.taskRepository.update(taskId, {
      status: "WORKING",
      worktree_path: join(tempDir, ".worktrees", taskId),
    });

    const updated = await ctx.taskRepository.get(taskId);
    expect(updated?.status).toBe("WORKING");
    expect(updated?.worktree_path).toContain(taskId);
  });

  test("task status transitions to DONE on success", async () => {
    await ctx.taskRepository.update(taskId, { status: "WORKING" });

    const task = await ctx.taskRepository.get(taskId);
    expect(task?.status).toBe("WORKING");

    await ctx.taskRepository.update(taskId, { status: "DONE" });

    const done = await ctx.taskRepository.get(taskId);
    expect(done?.status).toBe("DONE");
  });

  test("task status transitions to BLOCKED on failure", async () => {
    await ctx.taskRepository.update(taskId, { status: "WORKING" });

    await ctx.taskRepository.update(taskId, { status: "BLOCKED" });

    const blocked = await ctx.taskRepository.get(taskId);
    expect(blocked?.status).toBe("BLOCKED");
  });

  test("step execution can be updated with session_id", async () => {
    const now = new Date().toISOString();
    const execId = "exec_session";
    const stepId = "step_session";

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

    await ctx.executionRepository.updateStepExecution(stepId, {
      session_id: "session_abc123",
    });

    const step = await ctx.executionRepository.getStepExecution(stepId);
    expect(step?.session_id).toBe("session_abc123");
  });

  test("step execution can be finalized with exit_code and error", async () => {
    const now = new Date().toISOString();
    const execId = "exec_final";
    const stepId = "step_final";

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

    await ctx.executionRepository.updateStepExecution(stepId, {
      status: StepExecutionStatus.FAILURE,
      exit_code: 1,
      error: "Inactivity timeout",
      ended_at: new Date().toISOString(),
    });

    const step = await ctx.executionRepository.getStepExecution(stepId);
    expect(step?.status).toBe(StepExecutionStatus.FAILURE);
    expect(step?.exit_code).toBe(1);
    expect(step?.error).toBe("Inactivity timeout");
  });

  test("execution can be marked completed", async () => {
    const now = new Date().toISOString();
    const execId = "exec_complete";

    await ctx.executionRepository.createExecution({
      id: execId,
      task_id: taskId,
      status: ExecutionStatus.RUNNING,
      started_at: now,
    });

    await ctx.executionRepository.updateExecution(execId, {
      status: ExecutionStatus.COMPLETED,
      completed_at: new Date().toISOString(),
    });

    const exec = await ctx.executionRepository.getExecution(execId);
    expect(exec?.status).toBe(ExecutionStatus.COMPLETED);
    expect(exec?.completed_at).toBeDefined();
  });

  test("settings can be retrieved", async () => {
    const timeout = await ctx.settingsRepository.get("agent_timeout_secs");
    expect(Number.parseInt(timeout, 10)).toBe(1800);
  });
});

describe("executeTask", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let tempDir: string;
  const repoId = "repo_execute";
  const taskId = "task_execute";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    tempDir = await mkdtemp(join(tmpdir(), "executor-execute-test-"));
    mkdirSync(join(tempDir, "logs"), { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestRepos();
    await db.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("orchestrates full execution flow successfully", async () => {
    const repoPath = await createGitTestRepo({ withInitialCommit: true });
    await createTestRepo(db, repoId, repoPath);
    await createTestTask(db, taskId, repoId, "changes/test", "READY");

    const task = (await ctx.taskRepository.get(taskId)) as Task;
    const stepCommand = {
      id: "step_1",
      type: "implement",
      promptTemplate: "Do something in {{ worktree.path }}",
      attempt: 1,
    };
    const executionInfo = { id: "server_exec_1", workflowId: "wf_1" };

    const originalRun = ClaudeCodeProvider.prototype.run;
    ClaudeCodeProvider.prototype.run = async () => ({ exitCode: 0, sessionId: "sess_test" });

    try {
      const result = await executeTask(ctx, task, stepCommand, executionInfo);

      expect(result.status).toBe("success");
      expect(result.exitCode).toBe(0);

      const updatedTask = await ctx.taskRepository.get(taskId);
      expect(updatedTask?.status).toBe("DONE");

      const executions = await db.selectFrom("executions").selectAll().execute();
      expect(executions.length).toBe(1);
      expect(executions[0]?.status).toBe(ExecutionStatus.COMPLETED);
    } finally {
      ClaudeCodeProvider.prototype.run = originalRun;
    }
  });

  test("marks task as BLOCKED on agent failure", async () => {
    const repoPath = await createGitTestRepo({ withInitialCommit: true });
    await createTestRepo(db, repoId, repoPath);
    await createTestTask(db, taskId, repoId, "changes/test", "READY");

    const task = (await ctx.taskRepository.get(taskId)) as Task;
    const stepCommand = {
      id: "step_1",
      type: "implement",
      promptTemplate: "Do something",
      attempt: 1,
    };
    const executionInfo = { id: "server_exec_1", workflowId: "wf_1" };

    const originalRun = ClaudeCodeProvider.prototype.run;
    ClaudeCodeProvider.prototype.run = async () => ({ exitCode: 1 });

    try {
      const result = await executeTask(ctx, task, stepCommand, executionInfo);

      expect(result.status).toBe("failure");
      expect(result.exitCode).toBe(1);

      const updatedTask = await ctx.taskRepository.get(taskId);
      expect(updatedTask?.status).toBe("BLOCKED");

      const executions = await db.selectFrom("executions").selectAll().execute();
      expect(executions[0]?.status).toBe(ExecutionStatus.FAILED);
    } finally {
      ClaudeCodeProvider.prototype.run = originalRun;
    }
  });

  test("syncs with server when serverSync provided", async () => {
    const repoPath = await createGitTestRepo({ withInitialCommit: true });
    await createTestRepo(db, repoId, repoPath);
    await createTestTask(db, taskId, repoId, "changes/test", "READY");

    const task = (await ctx.taskRepository.get(taskId)) as Task;
    const stepCommand = {
      id: "step_1",
      type: "implement",
      promptTemplate: "Do something",
      attempt: 1,
    };
    const executionInfo = { id: "server_exec_1", workflowId: "wf_1" };
    const serverSync = createSpyServerSync({
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({
          taskStatus: "DONE",
          step: null,
        }),
      ),
    });

    const originalRun = ClaudeCodeProvider.prototype.run;
    ClaudeCodeProvider.prototype.run = async () => ({ exitCode: 0 });

    try {
      await executeTask(ctx, task, stepCommand, executionInfo, serverSync);

      expect(serverSync.syncTask).toHaveBeenCalledWith(taskId, repoId, "WORKING");
      expect(serverSync.completeStep).toHaveBeenCalled();
    } finally {
      ClaudeCodeProvider.prototype.run = originalRun;
    }
  });

  test("handles timeout result", async () => {
    const repoPath = await createGitTestRepo({ withInitialCommit: true });
    await createTestRepo(db, repoId, repoPath);
    await createTestTask(db, taskId, repoId, "changes/test", "READY");

    const task = (await ctx.taskRepository.get(taskId)) as Task;
    const stepCommand = {
      id: "step_1",
      type: "implement",
      promptTemplate: "Do something",
      attempt: 1,
    };
    const executionInfo = { id: "server_exec_1", workflowId: "wf_1" };

    const originalRun = ClaudeCodeProvider.prototype.run;
    ClaudeCodeProvider.prototype.run = async () => ({ exitCode: -1, timedOut: true });

    try {
      const result = await executeTask(ctx, task, stepCommand, executionInfo);

      expect(result.status).toBe("timeout");

      const updatedTask = await ctx.taskRepository.get(taskId);
      expect(updatedTask?.status).toBe("BLOCKED");

      const steps = await db.selectFrom("step_executions").selectAll().execute();
      expect(steps[0]?.error).toBe("Inactivity timeout");
    } finally {
      ClaudeCodeProvider.prototype.run = originalRun;
    }
  });
});
