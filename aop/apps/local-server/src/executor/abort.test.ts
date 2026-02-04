import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import type { ServerSync } from "../orchestrator/sync/server-sync.ts";
import { abortTask } from "./abort.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import * as processUtils from "./process-utils.ts";

describe("abortTask", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(() => {
    mock.restore();
  });

  test("throws error when task not found", async () => {
    await expect(abortTask(ctx, "nonexistent-task")).rejects.toThrow(
      "Task not found: nonexistent-task",
    );
  });

  test("aborts task without running execution", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    const result = await abortTask(ctx, "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(false);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("REMOVED");
  });

  test("aborts task with running execution but no agent_pid", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: null,
    });

    const result = await abortTask(ctx, "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(false);

    const execution = await ctx.executionRepository.getExecution("exec-1");
    expect(execution?.status).toBe(ExecutionStatus.ABORTED);

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe(StepExecutionStatus.FAILURE);
    expect(step?.error).toBe("Aborted");
  });

  test("aborts task with running agent that terminates gracefully", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    const fakePid = 12345;
    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: fakePid,
    });

    let isAliveCalls = 0;
    const isAliveSpy = spyOn(processUtils, "isProcessAlive").mockImplementation(() => {
      isAliveCalls++;
      return isAliveCalls === 1;
    });

    const killSpy = spyOn(process, "kill").mockImplementation(() => true);

    const result = await abortTask(ctx, "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(fakePid, "SIGTERM");

    isAliveSpy.mockRestore();
    killSpy.mockRestore();
  });

  test("sends SIGKILL when process does not terminate gracefully", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    const fakePid = 12345;
    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: fakePid,
    });

    const isAliveSpy = spyOn(processUtils, "isProcessAlive").mockReturnValue(true);

    const signals: string[] = [];
    const killSpy = spyOn(process, "kill").mockImplementation((_pid, signal) => {
      signals.push(signal as string);
      return true;
    });

    const originalDateNow = Date.now;
    let elapsedTime = 0;
    Date.now = () => {
      elapsedTime += 500;
      return originalDateNow() + elapsedTime;
    };

    const result = await abortTask(ctx, "task-1");

    Date.now = originalDateNow;

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(true);
    expect(signals).toContain("SIGTERM");
    expect(signals).toContain("SIGKILL");

    isAliveSpy.mockRestore();
    killSpy.mockRestore();
  });

  test("handles SIGKILL failure gracefully", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    const fakePid = 12345;
    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: fakePid,
    });

    const isAliveSpy = spyOn(processUtils, "isProcessAlive").mockReturnValue(true);

    let killCount = 0;
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      killCount++;
      if (killCount === 2) {
        throw new Error("SIGKILL failed");
      }
      return true;
    });

    const originalDateNow = Date.now;
    let elapsedTime = 0;
    Date.now = () => {
      elapsedTime += 500;
      return originalDateNow() + elapsedTime;
    };

    const result = await abortTask(ctx, "task-1");

    Date.now = originalDateNow;

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(true);

    isAliveSpy.mockRestore();
    killSpy.mockRestore();
  });

  test("handles SIGTERM failure gracefully", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    const fakePid = 12345;
    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: fakePid,
    });

    const isAliveSpy = spyOn(processUtils, "isProcessAlive").mockReturnValue(true);
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const result = await abortTask(ctx, "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(false);

    isAliveSpy.mockRestore();
    killSpy.mockRestore();
  });

  test("skips kill when agent process is not alive", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    const fakePid = 12345;
    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: fakePid,
    });

    const isAliveSpy = spyOn(processUtils, "isProcessAlive").mockReturnValue(false);
    const killSpy = spyOn(process, "kill");

    const result = await abortTask(ctx, "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();

    isAliveSpy.mockRestore();
    killSpy.mockRestore();
  });

  test("skips kill when step execution is not RUNNING", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: StepExecutionStatus.SUCCESS,
      started_at: new Date().toISOString(),
      agent_pid: 12345,
    });

    const killSpy = spyOn(process, "kill");

    const result = await abortTask(ctx, "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  test("syncs task removal with serverSync when provided", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    const mockServerSync = {
      syncTask: mock(() => Promise.resolve()),
    } as unknown as ServerSync;

    const result = await abortTask(ctx, "task-1", mockServerSync);

    expect(result.taskId).toBe("task-1");
    expect(mockServerSync.syncTask).toHaveBeenCalledWith("task-1", "repo-1", "REMOVED");
  });

  test("handles serverSync failure gracefully", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    const mockServerSync = {
      syncTask: mock(() => Promise.reject(new Error("Network error"))),
    } as unknown as ServerSync;

    const result = await abortTask(ctx, "task-1", mockServerSync);

    expect(result.taskId).toBe("task-1");
    expect(mockServerSync.syncTask).toHaveBeenCalled();
  });

  test("updates multiple running executions to aborted", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    await ctx.executionRepository.createExecution({
      id: "exec-2",
      task_id: "task-1",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    await ctx.executionRepository.createStepExecution({
      id: "step-2",
      execution_id: "exec-2",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    await abortTask(ctx, "task-1");

    const exec1 = await ctx.executionRepository.getExecution("exec-1");
    const exec2 = await ctx.executionRepository.getExecution("exec-2");
    expect(exec1?.status).toBe(ExecutionStatus.ABORTED);
    expect(exec2?.status).toBe(ExecutionStatus.ABORTED);

    const step1 = await ctx.executionRepository.getStepExecution("step-1");
    const step2 = await ctx.executionRepository.getStepExecution("step-2");
    expect(step1?.status).toBe(StepExecutionStatus.FAILURE);
    expect(step2?.status).toBe(StepExecutionStatus.FAILURE);
  });

  test("does not update already completed executions", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "/test/change", "WORKING");

    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: ExecutionStatus.COMPLETED,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: StepExecutionStatus.SUCCESS,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    });

    await abortTask(ctx, "task-1");

    const exec1 = await ctx.executionRepository.getExecution("exec-1");
    expect(exec1?.status).toBe(ExecutionStatus.COMPLETED);

    const step1 = await ctx.executionRepository.getStepExecution("step-1");
    expect(step1?.status).toBe(StepExecutionStatus.SUCCESS);
  });
});
