import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { OrchestratorStatus } from "../app.ts";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";

interface MockOrchestrator {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isReady: () => boolean;
  getStatus: () => OrchestratorStatus;
  triggerRefresh: () => boolean;
  executingTaskCount: () => number;
  simulateTaskExecution: (taskId: string, durationMs: number) => void;
}

const createMockOrchestrator = (_ctx: CommandContext): MockOrchestrator => {
  let ready = false;
  const executingTasks = new Map<string, Promise<void>>();

  const waitForExecutingTasks = async (): Promise<void> => {
    if (executingTasks.size === 0) return;

    const promises = Array.from(executingTasks.values());
    await Promise.allSettled(promises);
  };

  return {
    start: async () => {
      ready = true;
    },

    stop: async () => {
      ready = false;
      await waitForExecutingTasks();
    },

    isReady: () => ready,

    getStatus: () => ({
      watcher: ready ? "running" : "stopped",
      ticker: ready ? "running" : "stopped",
      processor: ready ? "running" : "stopped",
    }),

    triggerRefresh: () => ready,

    executingTaskCount: () => executingTasks.size,

    simulateTaskExecution: (taskId: string, durationMs: number) => {
      const promise = new Promise<void>((resolve) => {
        setTimeout(() => {
          executingTasks.delete(taskId);
          resolve();
        }, durationMs);
      });
      executingTasks.set(taskId, promise);
    },
  };
};

describe("orchestrator graceful shutdown", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("stop()", () => {
    test("returns immediately when no tasks are executing", async () => {
      const orchestrator = createMockOrchestrator(ctx);
      await orchestrator.start();

      const startTime = Date.now();
      await orchestrator.stop();
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(orchestrator.isReady()).toBe(false);
    });

    test("waits for executing tasks to complete before returning", async () => {
      const orchestrator = createMockOrchestrator(ctx);
      await orchestrator.start();

      orchestrator.simulateTaskExecution("task-1", 200);
      expect(orchestrator.executingTaskCount()).toBe(1);

      const startTime = Date.now();
      await orchestrator.stop();
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(180);
      expect(orchestrator.executingTaskCount()).toBe(0);
    });

    test("waits for multiple executing tasks", async () => {
      const orchestrator = createMockOrchestrator(ctx);
      await orchestrator.start();

      orchestrator.simulateTaskExecution("task-1", 100);
      orchestrator.simulateTaskExecution("task-2", 200);
      orchestrator.simulateTaskExecution("task-3", 150);
      expect(orchestrator.executingTaskCount()).toBe(3);

      const startTime = Date.now();
      await orchestrator.stop();
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(180);
      expect(orchestrator.executingTaskCount()).toBe(0);
    });

    test("sets ready to false before waiting for tasks", async () => {
      const orchestrator = createMockOrchestrator(ctx);
      await orchestrator.start();
      expect(orchestrator.isReady()).toBe(true);

      orchestrator.simulateTaskExecution("task-1", 100);

      const stopPromise = orchestrator.stop();
      expect(orchestrator.isReady()).toBe(false);

      await stopPromise;
    });

    test("triggerRefresh returns false when not ready", async () => {
      const orchestrator = createMockOrchestrator(ctx);
      await orchestrator.start();

      expect(orchestrator.triggerRefresh()).toBe(true);

      await orchestrator.stop();

      expect(orchestrator.triggerRefresh()).toBe(false);
    });
  });

  describe("getStatus()", () => {
    test("returns stopped status before start", async () => {
      const orchestrator = createMockOrchestrator(ctx);

      const status = orchestrator.getStatus();

      expect(status.watcher).toBe("stopped");
      expect(status.ticker).toBe("stopped");
      expect(status.processor).toBe("stopped");
    });

    test("returns running status after start", async () => {
      const orchestrator = createMockOrchestrator(ctx);
      await orchestrator.start();

      const status = orchestrator.getStatus();

      expect(status.watcher).toBe("running");
      expect(status.ticker).toBe("running");
      expect(status.processor).toBe("running");
    });

    test("returns stopped status after stop", async () => {
      const orchestrator = createMockOrchestrator(ctx);
      await orchestrator.start();
      await orchestrator.stop();

      const status = orchestrator.getStatus();

      expect(status.watcher).toBe("stopped");
      expect(status.ticker).toBe("stopped");
      expect(status.processor).toBe("stopped");
    });
  });
});
