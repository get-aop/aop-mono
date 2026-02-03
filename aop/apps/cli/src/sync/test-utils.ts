import type { TaskStatus } from "@aop/common/protocol";
import type { ServerSync } from "./server-sync.ts";

export const createMockServerSync = (overrides: Partial<ServerSync> = {}): ServerSync => {
  return {
    authenticate: async () => ({
      clientId: "test-client",
      effectiveMaxConcurrentTasks: 5,
    }),
    syncRepo: async () => {},
    syncTask: async () => {},
    markTaskReady: async (
      taskId: string,
      _repoId: string,
      _options?: { workflowName?: string },
    ) => ({
      status: "WORKING" as TaskStatus,
      execution: { id: `exec_${taskId}`, workflowId: "workflow_test" },
      step: {
        id: `step_${taskId}`,
        type: "implement",
        promptTemplate: "Test prompt for {{ task.id }}",
        attempt: 1,
      },
    }),
    completeStep: async () => ({
      taskStatus: "DONE" as TaskStatus,
      step: null,
    }),
    getTaskStatus: async () => ({
      status: "WORKING" as TaskStatus,
      execution: { id: "exec_test", currentStepId: "step_test", awaitingResult: true },
    }),
    isDegraded: () => false,
    getQueuedReadyTasks: () => [],
    retryQueuedReadyTasks: async () => {},
    flushOfflineQueue: async () => {},
    getOfflineQueueSize: () => 0,
    ...overrides,
  };
};
