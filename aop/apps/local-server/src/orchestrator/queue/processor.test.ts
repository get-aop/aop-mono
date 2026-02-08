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
