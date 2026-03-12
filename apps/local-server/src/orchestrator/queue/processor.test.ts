import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  ExecutionInfo,
  StepCommand,
  StepCompleteResponse,
  TaskReadyResponse,
} from "@aop/common/protocol";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database, Task } from "../../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../../db/test-utils.ts";
import { SettingKey } from "../../settings/types.ts";
import { createQueueProcessor } from "./processor.ts";

describe("QueueProcessor", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  const waitFor = async (
    predicate: () => Promise<boolean>,
    { timeoutMs = 500, pollIntervalMs = 5 }: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await predicate()) {
        return;
      }

      await Bun.sleep(pollIntervalMs);
    }

    throw new Error(`Condition not met within ${timeoutMs}ms`);
  };

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const createResolvedStep = (): { step: StepCommand; execution: ExecutionInfo } => ({
    step: {
      id: "step-1",
      type: "implement",
      promptTemplate: "Implement the task",
      signals: [],
      attempt: 1,
      iteration: 0,
    },
    execution: { id: "exec-1", workflowId: "aop-default" },
  });

  test("starts the next READY task with the local workflow service", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");
    await ctx.taskRepository.update("task-1", {
      preferred_workflow: "simple",
      retry_from_step: "draft_plan",
    });

    const resolved = createResolvedStep();
    const workflowService = {
      listWorkflows: mock(async () => ["aop-default", "simple"]),
      startTask: mock(
        async (): Promise<TaskReadyResponse> => ({
          status: "WORKING",
          ...resolved,
        }),
      ),
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
      resumeTask: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
    };
    const executeTask = mock(
      (_task: Task, _stepCommand: StepCommand, _execution: ExecutionInfo) => undefined,
    );

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        executionRepository: ctx.executionRepository,
        workflowService,
        executeTask,
      },
      { pollIntervalMs: 10 },
    );

    const task = await processor.processOnce();

    expect(task?.id).toBe("task-1");
    expect(workflowService.startTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
    );
    expect(executeTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      resolved.step,
      resolved.execution,
      "READY",
    );
    expect((await ctx.taskRepository.get("task-1"))?.retry_from_step).toBeNull();
  });

  test("reverts task to READY when workflow start does not return a runnable step", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

    const workflowService = {
      listWorkflows: mock(async () => ["aop-default"]),
      startTask: mock(
        async (): Promise<TaskReadyResponse> => ({
          status: "READY",
          queued: true,
          message: "No step available",
        }),
      ),
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
      resumeTask: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
    };
    const executeTask = mock(() => undefined);

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        executionRepository: ctx.executionRepository,
        workflowService,
        executeTask,
      },
      { pollIntervalMs: 10 },
    );

    const result = await processor.processOnce();

    expect(result).toBeNull();
    expect(executeTask).not.toHaveBeenCalled();
    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("READY");
  });

  test("skips READY tasks waiting on dependencies and starts an unrelated READY task", async () => {
    await createTestRepo(db, "repo-1", "/test/repo", { maxConcurrentTasks: 3 });
    await ctx.settingsRepository.set(SettingKey.MAX_CONCURRENT_TASKS, "3");
    await createTestTask(db, "task-upstream", "repo-1", "changes/upstream", "WORKING");
    await createTestTask(db, "task-blocked", "repo-1", "changes/blocked", "READY");
    await ctx.taskRepository.update("task-blocked", {
      status: "READY",
      ready_at: new Date(Date.now() - 2_000).toISOString(),
    });
    await createTestTask(db, "task-unrelated", "repo-1", "changes/unrelated", "READY");
    await ctx.taskRepository.update("task-unrelated", {
      status: "READY",
      ready_at: new Date(Date.now() - 1_000).toISOString(),
    });
    await ctx.linearStore.replaceTaskDependencies("task-blocked", ["task-upstream"]);

    const resolved = createResolvedStep();
    const workflowService = {
      listWorkflows: mock(async () => ["aop-default"]),
      startTask: mock(
        async (): Promise<TaskReadyResponse> => ({
          status: "WORKING",
          ...resolved,
        }),
      ),
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
      resumeTask: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
    };
    const executeTask = mock(
      (_task: Task, _stepCommand: StepCommand, _execution: ExecutionInfo) => undefined,
    );

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        executionRepository: ctx.executionRepository,
        workflowService,
        executeTask,
      },
      { pollIntervalMs: 10 },
    );

    const task = await processor.processOnce();

    expect(task?.id).toBe("task-unrelated");
    expect(workflowService.startTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-unrelated" }),
    );
    expect(workflowService.startTask).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-blocked" }),
    );
  });

  test("resumes the next RESUMING task using the latest awaiting-input step", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "RESUMING");
    await ctx.taskRepository.update("task-1", { resume_input: "Continue with user input" });
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      workflow_id: "aop-default",
      status: "running",
      visited_steps: JSON.stringify(["draft_plan"]),
      iteration: 0,
      started_at: new Date().toISOString(),
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-awaiting",
      execution_id: "exec-1",
      step_id: "draft_plan",
      step_type: "implement",
      status: "awaiting_input",
      started_at: new Date().toISOString(),
    });

    const resolved = createResolvedStep();
    const workflowService = {
      listWorkflows: mock(async () => ["aop-default"]),
      startTask: mock(async (): Promise<TaskReadyResponse> => ({ status: "DONE" })),
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
      resumeTask: mock(
        async (): Promise<StepCompleteResponse> => ({
          taskStatus: "WORKING",
          ...resolved,
        }),
      ),
    };
    const executeTask = mock(
      (_task: Task, _stepCommand: StepCommand, _execution: ExecutionInfo) => undefined,
    );

    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        executionRepository: ctx.executionRepository,
        workflowService,
        executeTask,
      },
      { pollIntervalMs: 10 },
    );

    const task = await processor.processOnce();

    expect(task?.id).toBe("task-1");
    expect(workflowService.resumeTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      "step-awaiting",
      "Continue with user input",
    );
    expect((await ctx.taskRepository.get("task-1"))?.resume_input).toBeNull();
    expect(executeTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      resolved.step,
      resolved.execution,
      "BLOCKED",
    );
  });

  test("reverts a RESUMING task when resume_input is missing", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "RESUMING");

    const workflowService = {
      listWorkflows: mock(async () => ["aop-default"]),
      startTask: mock(async (): Promise<TaskReadyResponse> => ({ status: "DONE" })),
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
      resumeTask: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
    };
    const executeTask = mock(() => undefined);
    const processor = createQueueProcessor({
      taskRepository: ctx.taskRepository,
      repoRepository: ctx.repoRepository,
      settingsRepository: ctx.settingsRepository,
      executionRepository: ctx.executionRepository,
      workflowService,
      executeTask,
    });

    const result = await processor.processOnce();

    expect(result).toBeNull();
    expect(workflowService.resumeTask).not.toHaveBeenCalled();
    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("RESUMING");
  });

  test("reverts a RESUMING task when no awaiting-input step exists", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "RESUMING");
    await ctx.taskRepository.update("task-1", { resume_input: "continue" });

    const workflowService = {
      listWorkflows: mock(async () => ["aop-default"]),
      startTask: mock(async (): Promise<TaskReadyResponse> => ({ status: "DONE" })),
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
      resumeTask: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
    };
    const executeTask = mock(() => undefined);
    const processor = createQueueProcessor({
      taskRepository: ctx.taskRepository,
      repoRepository: ctx.repoRepository,
      settingsRepository: ctx.settingsRepository,
      executionRepository: ctx.executionRepository,
      workflowService,
      executeTask,
    });

    const result = await processor.processOnce();

    expect(result).toBeNull();
    expect(workflowService.resumeTask).not.toHaveBeenCalled();
    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("RESUMING");
  });

  test("reverts a READY task when workflow start throws", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

    const workflowService = {
      listWorkflows: mock(async () => ["aop-default"]),
      startTask: mock(async (): Promise<TaskReadyResponse> => {
        throw new Error("boom");
      }),
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
      resumeTask: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
    };
    const executeTask = mock(() => undefined);
    const processor = createQueueProcessor({
      taskRepository: ctx.taskRepository,
      repoRepository: ctx.repoRepository,
      settingsRepository: ctx.settingsRepository,
      executionRepository: ctx.executionRepository,
      workflowService,
      executeTask,
    });

    await expect(processor.processOnce()).rejects.toThrow("boom");
    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("READY");
  });

  test("reverts a RESUMING task when resumeTask throws", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "RESUMING");
    await ctx.taskRepository.update("task-1", { resume_input: "continue" });
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      workflow_id: "aop-default",
      status: "running",
      visited_steps: JSON.stringify(["draft_plan"]),
      iteration: 0,
      started_at: new Date().toISOString(),
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-awaiting",
      execution_id: "exec-1",
      step_id: "draft_plan",
      step_type: "implement",
      status: "awaiting_input",
      started_at: new Date().toISOString(),
    });

    const workflowService = {
      listWorkflows: mock(async () => ["aop-default"]),
      startTask: mock(async (): Promise<TaskReadyResponse> => ({ status: "DONE" })),
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
      resumeTask: mock(async (): Promise<StepCompleteResponse> => {
        throw new Error("boom");
      }),
    };
    const executeTask = mock(() => undefined);
    const processor = createQueueProcessor({
      taskRepository: ctx.taskRepository,
      repoRepository: ctx.repoRepository,
      settingsRepository: ctx.settingsRepository,
      executionRepository: ctx.executionRepository,
      workflowService,
      executeTask,
    });

    await expect(processor.processOnce()).rejects.toThrow("boom");
    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("RESUMING");
  });

  test("starts, ignores duplicate starts, and keeps running after loop errors until stopped", async () => {
    await createTestRepo(db, "repo-1", "/test/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

    const workflowService = {
      listWorkflows: mock(async () => ["aop-default"]),
      startTask: mock(async (): Promise<TaskReadyResponse> => {
        throw new Error("loop failure");
      }),
      completeStep: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
      resumeTask: mock(
        async (): Promise<StepCompleteResponse> => ({ taskStatus: "DONE", step: null }),
      ),
    };
    const executeTask = mock(() => undefined);
    const processor = createQueueProcessor(
      {
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        executionRepository: ctx.executionRepository,
        workflowService,
        executeTask,
      },
      { pollIntervalMs: 5 },
    );

    await processor.start();
    await processor.start();
    expect(processor.isRunning()).toBe(true);

    await waitFor(async () => (await ctx.taskRepository.get("task-1"))?.status === "READY");

    expect((await ctx.taskRepository.get("task-1"))?.status).toBe("READY");
    expect(processor.isRunning()).toBe(true);

    processor.stop();
    expect(processor.isRunning()).toBe(false);
  });
});
