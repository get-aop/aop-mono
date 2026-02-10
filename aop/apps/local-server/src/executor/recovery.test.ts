import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionInfo, StepCommand } from "@aop/common/protocol";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import type { ServerSync, StepCompletePayload } from "../orchestrator/sync/server-sync.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import { recoverStaleTasks, type StepWithTask } from "./recovery.ts";

describe("recoverStaleTasks", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let logsDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    logsDir = join(tmpdir(), `aop-test-recovery-${Date.now()}`);
    mkdirSync(logsDir, { recursive: true });
  });

  afterEach(async () => {
    await db.destroy();
    if (existsSync(logsDir)) rmSync(logsDir, { recursive: true });
  });

  const setupRunningStepExecution = async (
    taskId: string,
    executionId: string,
    stepId: string,
    agentPid: number | null = null,
    remoteExecutionId: string | null = null,
  ) => {
    await ctx.executionRepository.createExecution({
      id: executionId,
      task_id: taskId,
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId,
      execution_id: executionId,
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: agentPid,
      remote_execution_id: remoteExecutionId,
    });
  };

  const writeSuccessLog = (stepId: string) => {
    const logFile = join(logsDir, `${stepId}.jsonl`);
    const logContent = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "Task complete" }),
    ].join("\n");
    writeFileSync(logFile, logContent);
    return logFile;
  };

  const writeFailureLog = (stepId: string) => {
    const logFile = join(logsDir, `${stepId}.jsonl`);
    const logContent = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Working" }] },
      }),
      JSON.stringify({ type: "result", subtype: "error", result: "Something went wrong" }),
    ].join("\n");
    writeFileSync(logFile, logContent);
    return logFile;
  };

  const createMockServerSync = (
    completeStepImpl: (
      stepId: string,
      payload: StepCompletePayload,
    ) => Promise<{
      taskStatus: string;
      step?: StepCommand | null;
      execution?: ExecutionInfo | null;
    }>,
  ) =>
    ({
      completeStep: mock(completeStepImpl),
      isDegraded: () => false,
    }) as unknown as ServerSync;

  test("does nothing when no running step executions exist", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.recovered).toBe(0);
    expect(result.reset).toBe(0);
    expect(result.reattached).toBe(0);
  });

  test("resets task to READY when agent is dead and no log file exists", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.reset).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("READY");

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("cancelled");

    const execution = await ctx.executionRepository.getExecution("exec-1");
    expect(execution?.status).toBe("cancelled");
  });

  test("recovered with remote_execution_id — completes step on server and launches next step", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999, "remote-exec-1");

    const logFile = writeSuccessLog("step-1");

    const nextStep: StepCommand = {
      id: "step-2",
      type: "review",
      promptTemplate: "Review",
      signals: [],
      attempt: 1,
      iteration: 1,
    };
    const nextExecution: ExecutionInfo = { id: "remote-exec-2", workflowId: "workflow-1" };

    const mockServerSync = createMockServerSync(async () => ({
      taskStatus: "WORKING",
      step: nextStep,
      execution: nextExecution,
    }));

    const executedTasks: Array<{ task: Task; step: StepCommand; execution: ExecutionInfo }> = [];
    const mockExecuteTask = mock((task: Task, step: StepCommand, execution: ExecutionInfo) => {
      executedTasks.push({ task, step, execution });
    });

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
      serverSync: mockServerSync,
      executeTask: mockExecuteTask,
    });

    expect(result.recovered).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("WORKING");

    expect(mockServerSync.completeStep).toHaveBeenCalledTimes(1);
    expect(mockExecuteTask).toHaveBeenCalledTimes(1);
    expect(executedTasks[0]?.step).toEqual(nextStep);
    expect(executedTasks[0]?.execution).toEqual(nextExecution);

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("success");

    expect(existsSync(logFile)).toBe(false);
  });

  test("recovered with remote_execution_id — server returns terminal status (DONE)", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999, "remote-exec-1");
    writeSuccessLog("step-1");

    const mockServerSync = createMockServerSync(async () => ({
      taskStatus: "DONE",
      step: null,
    }));
    const mockExecuteTask = mock(() => {});

    await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
      serverSync: mockServerSync,
      executeTask: mockExecuteTask,
    });

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("DONE");
    expect(mockExecuteTask).not.toHaveBeenCalled();
  });

  test("recovered with remote_execution_id — server returns BLOCKED", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999, "remote-exec-1");
    writeFailureLog("step-1");

    const mockServerSync = createMockServerSync(async () => ({
      taskStatus: "BLOCKED",
      step: null,
    }));
    const mockExecuteTask = mock(() => {});

    await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
      serverSync: mockServerSync,
      executeTask: mockExecuteTask,
    });

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("BLOCKED");
    expect(mockExecuteTask).not.toHaveBeenCalled();
  });

  test("recovered with remote_execution_id — server unavailable, retries until success", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999, "remote-exec-1");
    writeSuccessLog("step-1");

    let callCount = 0;
    const mockServerSync = createMockServerSync(async () => {
      callCount++;
      if (callCount <= 2) throw new Error("Server unavailable");
      return { taskStatus: "DONE", step: null };
    });
    const mockExecuteTask = mock(() => {});

    await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
      serverSync: mockServerSync,
      executeTask: mockExecuteTask,
    });

    expect(mockServerSync.completeStep).toHaveBeenCalledTimes(3);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("DONE");
    expect(mockExecuteTask).not.toHaveBeenCalled();
  });

  test("recovered with remote_execution_id — no serverSync provided, task set to BLOCKED", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999, "remote-exec-1");
    writeSuccessLog("step-1");

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
      serverSync: undefined,
    });

    expect(result.recovered).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("BLOCKED");
  });

  test("recovered without remote_execution_id + failure — task set to BLOCKED", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);
    writeFailureLog("step-1");

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.recovered).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("BLOCKED");

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("failure");

    const execution = await ctx.executionRepository.getExecution("exec-1");
    expect(execution?.status).toBe("failed");
  });

  test("recovered without remote_execution_id + success — task stays WORKING", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);

    const logFile = join(logsDir, "step-1.jsonl");
    writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success", result: "OK" }));

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.recovered).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("WORKING");
  });

  test("alive agent calls reattachToRunningAgent callback and returns reattached count", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 12345);

    const capturedSteps: StepWithTask[] = [];
    const reattachCallback = mock((step: StepWithTask) => {
      capturedSteps.push(step);
    });

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: (pid) => pid === 12345,
      isClaudeProcess: (pid) => pid === 12345,
      reattachToRunningAgent: reattachCallback,
    });

    expect(result.reattached).toBe(1);
    expect(reattachCallback).toHaveBeenCalledTimes(1);
    expect(capturedSteps[0]?.id).toBe("step-1");

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("WORKING");

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("running");
  });

  test("resets when PID alive but not a Claude process (PID reuse)", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 12345);

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => true,
      isClaudeProcess: () => false,
    });

    expect(result.reset).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("READY");
  });

  test("resets when step has no PID", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", null);

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.reset).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("READY");
  });

  test("preserves BLOCKED status when agent is dead and no log file", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "BLOCKED");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.reset).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("BLOCKED");

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("cancelled");
  });

  test("preserves REMOVED status when agent is dead and no log file", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "REMOVED");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.reset).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("REMOVED");
  });

  test("preserves BLOCKED status when recovering from log file", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "BLOCKED");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);

    const logFile = join(logsDir, "step-1.jsonl");
    writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success", result: "OK" }));

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.recovered).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("BLOCKED");

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("success");
  });

  test("handles multiple stale tasks with mixed states", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");

    const reattachCallback = mock((_step: StepWithTask) => {});

    // Task 1: alive agent
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 100);

    // Task 2: dead agent with log + remote_execution_id (server completes it)
    await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "WORKING");
    await setupRunningStepExecution("task-2", "exec-2", "step-2", 200, "remote-exec-2");
    writeSuccessLog("step-2");

    // Task 3: dead agent without log
    await createTestTask(db, "task-3", "repo-1", "changes/feat-3", "WORKING");
    await setupRunningStepExecution("task-3", "exec-3", "step-3", 300);

    const mockServerSync = createMockServerSync(async () => ({
      taskStatus: "DONE",
      step: null,
    }));

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: (pid) => pid === 100,
      isClaudeProcess: (pid) => pid === 100,
      reattachToRunningAgent: reattachCallback,
      serverSync: mockServerSync,
    });

    expect(result.reattached).toBe(1);
    expect(result.recovered).toBe(1);
    expect(result.reset).toBe(1);

    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("WORKING");
    expect((await ctx.taskRepository.get("task-2"))?.status).toBe("DONE");
    expect((await ctx.taskRepository.get("task-3"))?.status).toBe("READY");
  });
});
