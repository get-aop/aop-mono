import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { executeTask, handleAgentCompletion } from "./executor.ts";

describe("executeTask", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let testRepoPath: string;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);

    testRepoPath = join(tmpdir(), `aop-test-repo-exec-${Date.now()}`);
    mkdirSync(testRepoPath, { recursive: true });
    await createTestRepo(db, "repo-1", testRepoPath);
  });

  afterEach(async () => {
    await db.destroy();
    if (existsSync(testRepoPath)) {
      rmSync(testRepoPath, { recursive: true });
    }
    cleanupAopHome();
  });

  const createProvider = (exitCode: number) => ({
    name: "mock-provider",
    run: mock(async ({ onSpawn }: { onSpawn?: (pid: number) => Promise<void> }) => {
      await onSpawn?.(4242);
      return { exitCode, sessionId: "mock-session", timedOut: false };
    }),
  });

  const createExecutionState = async (taskId: string, stepId: string) => {
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: taskId,
      workflow_id: "aop-default",
      status: "running",
      visited_steps: JSON.stringify(["draft_plan"]),
      iteration: 0,
      started_at: new Date().toISOString(),
    });
    await ctx.executionRepository.createStepExecution({
      id: stepId,
      execution_id: "exec-1",
      step_id: "draft_plan",
      step_type: "implement",
      status: "running",
      started_at: new Date().toISOString(),
      signals_json: JSON.stringify([]),
    });
  };

  test("marks the task done when the step completes successfully", async () => {
    await createTestTask(db, "task-exec-1", "repo-1", "changes/feat-1", "READY");
    await createExecutionState("task-exec-1", "step-1");

    ctx.workflowService.completeStep = mock(async (task, input) => {
      await ctx.executionRepository.updateStepExecution(input.stepId, {
        status: "success",
        ended_at: new Date().toISOString(),
      });
      await ctx.executionRepository.updateExecution(input.executionId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
      await ctx.taskRepository.update(task.id, { status: "DONE" });
      return { taskStatus: "DONE" as const, step: null };
    });

    const task = await ctx.taskRepository.get("task-exec-1");
    if (!task) throw new Error("Task should exist");

    const provider = createProvider(0);

    await executeTask(
      ctx,
      task,
      {
        id: "step-1",
        type: "implement",
        promptTemplate: "Implement feature for {{task.id}}",
        signals: [],
        attempt: 1,
        iteration: 0,
      },
      {
        id: "exec-1",
        workflowId: "aop-default",
      },
      provider as never,
    );

    expect(provider.run).toHaveBeenCalled();
    expect((await ctx.taskRepository.get("task-exec-1"))?.status).toBe("DONE");
    expect((await ctx.taskRepository.get("task-exec-1"))?.worktree_path).toBeNull();
    expect(Bun.file(aopPaths.worktree("repo-1", "task-exec-1")).exists()).resolves.toBe(false);
    const branchResult = await Bun.$`git branch --list feat-1`.cwd(testRepoPath).text();
    expect(branchResult.trim()).toContain("feat-1");
    expect((await ctx.executionRepository.getExecution("exec-1"))?.status).toBe("completed");
  });

  test("marks the task blocked when the step fails", async () => {
    await createTestTask(db, "task-exec-2", "repo-1", "changes/feat-2", "READY");
    await createExecutionState("task-exec-2", "step-1");

    ctx.workflowService.completeStep = mock(async (task, input) => {
      await ctx.executionRepository.updateStepExecution(input.stepId, {
        status: "failure",
        ended_at: new Date().toISOString(),
      });
      await ctx.executionRepository.updateExecution(input.executionId, {
        status: "failed",
        completed_at: new Date().toISOString(),
      });
      await ctx.taskRepository.update(task.id, { status: "BLOCKED" });
      return {
        taskStatus: "BLOCKED" as const,
        step: null,
        error: {
          code: "max_retries_exceeded" as const,
          message: "Workflow blocked after step failure",
        },
      };
    });

    const task = await ctx.taskRepository.get("task-exec-2");
    if (!task) throw new Error("Task should exist");

    await executeTask(
      ctx,
      task,
      {
        id: "step-1",
        type: "implement",
        promptTemplate: "Implement feature",
        signals: [],
        attempt: 1,
        iteration: 0,
      },
      {
        id: "exec-1",
        workflowId: "aop-default",
      },
      createProvider(1) as never,
    );

    expect((await ctx.taskRepository.get("task-exec-2"))?.status).toBe("BLOCKED");
    expect((await ctx.executionRepository.getExecution("exec-1"))?.status).toBe("failed");
  });

  test("finalizes completion even when the task doc is already marked DONE", async () => {
    await createTestTask(db, "task-exec-3", "repo-1", "changes/feat-3", "WORKING");
    await createExecutionState("task-exec-3", "step-1");

    await ctx.taskRepository.update("task-exec-3", { status: "DONE" });
    const completeStep = mock(async () => ({ taskStatus: "DONE" as const, step: null }));
    ctx.workflowService.completeStep = completeStep;

    const logFile = join(tmpdir(), `aop-test-handle-completion-${Date.now()}.jsonl`);
    await writeFile(logFile, JSON.stringify({ type: "text", part: { text: "<aop>ALL_TASKS_DONE</aop>" } }));

    const task = await ctx.taskRepository.get("task-exec-3");
    if (!task) throw new Error("Task should exist");

    await handleAgentCompletion(
      {
        ctx,
        executorCtx: {
          task,
          repoId: "repo-1",
          repoPath: testRepoPath,
          changePath: join(testRepoPath, "changes/feat-3"),
          worktreePath: join(testRepoPath, ".worktree"),
          logsDir: tmpdir(),
          timeoutSecs: 300,
          fastMode: false,
        },
        worktreeInfo: {
          path: join(testRepoPath, ".worktree"),
          branch: "feat-3",
          baseBranch: "main",
          baseCommit: "abc123",
        },
        executionId: "exec-1",
        executionInfo: { id: "exec-1", workflowId: "aop-default" },
        prompt: "prompt",
        stepId: "step-1",
        stepCommand: {
          id: "step-1",
          type: "implement",
          promptTemplate: "prompt",
          signals: [{ name: "ALL_TASKS_DONE", description: "done" }],
          attempt: 1,
          iteration: 0,
        },
        taskId: "task-exec-3",
        repoId: "repo-1",
      },
      logFile,
      { exitCode: 0, sessionId: "session-1" },
      [{ name: "ALL_TASKS_DONE", description: "done" }],
    );

    expect(completeStep).toHaveBeenCalledTimes(1);
  });
});
