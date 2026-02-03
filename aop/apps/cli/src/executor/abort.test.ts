import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import * as daemonModule from "../daemon/index.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus, StepExecutionStatus } from "../executions/types.ts";
import type { ServerSync } from "../sync/server-sync.ts";
import { abortTask } from "./abort.ts";

describe("abortTask", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  const repoId = "repo_abort_test";
  const repoPath = "/test/repo";

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, repoId, repoPath);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("throws error when task not found", async () => {
    await expect(abortTask(ctx, "nonexistent_task")).rejects.toThrow("Task not found");
  });

  test("marks task as REMOVED", async () => {
    const taskId = "task_abort_1";
    await createTestTask(db, taskId, repoId, "test-change", "WORKING");

    await abortTask(ctx, taskId);

    const task = await ctx.taskRepository.get(taskId);
    expect(task?.status).toBe("REMOVED");
  });

  test("updates running execution to ABORTED", async () => {
    const taskId = "task_abort_exec";
    const execId = "exec_abort_1";
    const stepId = "step_abort_1";
    const now = new Date().toISOString();

    await createTestTask(db, taskId, repoId, "test-change", "WORKING");
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

    await abortTask(ctx, taskId);

    const exec = await ctx.executionRepository.getExecution(execId);
    const step = await ctx.executionRepository.getStepExecution(stepId);

    expect(exec?.status).toBe(ExecutionStatus.ABORTED);
    expect(exec?.completed_at).toBeDefined();
    expect(step?.status).toBe(StepExecutionStatus.FAILURE);
    expect(step?.error).toBe("Aborted");
    expect(step?.ended_at).toBeDefined();
  });

  test("does not modify completed executions", async () => {
    const taskId = "task_abort_completed";
    const execId = "exec_completed";
    const stepId = "step_completed";
    const now = new Date().toISOString();

    await createTestTask(db, taskId, repoId, "test-change", "WORKING");
    await ctx.executionRepository.createExecution({
      id: execId,
      task_id: taskId,
      status: ExecutionStatus.COMPLETED,
      started_at: now,
      completed_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId,
      execution_id: execId,
      status: StepExecutionStatus.SUCCESS,
      started_at: now,
      ended_at: now,
    });

    await abortTask(ctx, taskId);

    const exec = await ctx.executionRepository.getExecution(execId);
    const step = await ctx.executionRepository.getStepExecution(stepId);

    expect(exec?.status).toBe(ExecutionStatus.COMPLETED);
    expect(step?.status).toBe(StepExecutionStatus.SUCCESS);
  });

  test("returns abort result with flags", async () => {
    const taskId = "task_abort_result";
    await createTestTask(db, taskId, repoId, "test-change", "WORKING");

    const result = await abortTask(ctx, taskId);

    expect(result.taskId).toBe(taskId);
    expect(typeof result.agentKilled).toBe("boolean");
  });

  test("handles multiple running step executions", async () => {
    const taskId = "task_multi_steps";
    const execId = "exec_multi";
    const stepId1 = "step_multi_1";
    const stepId2 = "step_multi_2";
    const now = new Date().toISOString();

    await createTestTask(db, taskId, repoId, "test-change", "WORKING");
    await ctx.executionRepository.createExecution({
      id: execId,
      task_id: taskId,
      status: ExecutionStatus.RUNNING,
      started_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId1,
      execution_id: execId,
      status: StepExecutionStatus.SUCCESS,
      started_at: now,
      ended_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId2,
      execution_id: execId,
      status: StepExecutionStatus.RUNNING,
      started_at: now,
    });

    await abortTask(ctx, taskId);

    const step1 = await ctx.executionRepository.getStepExecution(stepId1);
    const step2 = await ctx.executionRepository.getStepExecution(stepId2);

    expect(step1?.status).toBe(StepExecutionStatus.SUCCESS);
    expect(step2?.status).toBe(StepExecutionStatus.FAILURE);
    expect(step2?.error).toBe("Aborted");
  });

  test("does not attempt to kill agent when step is not RUNNING", async () => {
    const taskId = "task_step_success";
    const execId = "exec_step_success";
    const stepId = "step_already_done";
    const fakePid = 777777;
    const now = new Date().toISOString();

    await createTestTask(db, taskId, repoId, "test-change", "WORKING");
    await ctx.executionRepository.createExecution({
      id: execId,
      task_id: taskId,
      status: ExecutionStatus.RUNNING,
      started_at: now,
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId,
      execution_id: execId,
      status: StepExecutionStatus.SUCCESS, // Already completed
      started_at: now,
      ended_at: now,
      agent_pid: fakePid,
    });

    const result = await abortTask(ctx, taskId);

    // Agent was not killed because step was not RUNNING
    expect(result.agentKilled).toBe(false);
  });

  test("does not attempt to kill agent when no agent_pid", async () => {
    const taskId = "task_no_pid";
    const execId = "exec_no_pid";
    const stepId = "step_no_pid";
    const now = new Date().toISOString();

    await createTestTask(db, taskId, repoId, "test-change", "WORKING");
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
      // No agent_pid set
    });

    const result = await abortTask(ctx, taskId);

    expect(result.agentKilled).toBe(false);
  });

  // Tests that use real subprocess - must run BEFORE any mock.module tests
  test("kills real subprocess gracefully with SIGTERM", async () => {
    const taskId = "task_real_process";
    const execId = "exec_real_process";
    const stepId = "step_real_process";
    const now = new Date().toISOString();

    // Spawn a real subprocess using Bun.spawn
    const proc = Bun.spawn(["sleep", "100"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const realPid = proc.pid;

    // Wait a moment for the process to fully start
    await new Promise((resolve) => setTimeout(resolve, 50));

    await createTestTask(db, taskId, repoId, "test-change", "WORKING");
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
      agent_pid: realPid,
    });

    // Verify process is alive before abort
    expect(daemonModule.isProcessAlive(realPid)).toBe(true);

    const result = await abortTask(ctx, taskId);

    // Process should be killed (gracefully via SIGTERM since sleep responds to it)
    expect(result.agentKilled).toBe(true);

    // Give a moment for process to fully terminate
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify process is dead
    expect(daemonModule.isProcessAlive(realPid)).toBe(false);
  });

  test("syncs task removal to server when serverSync provided", async () => {
    const taskId = "task_server_sync";
    await createTestTask(db, taskId, repoId, "test-change", "WORKING");

    const syncTask = mock(() => Promise.resolve());
    const serverSync = { syncTask } as unknown as ServerSync;

    await abortTask(ctx, taskId, serverSync);

    expect(syncTask).toHaveBeenCalledWith(taskId, repoId, "REMOVED");
  });

  test("handles serverSync failure gracefully", async () => {
    const taskId = "task_server_sync_fail";
    await createTestTask(db, taskId, repoId, "test-change", "WORKING");

    const syncTask = mock(() => Promise.reject(new Error("Network error")));
    const serverSync = { syncTask } as unknown as ServerSync;

    // Should not throw even when serverSync fails
    const result = await abortTask(ctx, taskId, serverSync);

    expect(result.taskId).toBe(taskId);
    expect(syncTask).toHaveBeenCalled();
  });

  test("returns false when agent process is not alive", async () => {
    const taskId = "task_dead_process";
    const execId = "exec_dead_process";
    const stepId = "step_dead_process";
    const deadPid = 999999999; // Non-existent PID
    const now = new Date().toISOString();

    await createTestTask(db, taskId, repoId, "test-change", "WORKING");
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
      agent_pid: deadPid,
    });

    const result = await abortTask(ctx, taskId);

    // Agent was not killed because process was already dead
    expect(result.agentKilled).toBe(false);
  });

  test("returns false when process.kill throws ESRCH", async () => {
    const taskId = "task_kill_error";
    const execId = "exec_kill_error";
    const stepId = "step_kill_error";
    const now = new Date().toISOString();

    // Spawn and immediately kill to get a PID that will be "recently dead"
    const proc = Bun.spawn(["true"], { stdout: "ignore", stderr: "ignore" });
    const pid = proc.pid;
    await proc.exited; // Wait for it to finish

    // Brief delay to ensure process table is updated
    await new Promise((resolve) => setTimeout(resolve, 50));

    await createTestTask(db, taskId, repoId, "test-change", "WORKING");
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
      agent_pid: pid,
    });

    const result = await abortTask(ctx, taskId);

    // Process was dead so agentKilled should be false
    expect(result.agentKilled).toBe(false);
  });
});
