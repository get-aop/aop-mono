import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database, StepExecution } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import { reattachToAgent, recoverStaleTasks } from "./recovery.ts";

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
    });
  };

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

  test("recovers dead agent with log file showing success", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);

    const logFile = join(logsDir, "step-1.jsonl");
    const logContent = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "Task complete" }),
    ].join("\n");
    writeFileSync(logFile, logContent);

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.recovered).toBe(1);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("DONE");

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("success");

    const execution = await ctx.executionRepository.getExecution("exec-1");
    expect(execution?.status).toBe("completed");
  });

  test("recovers dead agent with log file showing error", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);

    const logFile = join(logsDir, "step-1.jsonl");
    const logContent = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Working" }] },
      }),
      JSON.stringify({ type: "result", subtype: "error", result: "Something went wrong" }),
    ].join("\n");
    writeFileSync(logFile, logContent);

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

  test("leaves alive agent as WORKING and returns reattached count", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 12345);

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: (pid) => pid === 12345,
      isClaudeProcess: (pid) => pid === 12345,
    });

    expect(result.reattached).toBe(1);

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

  test("handles multiple stale tasks with mixed states", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");

    // Task 1: alive agent
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 100);

    // Task 2: dead agent with log
    await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "WORKING");
    await setupRunningStepExecution("task-2", "exec-2", "step-2", 200);
    const logFile = join(logsDir, "step-2.jsonl");
    writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success", result: "OK" }));

    // Task 3: dead agent without log
    await createTestTask(db, "task-3", "repo-1", "changes/feat-3", "WORKING");
    await setupRunningStepExecution("task-3", "exec-3", "step-3", 300);

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: (pid) => pid === 100,
      isClaudeProcess: (pid) => pid === 100,
    });

    expect(result.reattached).toBe(1);
    expect(result.recovered).toBe(1);
    expect(result.reset).toBe(1);

    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("WORKING");
    expect((await ctx.taskRepository.get("task-2"))?.status).toBe("DONE");
    expect((await ctx.taskRepository.get("task-3"))?.status).toBe("READY");
  });
});

describe("reattachToAgent", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let logsDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    logsDir = join(tmpdir(), `aop-test-reattach-${Date.now()}`);
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
    agentPid: number,
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
    });
  };

  test("starts PID poller and finalizes with log file when PID exits", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 12345);

    const logFile = join(logsDir, "step-1.jsonl");
    writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success", result: "Done" }));

    let pollCount = 0;
    const intervalId = reattachToAgent(
      ctx,
      {
        id: "step-1",
        execution_id: "exec-1",
        task_id: "task-1",
        agent_pid: 12345,
      } as StepExecution & { task_id: string },
      {
        logsDir,
        isProcessAlive: () => {
          pollCount++;
          // Alive for first poll, dead on second
          return pollCount < 2;
        },
      },
    );

    // Wait for the poller to detect PID death and finalize
    await new Promise((resolve) => setTimeout(resolve, 6000));
    clearInterval(intervalId);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("DONE");

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("success");

    // Log file should be cleaned up
    expect(existsSync(logFile)).toBe(false);
  }, 10000);

  test("reattached agent finalizes with reset when no log file", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 12345);

    const intervalId = reattachToAgent(
      ctx,
      {
        id: "step-1",
        execution_id: "exec-1",
        task_id: "task-1",
        agent_pid: 12345,
      } as StepExecution & { task_id: string },
      {
        logsDir,
        isProcessAlive: () => false,
      },
    );

    // Wait for the poller to detect PID death and finalize
    await new Promise((resolve) => setTimeout(resolve, 6000));
    clearInterval(intervalId);

    const task = await ctx.taskRepository.get("task-1");
    expect(task?.status).toBe("READY");

    const step = await ctx.executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("cancelled");

    const execution = await ctx.executionRepository.getExecution("exec-1");
    expect(execution?.status).toBe("cancelled");
  }, 10000);
});
