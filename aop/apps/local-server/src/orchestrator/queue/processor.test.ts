import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ExecutionInfo, StepCommand } from "@aop/common/protocol";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database, Task } from "../../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../../db/test-utils.ts";
import { SettingKey } from "../../settings/types.ts";
import { createQueueProcessor, type QueueProcessor } from "./processor.ts";

describe("QueueProcessor", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("task repository sanity check", () => {
    test("getNextExecutable returns task with preferred_workflow", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");
      await ctx.taskRepository.update("task-1", {
        preferred_workflow: "ralph-loop",
      });

      const task = await ctx.taskRepository.getNextExecutable({
        globalMax: 10,
        getRepoMax: async () => 10,
      });

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
      expect(task?.preferred_workflow).toBe("ralph-loop");
    });
  });

  describe("workflow selection", () => {
    test("passes preferred_workflow to serverSync.markTaskReady", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      // Set preferred_workflow on the task
      await ctx.taskRepository.update("task-1", {
        preferred_workflow: "ralph-loop",
      });

      // Verify task has preferred_workflow after update
      const task = await ctx.taskRepository.get("task-1");
      expect(task?.preferred_workflow).toBe("ralph-loop");

      const capturedCalls: Array<{
        taskId: string;
        repoId: string;
        options: unknown;
      }> = [];

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(
          async (taskId: string, repoId: string, options?: { workflowName?: string }) => {
            capturedCalls.push({ taskId, repoId, options });
            return {
              status: "WORKING" as const,
              step: {
                id: "step-1",
                type: "iterate",
                promptTemplate: "test",
                signals: ["TASK_COMPLETE"],
                attempt: 1,
              },
              execution: { id: "exec-1", workflowId: "workflow_ralph_loop" },
            };
          },
        ),
      };

      const mockExecuteTask = mock(
        (_task: Task, _stepCommand: StepCommand, _execution: ExecutionInfo) => {},
      );

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).not.toBeNull();
      expect(result?.id).toBe("task-1");
      expect(capturedCalls).toHaveLength(1);
      expect(capturedCalls[0]?.options).toEqual({ workflowName: "ralph-loop" });
    });

    test("passes undefined options when no preferred_workflow is set", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const capturedCalls: Array<{
        taskId: string;
        repoId: string;
        options: unknown;
      }> = [];

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(
          async (taskId: string, repoId: string, options?: { workflowName?: string }) => {
            capturedCalls.push({ taskId, repoId, options });
            return {
              status: "WORKING" as const,
              step: {
                id: "step-1",
                type: "implement",
                promptTemplate: "test",
                signals: [],
                attempt: 1,
              },
              execution: { id: "exec-1", workflowId: "workflow_simple" },
            };
          },
        ),
      };

      const mockExecuteTask = mock(
        (_task: Task, _stepCommand: StepCommand, _execution: ExecutionInfo) => {},
      );

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).not.toBeNull();
      expect(capturedCalls).toHaveLength(1);
      expect(capturedCalls[0]?.options).toBeUndefined();
    });
  });

  describe("double-dequeue prevention", () => {
    test("marks task WORKING immediately so second processOnce cannot pick it up", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => ({
          status: "WORKING" as const,
          step: {
            id: "step-1",
            type: "iterate",
            promptTemplate: "test",
            signals: ["TASK_COMPLETE"],
            attempt: 1,
          },
          execution: { id: "exec-1", workflowId: "workflow_simple" },
        })),
      };

      const mockExecuteTask = mock(
        (_task: Task, _stepCommand: StepCommand, _execution: ExecutionInfo) => {},
      );

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const first = await processor.processOnce();
      expect(first).not.toBeNull();
      expect(first?.id).toBe("task-1");

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("WORKING");

      const second = await processor.processOnce();
      expect(second).toBeNull();
      expect(mockExecuteTask).toHaveBeenCalledTimes(1);
    });

    test("reverts task to READY when server returns queued", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => ({
          status: "QUEUED" as const,
          queued: true,
        })),
      };

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();
      expect(result).toBeNull();

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("READY");
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });

    test("reverts task to READY when server connection fails", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => {
          throw new Error("Connection failed");
        }),
      };

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();
      expect(result).toBeNull();

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("READY");
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });

    test("reverts task to READY when server response is incomplete", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => ({
          status: "WORKING" as const,
          execution: { id: "exec-1", workflowId: "workflow_simple" },
        })),
      };

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();
      expect(result).toBeNull();

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("READY");
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });
  });

  describe("processOnce edge cases", () => {
    test("returns null when no executable task exists", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).toBeNull();
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });

    test("returns null when serverSync is not provided", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).toBeNull();
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });

    test("returns null when serverSync is degraded", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        isDegraded: () => true,
        markTaskReady: mock(async () => ({})),
      };

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).toBeNull();
      expect(mockServerSync.markTaskReady).not.toHaveBeenCalled();
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });

    test("returns null when serverSync.markTaskReady throws", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => {
          throw new Error("Connection failed");
        }),
      };

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).toBeNull();
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });

    test("returns null when task is queued by server", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => ({
          status: "QUEUED" as const,
          queued: true,
        })),
      };

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).toBeNull();
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });

    test("returns null when server response is incomplete (missing step)", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => ({
          status: "WORKING" as const,
          execution: { id: "exec-1", workflowId: "workflow_simple" },
        })),
      };

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).toBeNull();
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });

    test("returns null when server response is incomplete (missing execution)", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => ({
          status: "WORKING" as const,
          step: {
            id: "step-1",
            type: "implement",
            promptTemplate: "test",
            signals: [],
            attempt: 1,
          },
        })),
      };

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).toBeNull();
      expect(mockExecuteTask).not.toHaveBeenCalled();
    });
  });

  describe("retry_from_step", () => {
    test("passes retryFromStep to serverSync.markTaskReady when set on task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");
      await ctx.taskRepository.update("task-1", { retry_from_step: "full-review" });

      const capturedCalls: Array<{ options: unknown }> = [];
      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async (_taskId: string, _repoId: string, options?: unknown) => {
          capturedCalls.push({ options });
          return {
            status: "WORKING" as const,
            step: {
              id: "step-1",
              type: "iterate",
              promptTemplate: "test",
              signals: [],
              attempt: 1,
            },
            execution: { id: "exec-1", workflowId: "workflow_aop_default" },
          };
        }),
      };

      const mockExecuteTask = mock(
        (_task: Task, _stepCommand: StepCommand, _execution: ExecutionInfo) => {},
      );

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).not.toBeNull();
      expect(capturedCalls).toHaveLength(1);
      expect(capturedCalls[0]?.options).toEqual({
        retryFromStep: "full-review",
      });

      // retry_from_step should be cleared after execution starts
      const task = await ctx.taskRepository.get("task-1");
      expect(task?.retry_from_step).toBeNull();
    });
  });

  describe("resume processing", () => {
    test("picks up RESUMING task and calls serverSync.resumeStep", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "RESUMING");
      await ctx.taskRepository.update("task-1", { resume_input: "Approved" });

      // Create execution + step for getLatestStepExecution
      await db
        .insertInto("executions")
        .values({
          id: "exec-1",
          task_id: "task-1",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .execute();
      await db
        .insertInto("step_executions")
        .values({
          id: "step-1",
          execution_id: "exec-1",
          step_type: "iterate",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .execute();

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => ({})),
        resumeStep: mock(async () => ({
          taskStatus: "WORKING" as const,
          step: { id: "step-2", type: "iterate", promptTemplate: "test", signals: [], attempt: 1 },
          execution: { id: "exec-1", workflowId: "workflow_aop_default" },
        })),
      };

      const mockExecuteTask = mock(
        (_task: Task, _stepCommand: StepCommand, _execution: ExecutionInfo) => {},
      );

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).not.toBeNull();
      expect(result?.id).toBe("task-1");
      expect(mockServerSync.resumeStep).toHaveBeenCalledWith("step-1", "Approved");
      expect(mockExecuteTask).toHaveBeenCalledTimes(1);

      // resume_input should be cleared after execution starts
      const task = await ctx.taskRepository.get("task-1");
      expect(task?.resume_input).toBeNull();
    });

    test("keeps task in RESUMING when server is degraded", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "RESUMING");
      await ctx.taskRepository.update("task-1", { resume_input: "Approved" });

      const mockServerSync = {
        isDegraded: () => true,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => ({})),
        resumeStep: mock(async () => ({})),
      };

      const mockExecuteTask = mock(() => {});

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result).toBeNull();
      expect(mockServerSync.resumeStep).not.toHaveBeenCalled();
      expect(mockExecuteTask).not.toHaveBeenCalled();

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("RESUMING");
      expect(task?.resume_input).toBe("Approved");
    });

    test("prioritizes RESUMING tasks over READY tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-ready", "repo-1", "changes/feat-1", "READY");
      await createTestTask(db, "task-resume", "repo-1", "changes/feat-2", "RESUMING");
      await ctx.taskRepository.update("task-resume", { resume_input: "Go" });

      await db
        .insertInto("executions")
        .values({
          id: "exec-1",
          task_id: "task-resume",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .execute();
      await db
        .insertInto("step_executions")
        .values({
          id: "step-1",
          execution_id: "exec-1",
          step_type: "iterate",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .execute();

      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => ({
          status: "WORKING" as const,
          step: {
            id: "step-new",
            type: "implement",
            promptTemplate: "test",
            signals: [],
            attempt: 1,
          },
          execution: { id: "exec-2", workflowId: "workflow_simple" },
        })),
        resumeStep: mock(async () => ({
          taskStatus: "WORKING" as const,
          step: { id: "step-2", type: "iterate", promptTemplate: "test", signals: [], attempt: 1 },
          execution: { id: "exec-1", workflowId: "workflow_aop_default" },
        })),
      };

      const executedTaskIds: string[] = [];
      const mockExecuteTask = mock(
        (task: Task, _stepCommand: StepCommand, _execution: ExecutionInfo) => {
          executedTaskIds.push(task.id);
        },
      );

      const processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 100 },
      );

      const result = await processor.processOnce();

      expect(result?.id).toBe("task-resume");
      expect(executedTaskIds[0]).toBe("task-resume");
    });
  });

  describe("lifecycle", () => {
    let processor: QueueProcessor;

    afterEach(() => {
      processor?.stop();
    });

    test("start sets running state and stop clears it", async () => {
      const mockExecuteTask = mock(() => {});

      processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 10000 },
      );

      expect(processor.isRunning()).toBe(false);

      await processor.start();
      expect(processor.isRunning()).toBe(true);

      processor.stop();
      expect(processor.isRunning()).toBe(false);
    });

    test("start does nothing if already running", async () => {
      const mockExecuteTask = mock(() => {});

      processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 10000 },
      );

      await processor.start();
      expect(processor.isRunning()).toBe(true);

      await processor.start();
      expect(processor.isRunning()).toBe(true);
    });

    test("uses poll interval from settings when config not provided", async () => {
      await ctx.settingsRepository.set(SettingKey.QUEUE_POLL_INTERVAL_SECS, "5");

      const mockExecuteTask = mock(() => {});

      processor = createQueueProcessor({
        taskRepository: ctx.taskRepository,
        repoRepository: ctx.repoRepository,
        settingsRepository: ctx.settingsRepository,
        executionRepository: ctx.executionRepository,
        executeTask: mockExecuteTask,
      });

      await processor.start();
      expect(processor.isRunning()).toBe(true);

      processor.stop();
      expect(processor.isRunning()).toBe(false);
    });

    test("loop continues processing until stopped", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");

      let processCount = 0;
      const mockServerSync = {
        isDegraded: () => false,
        isTaskQueued: () => false,
        markTaskReady: mock(async () => {
          processCount++;
          return { queued: true };
        }),
      };

      const mockExecuteTask = mock(() => {});

      processor = createQueueProcessor(
        {
          taskRepository: ctx.taskRepository,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          serverSync: mockServerSync as never,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 10 },
      );

      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      await processor.start();

      await new Promise((r) => setTimeout(r, 50));

      processor.stop();

      expect(processCount).toBeGreaterThan(1);
    });

    test("loop handles errors gracefully", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      let errorCount = 0;
      const mockTaskRepository = {
        ...ctx.taskRepository,
        getNextExecutable: async () => {
          errorCount++;
          if (errorCount <= 2) {
            throw new Error("Database error");
          }
          return null;
        },
      };

      const mockExecuteTask = mock(() => {});

      processor = createQueueProcessor(
        {
          taskRepository: mockTaskRepository as never,
          repoRepository: ctx.repoRepository,
          settingsRepository: ctx.settingsRepository,
          executionRepository: ctx.executionRepository,
          executeTask: mockExecuteTask,
        },
        { pollIntervalMs: 10 },
      );

      await processor.start();

      await new Promise((r) => setTimeout(r, 60));

      processor.stop();

      expect(errorCount).toBeGreaterThan(2);
    });
  });
});
