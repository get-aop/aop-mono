import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionInfo, StepCommand, StepCompleteResponse } from "@aop/common/protocol";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
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
  ) => {
    await ctx.executionRepository.createExecution({
      id: executionId,
      task_id: taskId,
      workflow_id: "aop-default",
      status: ExecutionStatus.RUNNING,
      visited_steps: JSON.stringify(["draft_plan"]),
      iteration: 0,
      started_at: new Date().toISOString(),
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId,
      execution_id: executionId,
      step_id: "draft_plan",
      step_type: "implement",
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: agentPid,
    });
  };

  const writeSuccessLog = (stepId: string) => {
    const logFile = join(logsDir, `${stepId}.jsonl`);
    writeFileSync(
      logFile,
      [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Done" }] },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "Task complete" }),
      ].join("\n"),
    );
    return logFile;
  };

  const writeFailureLog = (stepId: string) => {
    const logFile = join(logsDir, `${stepId}.jsonl`);
    writeFileSync(
      logFile,
      [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Working" }] },
        }),
        JSON.stringify({ type: "result", subtype: "error", result: "Something went wrong" }),
      ].join("\n"),
    );
    return logFile;
  };

  test("does nothing when no running step executions exist", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result).toEqual({ recovered: 0, reset: 0, reattached: 0 });
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
    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("READY");
    expect((await ctx.executionRepository.getStepExecution("step-1"))?.status).toBe("cancelled");
    expect((await ctx.executionRepository.getExecution("exec-1"))?.status).toBe("cancelled");
  });

  test("completes a recovered successful step and launches the next step when workflow continues", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);
    const logFile = writeSuccessLog("step-1");

    const nextStep: StepCommand = {
      id: "step-2",
      type: "review",
      promptTemplate: "Review the implementation",
      signals: [],
      attempt: 1,
      iteration: 0,
    };
    const nextExecution: ExecutionInfo = { id: "exec-1", workflowId: "aop-default" };
    const completeStep = mock(
      async (): Promise<StepCompleteResponse> => ({
        taskStatus: "WORKING",
        step: nextStep,
        execution: nextExecution,
      }),
    );
    ctx.workflowService.completeStep = completeStep;

    const launched: Array<{ task: Task; step: StepCommand; execution: ExecutionInfo }> = [];
    const executeTask = mock((task: Task, step: StepCommand, execution: ExecutionInfo) => {
      launched.push({ task, step, execution });
    });

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
      executeTask,
    });

    expect(result.recovered).toBe(1);
    expect(completeStep).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      expect.objectContaining({
        executionId: "exec-1",
        stepId: "step-1",
        status: "success",
      }),
    );
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(launched[0]).toEqual({
      task: expect.objectContaining({ id: "task-1" }),
      step: nextStep,
      execution: nextExecution,
    });
    expect(existsSync(logFile)).toBe(false);
  });

  test("marks recovered failures as blocked when the workflow blocks", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 99999);
    writeFailureLog("step-1");

    ctx.workflowService.completeStep = mock(async () => ({
      taskStatus: "BLOCKED" as const,
      step: null,
      error: {
        code: "max_retries_exceeded" as const,
        message: "Workflow blocked after step failure",
      },
    }));

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: () => false,
      isClaudeProcess: () => false,
    });

    expect(result.recovered).toBe(1);
    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("WORKING");
  });

  test("reattaches when the agent process is still alive", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
    await setupRunningStepExecution("task-1", "exec-1", "step-1", 12345);

    const capturedSteps: StepWithTask[] = [];
    const reattachToRunningAgent = mock((step: StepWithTask) => {
      capturedSteps.push(step);
    });

    const result = await recoverStaleTasks(ctx, {
      logsDir,
      isProcessAlive: (pid) => pid === 12345,
      isClaudeProcess: (pid) => pid === 12345,
      reattachToRunningAgent,
    });

    expect(result.reattached).toBe(1);
    expect(reattachToRunningAgent).toHaveBeenCalledTimes(1);
    expect(capturedSteps[0]?.id).toBe("step-1");
  });
});
