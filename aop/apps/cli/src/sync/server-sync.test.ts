import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDegradedServerSync,
  createServerSync,
  type ServerSync,
  type ServerSyncConfig,
} from "./server-sync.ts";

interface FetchCall {
  url: string;
  options: RequestInit;
}

const createMockFetch = () => {
  const calls: FetchCall[] = [];
  let nextResponse: { status: number; body: unknown } = { status: 200, body: { ok: true } };

  const mockFn = mock(async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return {
      ok: nextResponse.status >= 200 && nextResponse.status < 300,
      status: nextResponse.status,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify(nextResponse.body),
      json: async () => nextResponse.body,
    };
  });

  const getCall = (index: number): FetchCall => {
    const call = calls[index];
    if (!call) throw new Error(`No call at index ${index}`);
    return call;
  };

  return {
    fn: mockFn as unknown as typeof fetch,
    calls,
    getCall,
    setResponse: (status: number, body: unknown) => {
      nextResponse = { status, body };
    },
  };
};

describe("ServerSync", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;
  let originalFetch: typeof fetch;
  let sync: ServerSync;

  const config: ServerSyncConfig = {
    serverUrl: "https://api.test.com",
    apiKey: "test_key_123",
    maxRetries: 2,
    initialRetryDelayMs: 10,
  };

  beforeEach(() => {
    mockFetch = createMockFetch();
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch.fn;
    sync = createServerSync(config);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("authenticate", () => {
    test("sends POST request with authorization header", async () => {
      mockFetch.setResponse(200, {
        clientId: "client_abc",
        effectiveMaxConcurrentTasks: 5,
      });

      const result = await sync.authenticate();

      expect(mockFetch.calls.length).toBe(1);
      expect(mockFetch.getCall(0).url).toBe("https://api.test.com/auth");
      expect(mockFetch.getCall(0).options.method).toBe("POST");
      expect(mockFetch.getCall(0).options.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer test_key_123",
      });
      expect(result.clientId).toBe("client_abc");
      expect(result.effectiveMaxConcurrentTasks).toBe(5);
    });

    test("sends requestedMaxConcurrentTasks when provided", async () => {
      mockFetch.setResponse(200, {
        clientId: "client_abc",
        effectiveMaxConcurrentTasks: 3,
      });

      await sync.authenticate({ requestedMaxConcurrentTasks: 3 });

      const body = JSON.parse(mockFetch.getCall(0).options.body as string);
      expect(body.requestedMaxConcurrentTasks).toBe(3);
    });

    test("enters degraded mode on authentication failure", async () => {
      mockFetch.setResponse(401, { error: "Invalid API key" });

      expect(sync.isDegraded()).toBe(false);

      await expect(sync.authenticate()).rejects.toThrow();

      expect(sync.isDegraded()).toBe(true);
    });

    test("exits degraded mode on successful authentication", async () => {
      mockFetch.setResponse(401, { error: "Invalid API key" });
      await expect(sync.authenticate()).rejects.toThrow();
      expect(sync.isDegraded()).toBe(true);

      mockFetch.setResponse(200, {
        clientId: "client_abc",
        effectiveMaxConcurrentTasks: 5,
      });
      await sync.authenticate();

      expect(sync.isDegraded()).toBe(false);
    });
  });

  describe("syncRepo", () => {
    test("sends POST request with syncedAt timestamp", async () => {
      mockFetch.setResponse(200, { ok: true });

      await sync.syncRepo("repo_123");

      expect(mockFetch.calls.length).toBe(1);
      expect(mockFetch.getCall(0).url).toBe("https://api.test.com/repos/repo_123/sync");
      expect(mockFetch.getCall(0).options.method).toBe("POST");

      const body = JSON.parse(mockFetch.getCall(0).options.body as string);
      expect(body.syncedAt).toBeDefined();
      expect(new Date(body.syncedAt).getTime()).toBeGreaterThan(0);
    });

    test("queues request in degraded mode", async () => {
      mockFetch.setResponse(401, { error: "Invalid API key" });
      await expect(sync.authenticate()).rejects.toThrow();
      expect(sync.isDegraded()).toBe(true);

      mockFetch.calls.length = 0;

      await sync.syncRepo("repo_123");

      expect(mockFetch.calls.length).toBe(0);
      expect(sync.getOfflineQueueSize()).toBe(1);
    });

    test("queues request on network failure", async () => {
      mockFetch.setResponse(500, { error: "Server error" });

      await sync.syncRepo("repo_123");

      expect(sync.getOfflineQueueSize()).toBe(1);
    });
  });

  describe("syncTask", () => {
    test("sends POST request with task data", async () => {
      mockFetch.setResponse(200, { ok: true });

      await sync.syncTask("task_123", "repo_456", "READY");

      expect(mockFetch.calls.length).toBe(1);
      expect(mockFetch.getCall(0).url).toBe("https://api.test.com/tasks/task_123/sync");

      const body = JSON.parse(mockFetch.getCall(0).options.body as string);
      expect(body.repoId).toBe("repo_456");
      expect(body.status).toBe("READY");
      expect(body.syncedAt).toBeDefined();
    });

    test("queues request in degraded mode", async () => {
      mockFetch.setResponse(401, { error: "Invalid API key" });
      await expect(sync.authenticate()).rejects.toThrow();

      mockFetch.calls.length = 0;

      await sync.syncTask("task_123", "repo_456", "READY");

      expect(mockFetch.calls.length).toBe(0);
      expect(sync.getOfflineQueueSize()).toBe(1);
    });
  });

  describe("markTaskReady", () => {
    test("sends POST request and returns step command", async () => {
      mockFetch.setResponse(200, {
        status: "WORKING",
        execution: { id: "exec_123", workflowId: "wf_456" },
        step: {
          id: "step_789",
          type: "implement",
          promptTemplate: "Implement {{ task.description }}",
          attempt: 1,
        },
      });

      const result = await sync.markTaskReady("task_123", "repo_456");

      expect(result.status).toBe("WORKING");
      expect(result.execution?.id).toBe("exec_123");
      expect(result.step?.id).toBe("step_789");
      expect(result.step?.type).toBe("implement");
    });

    test("tracks queued tasks when server returns queued: true", async () => {
      mockFetch.setResponse(200, {
        status: "READY",
        queued: true,
        message: "At max concurrent tasks",
      });

      const result = await sync.markTaskReady("task_123", "repo_456");

      expect(result.queued).toBe(true);
      expect(sync.getQueuedReadyTasks()).toContain("task_123");
    });

    test("removes from queued tasks when not queued", async () => {
      mockFetch.setResponse(200, {
        status: "READY",
        queued: true,
        message: "At max concurrent tasks",
      });
      await sync.markTaskReady("task_123", "repo_456");
      expect(sync.getQueuedReadyTasks()).toContain("task_123");

      mockFetch.setResponse(200, {
        status: "WORKING",
        execution: { id: "exec_123", workflowId: "wf_456" },
        step: { id: "step_789", type: "implement", promptTemplate: "test", attempt: 1 },
      });
      await sync.markTaskReady("task_123", "repo_456");

      expect(sync.getQueuedReadyTasks()).not.toContain("task_123");
    });

    test("returns queued result in degraded mode", async () => {
      mockFetch.setResponse(401, { error: "Invalid API key" });
      await expect(sync.authenticate()).rejects.toThrow();

      const result = await sync.markTaskReady("task_123", "repo_456");

      expect(result.status).toBe("READY");
      expect(result.queued).toBe(true);
      expect(result.message).toContain("Offline");
    });
  });

  describe("completeStep", () => {
    test("sends POST request with step result", async () => {
      mockFetch.setResponse(200, {
        taskStatus: "WORKING",
        step: {
          id: "step_next",
          type: "test",
          promptTemplate: "Run tests",
          attempt: 1,
        },
      });

      const result = await sync.completeStep("step_123", {
        executionId: "exec_456",
        attempt: 1,
        status: "success",
        durationMs: 60000,
      });

      expect(mockFetch.getCall(0).url).toBe("https://api.test.com/steps/step_123/complete");

      const body = JSON.parse(mockFetch.getCall(0).options.body as string);
      expect(body.executionId).toBe("exec_456");
      expect(body.attempt).toBe(1);
      expect(body.status).toBe("success");
      expect(body.durationMs).toBe(60000);

      expect(result.taskStatus).toBe("WORKING");
      expect(result.step?.id).toBe("step_next");
    });

    test("sends error details on failure", async () => {
      mockFetch.setResponse(200, {
        taskStatus: "BLOCKED",
        step: null,
        error: { code: "max_retries_exceeded", message: "Step failed after 3 attempts" },
      });

      const result = await sync.completeStep("step_123", {
        executionId: "exec_456",
        attempt: 3,
        status: "failure",
        error: { code: "agent_timeout", message: "Agent timed out" },
        durationMs: 300000,
      });

      const body = JSON.parse(mockFetch.getCall(0).options.body as string);
      expect(body.status).toBe("failure");
      expect(body.error.code).toBe("agent_timeout");

      expect(result.taskStatus).toBe("BLOCKED");
      expect(result.step).toBeNull();
    });

    test("sends signal when provided", async () => {
      mockFetch.setResponse(200, {
        taskStatus: "WORKING",
        step: {
          id: "step_next",
          type: "iterate",
          promptTemplate: "Continue iteration",
          attempt: 1,
        },
      });

      await sync.completeStep("step_123", {
        executionId: "exec_456",
        attempt: 1,
        status: "success",
        signal: "TASK_COMPLETE",
        durationMs: 60000,
      });

      const body = JSON.parse(mockFetch.getCall(0).options.body as string);
      expect(body.signal).toBe("TASK_COMPLETE");
    });

    test("triggers queued task retry on terminal status", async () => {
      mockFetch.setResponse(200, {
        status: "READY",
        queued: true,
        message: "At capacity",
      });
      await sync.markTaskReady("queued_task", "repo_123");
      expect(sync.getQueuedReadyTasks()).toContain("queued_task");

      mockFetch.setResponse(200, {
        taskStatus: "DONE",
        step: null,
      });

      await sync.completeStep("step_123", {
        executionId: "exec_456",
        attempt: 1,
        status: "success",
        durationMs: 60000,
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(sync.getQueuedReadyTasks()).not.toContain("queued_task");
    });
  });

  describe("getTaskStatus", () => {
    test("sends GET request and returns status", async () => {
      mockFetch.setResponse(200, {
        status: "WORKING",
        execution: {
          id: "exec_123",
          currentStepId: "step_456",
          awaitingResult: true,
        },
      });

      const result = await sync.getTaskStatus("task_123");

      expect(mockFetch.getCall(0).url).toBe("https://api.test.com/tasks/task_123/status");
      expect(mockFetch.getCall(0).options.method).toBe("GET");
      expect(result.status).toBe("WORKING");
      expect(result.execution?.awaitingResult).toBe(true);
    });
  });

  describe("retry with exponential backoff", () => {
    test("retries failed requests with increasing delays", async () => {
      let callCount = 0;
      globalThis.fetch = mock(async () => {
        callCount++;
        if (callCount < 2) {
          return {
            ok: false,
            status: 500,
            headers: new Headers({ "content-type": "application/json" }),
            text: async () => "Server error",
            json: async () => ({ error: "Server error" }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({ clientId: "c1", effectiveMaxConcurrentTasks: 5 }),
          json: async () => ({ clientId: "c1", effectiveMaxConcurrentTasks: 5 }),
        };
      }) as unknown as typeof fetch;

      const result = await sync.authenticate();

      expect(callCount).toBe(2);
      expect(result.clientId).toBe("c1");
    });

    test("fails after max retries", async () => {
      mockFetch.setResponse(500, { error: "Server error" });

      await expect(sync.authenticate()).rejects.toThrow("HTTP 500");
      expect(mockFetch.calls.length).toBe(2);
    });
  });

  describe("offline queue", () => {
    test("flushes queued requests when connection restored", async () => {
      mockFetch.setResponse(401, { error: "Invalid API key" });
      await expect(sync.authenticate()).rejects.toThrow();

      await sync.syncRepo("repo_1");
      await sync.syncTask("task_1", "repo_1", "READY");

      expect(sync.getOfflineQueueSize()).toBe(2);

      mockFetch.setResponse(200, { ok: true });

      await sync.flushOfflineQueue();

      expect(sync.getOfflineQueueSize()).toBe(0);
      expect(
        mockFetch.calls.filter((c) => c.url.includes("repo_1") || c.url.includes("task_1")).length,
      ).toBe(2);
    });
  });
});

describe("createDegradedServerSync", () => {
  test("returns degraded sync that always reports degraded mode", () => {
    const sync = createDegradedServerSync();
    expect(sync.isDegraded()).toBe(true);
  });

  test("authenticate throws error", async () => {
    const sync = createDegradedServerSync();
    await expect(sync.authenticate()).rejects.toThrow("No API key configured");
  });

  test("syncRepo and syncTask are no-ops", async () => {
    const sync = createDegradedServerSync();
    await sync.syncRepo("repo_123");
    await sync.syncTask("task_123", "repo_456", "READY");
  });

  test("markTaskReady returns queued result", async () => {
    const sync = createDegradedServerSync();
    const result = await sync.markTaskReady("task_123", "repo_456");

    expect(result.status).toBe("READY");
    expect(result.queued).toBe(true);
  });

  test("completeStep throws error", async () => {
    const sync = createDegradedServerSync();
    await expect(
      sync.completeStep("step_123", {
        executionId: "exec_456",
        attempt: 1,
        status: "success",
        durationMs: 1000,
      }),
    ).rejects.toThrow("degraded mode");
  });

  test("getTaskStatus throws error", async () => {
    const sync = createDegradedServerSync();
    await expect(sync.getTaskStatus("task_123")).rejects.toThrow("degraded mode");
  });
});
