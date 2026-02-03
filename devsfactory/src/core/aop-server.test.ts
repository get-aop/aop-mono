import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { OrchestratorState } from "../types";
import type { BrainstormManagerLike } from "./aop-server";
import type { SQLiteBrainstormStorage } from "./sqlite/brainstorm-storage";

const createMockOrchestrator = (state: OrchestratorState) => {
  const orchestrator = new EventEmitter() as EventEmitter & {
    getState: () => OrchestratorState;
    getActiveAgents: () => Promise<never[]>;
  };
  orchestrator.getState = () => structuredClone(state);
  orchestrator.getActiveAgents = async () => [];
  return orchestrator;
};

const emptyState: OrchestratorState = {
  tasks: [],
  plans: {},
  subtasks: {}
};

describe("AopServer", () => {
  describe("GET /api/state", () => {
    test("returns orchestrator state as JSON", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/state`
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "application/json"
        );

        const body = await response.json();
        expect(body).toEqual(emptyState);
      } finally {
        await server.stop();
      }
    });

    test("returns state with tasks when orchestrator has tasks", async () => {
      const { AopServer } = await import("./aop-server");
      const stateWithTask: OrchestratorState = {
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "Test Task",
              status: "PENDING",
              created: new Date("2026-01-01"),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "Test description",
            requirements: "Test requirements",
            acceptanceCriteria: []
          }
        ],
        plans: {},
        subtasks: {}
      };
      const orchestrator = createMockOrchestrator(stateWithTask);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/state`
        );
        const body = (await response.json()) as OrchestratorState;
        expect(body.tasks).toHaveLength(1);
        expect(body.tasks[0]!.folder).toBe("my-task");
      } finally {
        await server.stop();
      }
    });
  });

  describe("CORS headers", () => {
    test("includes CORS headers in response", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/state`
        );
        expect(response.headers.get("access-control-allow-origin")).toBe(
          "http://localhost:3001"
        );
      } finally {
        await server.stop();
      }
    });

    test("handles OPTIONS preflight request", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/state`,
          {
            method: "OPTIONS"
          }
        );
        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-methods")).toContain(
          "GET"
        );
        expect(response.headers.get("access-control-allow-methods")).toContain(
          "POST"
        );
      } finally {
        await server.stop();
      }
    });
  });

  describe("port configuration", () => {
    test("uses DASHBOARD_PORT environment variable when set", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 3456 });
      await server.start();

      try {
        expect(server.port).toBe(3456);
      } finally {
        await server.stop();
      }
    });

    test("uses port 0 for random available port", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        expect(server.port).toBeGreaterThan(0);
      } finally {
        await server.stop();
      }
    });
  });

  describe("graceful shutdown", () => {
    test("stop() closes the server", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();
      const port = server.port;
      await server.stop();

      await expect(
        fetch(`http://localhost:${port}/api/state`)
      ).rejects.toThrow();
    });
  });

  describe("POST /api/tasks/:folder/status", () => {
    test("validates status with Zod and returns 400 for invalid status", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "INVALID_STATUS" })
          }
        );
        expect(response.status).toBe(400);
        const body = (await response.json()) as { error: string };
        expect(body.error).toBeDefined();
      } finally {
        await server.stop();
      }
    });

    test("calls updateTaskStatus with valid status", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const updateTaskStatusMock = mock(() => Promise.resolve());

      const server = new AopServer(orchestrator, {
        port: 0,
        devsfactoryDir: "/tmp/devsfactory",
        updateTaskStatus: updateTaskStatusMock
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "PENDING" })
          }
        );
        expect(response.status).toBe(200);
        expect(updateTaskStatusMock).toHaveBeenCalledWith(
          "my-task",
          "PENDING",
          "/tmp/devsfactory"
        );
      } finally {
        await server.stop();
      }
    });
  });

  describe("POST /api/subtasks/:folder/:file/status", () => {
    test("validates status with Zod and returns 400 for invalid status", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/subtasks/my-task/001-subtask.md/status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "INVALID_STATUS" })
          }
        );
        expect(response.status).toBe(400);
      } finally {
        await server.stop();
      }
    });

    test("calls updateSubtaskStatus with valid status", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const updateSubtaskStatusMock = mock(() => Promise.resolve());

      const server = new AopServer(orchestrator, {
        port: 0,
        devsfactoryDir: "/tmp/devsfactory",
        updateSubtaskStatus: updateSubtaskStatusMock
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/subtasks/my-task/001-subtask.md/status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "INPROGRESS" })
          }
        );
        expect(response.status).toBe(200);
        expect(updateSubtaskStatusMock).toHaveBeenCalledWith(
          "my-task",
          "001-subtask.md",
          "INPROGRESS",
          "/tmp/devsfactory"
        );
      } finally {
        await server.stop();
      }
    });
  });

  describe("POST /api/tasks/:folder/create-pr", () => {
    test("triggers PR creation and returns prUrl", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const createPrMock = mock(() =>
        Promise.resolve({ prUrl: "https://github.com/org/repo/pull/123" })
      );

      const server = new AopServer(orchestrator, {
        port: 0,
        createPr: createPrMock
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/create-pr`,
          { method: "POST" }
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { prUrl: string };
        expect(body.prUrl).toBe("https://github.com/org/repo/pull/123");
        expect(createPrMock).toHaveBeenCalledWith("my-task");
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when PR creation fails", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const createPrMock = mock(() => Promise.reject(new Error("gh failed")));

      const server = new AopServer(orchestrator, {
        port: 0,
        createPr: createPrMock
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/create-pr`,
          { method: "POST" }
        );
        expect(response.status).toBe(500);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("gh failed");
      } finally {
        await server.stop();
      }
    });
  });

  describe("WebSocket /api/events", () => {
    test("sends initial state on connection", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data as string));
            resolve();
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 1000);
        });

        ws.close();
        expect(messages).toHaveLength(1);
        expect((messages[0] as { type: string }).type).toBe("state");
        expect((messages[0] as { data: OrchestratorState }).data).toEqual(
          emptyState
        );
      } finally {
        await server.stop();
      }
    });

    test("forwards orchestrator stateChanged events to connected clients", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data as string));
              if (messages.length >= 2) resolve();
            };
            setTimeout(() => orchestrator.emit("stateChanged"), 50);
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 1000);
        });

        ws.close();
        expect(messages.length).toBeGreaterThanOrEqual(2);
        expect((messages[1] as { type: string }).type).toBe("state");
      } finally {
        await server.stop();
      }
    });

    test("forwards workerJobFailed events", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data as string));
              if (messages.length >= 2) resolve();
            };
            setTimeout(() => {
              orchestrator.emit("workerJobFailed", {
                jobId: "job-1",
                error: "Agent failed",
                attempt: 1
              });
            }, 50);
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 1000);
        });

        ws.close();
        const failedEvent = messages.find(
          (m) => (m as { type: string }).type === "jobFailed"
        );
        expect(failedEvent).toBeDefined();
        expect((failedEvent as { jobId: string }).jobId).toBe("job-1");
      } finally {
        await server.stop();
      }
    });

    test("forwards workerJobRetrying events", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data as string));
              if (messages.length >= 2) resolve();
            };
            setTimeout(() => {
              orchestrator.emit("workerJobRetrying", {
                jobId: "job-1",
                attempt: 2,
                nextRetryMs: 5000
              });
            }, 50);
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 1000);
        });

        ws.close();
        const retryEvent = messages.find(
          (m) => (m as { type: string }).type === "jobRetrying"
        );
        expect(retryEvent).toBeDefined();
        expect((retryEvent as { attempt: number }).attempt).toBe(2);
      } finally {
        await server.stop();
      }
    });

    test("closes WebSocket connections on server stop", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
      let closed = false;

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      ws.onclose = () => {
        closed = true;
      };

      await server.stop();
      await new Promise((r) => setTimeout(r, 100));

      expect(closed).toBe(true);
    });
  });

  describe("GET /api/tasks/:folder/diff", () => {
    test("returns diff from getDiff callback", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getDiffMock = mock(() =>
        Promise.resolve({ diff: "diff --git a/file.ts b/file.ts\n+added line" })
      );

      const server = new AopServer(orchestrator, {
        port: 0,
        getDiff: getDiffMock
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/diff`
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { diff: string };
        expect(body.diff).toBe("diff --git a/file.ts b/file.ts\n+added line");
        expect(getDiffMock).toHaveBeenCalledWith("my-task");
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when getDiff fails", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getDiffMock = mock(() =>
        Promise.reject(new Error("git diff failed"))
      );

      const server = new AopServer(orchestrator, {
        port: 0,
        getDiff: getDiffMock
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/diff`
        );
        expect(response.status).toBe(500);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("git diff failed");
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when getDiff is not configured", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/diff`
        );
        expect(response.status).toBe(500);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("not configured");
      } finally {
        await server.stop();
      }
    });
  });

  describe("GET /api/tasks/:folder/subtasks/:file/logs", () => {
    test("returns logs from getSubtaskLogs callback", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getSubtaskLogsMock = mock(() =>
        Promise.resolve({ logs: ["line 1", "line 2", "line 3"] })
      );

      const server = new AopServer(orchestrator, {
        port: 0,
        getSubtaskLogs: getSubtaskLogsMock
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/subtasks/001-subtask.md/logs`
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { logs: string[] };
        expect(body.logs).toEqual(["line 1", "line 2", "line 3"]);
        expect(getSubtaskLogsMock).toHaveBeenCalledWith(
          "my-task",
          "001-subtask.md"
        );
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when getSubtaskLogs fails", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getSubtaskLogsMock = mock(() =>
        Promise.reject(new Error("Log file not found"))
      );

      const server = new AopServer(orchestrator, {
        port: 0,
        getSubtaskLogs: getSubtaskLogsMock
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/subtasks/001-subtask.md/logs`
        );
        expect(response.status).toBe(500);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("Log file not found");
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when getSubtaskLogs is not configured", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/subtasks/001-subtask.md/logs`
        );
        expect(response.status).toBe(500);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("not configured");
      } finally {
        await server.stop();
      }
    });

    test("returns empty logs array when subtask has no logs", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getSubtaskLogsMock = mock(() => Promise.resolve({ logs: [] }));

      const server = new AopServer(orchestrator, {
        port: 0,
        getSubtaskLogs: getSubtaskLogsMock
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks/my-task/subtasks/001-subtask.md/logs`
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { logs: string[] };
        expect(body.logs).toEqual([]);
      } finally {
        await server.stop();
      }
    });
  });
});

describe("Brainstorm API endpoints", () => {
  describe("POST /api/brainstorm/start", () => {
    test("starts a new brainstorm session", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockSession = {
        id: "brainstorm-123",
        status: "active" as const,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const mockStartSession = mock(() => Promise.resolve(mockSession));
      const mockBrainstormManager = {
        startSession: mockStartSession,
        on: mock(() => {}),
        off: mock(() => {})
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              initialMessage: "I want to build a feature"
            })
          }
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { sessionId: string };
        expect(body.sessionId).toBe("brainstorm-123");
        expect(mockStartSession).toHaveBeenCalledWith(
          "I want to build a feature"
        );
      } finally {
        await server.stop();
      }
    });

    test("starts session without initial message", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockSession = {
        id: "brainstorm-456",
        status: "active" as const,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const mockStartSession = mock(() => Promise.resolve(mockSession));
      const mockBrainstormManager = {
        startSession: mockStartSession,
        on: mock(() => {}),
        off: mock(() => {})
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
          }
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { sessionId: string };
        expect(body.sessionId).toBe("brainstorm-456");
        expect(mockStartSession).toHaveBeenCalledWith(undefined);
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when brainstorm manager is not configured", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
          }
        );
        expect(response.status).toBe(500);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("not configured");
      } finally {
        await server.stop();
      }
    });
  });

  describe("POST /api/brainstorm/:sessionId/message", () => {
    test("sends a message to the session", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockSendMessage = mock(() => Promise.resolve());
      const mockBrainstormManager = {
        sendMessage: mockSendMessage,
        getSession: mock(() => ({ id: "session-123" })),
        on: mock(() => {}),
        off: mock(() => {})
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/session-123/message`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "Add authentication" })
          }
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { success: boolean };
        expect(body.success).toBe(true);
        expect(mockSendMessage).toHaveBeenCalledWith(
          "session-123",
          "Add authentication"
        );
      } finally {
        await server.stop();
      }
    });

    test("returns 400 when content is missing", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockBrainstormManager = {
        sendMessage: mock(() => Promise.resolve()),
        getSession: mock(() => ({ id: "session-123" })),
        on: mock(() => {}),
        off: mock(() => {})
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/session-123/message`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
          }
        );
        expect(response.status).toBe(400);
      } finally {
        await server.stop();
      }
    });

    test("returns 404 when session not found", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockBrainstormManager = {
        sendMessage: mock(() => Promise.reject(new Error("Session not found"))),
        getSession: mock(() => undefined),
        on: mock(() => {}),
        off: mock(() => {})
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/nonexistent/message`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "Hello" })
          }
        );
        expect(response.status).toBe(404);
      } finally {
        await server.stop();
      }
    });
  });

  describe("POST /api/brainstorm/:sessionId/end", () => {
    test("ends the session", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockEndSession = mock(() => Promise.resolve());
      const mockBrainstormManager = {
        endSession: mockEndSession,
        getSession: mock(() => ({
          id: "session-123",
          status: "active",
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "test",
              timestamp: new Date()
            }
          ]
        })),
        on: mock(() => {}),
        off: mock(() => {})
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/session-123/end`,
          { method: "POST" }
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          success: boolean;
          draftId?: string;
        };
        expect(body.success).toBe(true);
        expect(body.draftId).toBe("session-123");
        expect(mockEndSession).toHaveBeenCalledWith("session-123");
      } finally {
        await server.stop();
      }
    });

    test("returns 404 when session not found", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockBrainstormManager = {
        getSession: mock(() => undefined),
        endSession: mock(() => Promise.resolve()),
        on: mock(() => {}),
        off: mock(() => {})
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/nonexistent/end`,
          { method: "POST" }
        );
        expect(response.status).toBe(404);
      } finally {
        await server.stop();
      }
    });
  });

  describe("GET /api/brainstorm/drafts", () => {
    test("returns list of drafts", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockRecords = [
        {
          projectName: "test-project",
          name: "draft-1",
          messages: [],
          partialTaskData: { title: "Feature A" },
          status: "brainstorming" as const,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          projectName: "test-project",
          name: "draft-2",
          messages: [],
          partialTaskData: { title: "Feature B" },
          status: "planning" as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const mockBrainstormStorage = {
        list: mock(() => Promise.resolve(mockRecords))
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormStorage:
          mockBrainstormStorage as unknown as SQLiteBrainstormStorage
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/drafts`
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          drafts: Array<{ sessionId: string }>;
        };
        expect(body.drafts).toHaveLength(2);
        expect(body.drafts[0]!.sessionId).toBe("draft-1");
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when brainstorm storage not configured", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/drafts`
        );
        expect(response.status).toBe(500);
      } finally {
        await server.stop();
      }
    });
  });

  describe("POST /api/brainstorm/drafts/:sessionId/resume", () => {
    test("resumes a draft session", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockRecord = {
        projectName: "test-project",
        name: "draft-123",
        messages: [
          {
            id: "msg-1",
            role: "user" as const,
            content: "original idea",
            timestamp: new Date()
          }
        ],
        partialTaskData: { title: "My Feature" },
        status: "brainstorming" as const,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockSession = {
        id: "new-session-456",
        status: "active" as const,
        messages: mockRecord.messages,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockStartSession = mock(() => Promise.resolve(mockSession));
      const mockBrainstormManager = {
        startSession: mockStartSession,
        on: mock(() => {}),
        off: mock(() => {})
      };

      const mockBrainstormStorage = {
        get: mock(() => Promise.resolve(mockRecord)),
        delete: mock(() => Promise.resolve())
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike,
        brainstormStorage:
          mockBrainstormStorage as unknown as SQLiteBrainstormStorage
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/drafts/draft-123/resume`,
          { method: "POST" }
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { sessionId: string };
        expect(body.sessionId).toBe("new-session-456");
      } finally {
        await server.stop();
      }
    });

    test("returns 404 when draft not found", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockBrainstormManager = {
        on: mock(() => {}),
        off: mock(() => {})
      };

      const mockBrainstormStorage = {
        get: mock(() => Promise.resolve(null))
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike,
        brainstormStorage:
          mockBrainstormStorage as unknown as SQLiteBrainstormStorage
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/drafts/nonexistent/resume`,
          { method: "POST" }
        );
        expect(response.status).toBe(404);
      } finally {
        await server.stop();
      }
    });
  });

  describe("DELETE /api/brainstorm/drafts/:sessionId", () => {
    test("deletes a draft", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockDelete = mock(() => Promise.resolve());
      const mockBrainstormStorage = {
        delete: mockDelete
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormStorage:
          mockBrainstormStorage as unknown as SQLiteBrainstormStorage
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/drafts/draft-123`,
          { method: "DELETE" }
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { success: boolean };
        expect(body.success).toBe(true);
        expect(mockDelete).toHaveBeenCalledWith("draft-123");
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when brainstorm storage not configured", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/drafts/draft-123`,
          { method: "DELETE" }
        );
        expect(response.status).toBe(500);
      } finally {
        await server.stop();
      }
    });
  });

  describe("POST /api/brainstorm/:sessionId/approve", () => {
    test("approves session and creates task", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockSession = {
        id: "session-123",
        status: "completed" as const,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        taskPreview: {
          title: "My Feature",
          description: "A new feature",
          requirements: "Must do X",
          acceptanceCriteria: ["Does X"]
        }
      };

      const mockBrainstormManager = {
        getSession: mock(() => mockSession),
        endSession: mock(() => Promise.resolve()),
        on: mock(() => {}),
        off: mock(() => {})
      };

      const mockCreateTask = mock(() =>
        Promise.resolve({ taskFolder: "my-feature" })
      );

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike,
        createTask: mockCreateTask
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/session-123/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskTitle: "My Feature",
              editedSubtasks: [
                {
                  number: 1,
                  slug: "subtask-1",
                  title: "Subtask 1",
                  description: "Do thing",
                  dependencies: []
                }
              ]
            })
          }
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          taskFolder: string;
          success: boolean;
        };
        expect(body.success).toBe(true);
        expect(body.taskFolder).toBe("my-feature");
      } finally {
        await server.stop();
      }
    });

    test("returns 400 when taskTitle is missing", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockBrainstormManager = {
        getSession: mock(() => ({ id: "session-123", status: "completed" })),
        on: mock(() => {}),
        off: mock(() => {})
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/session-123/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
          }
        );
        expect(response.status).toBe(400);
      } finally {
        await server.stop();
      }
    });

    test("returns 404 when session not found", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockBrainstormManager = {
        getSession: mock(() => undefined),
        on: mock(() => {}),
        off: mock(() => {})
      };

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/brainstorm/nonexistent/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskTitle: "My Task" })
          }
        );
        expect(response.status).toBe(404);
      } finally {
        await server.stop();
      }
    });
  });

  describe("WebSocket brainstorm events", () => {
    test("forwards brainstormStarted event", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const { EventEmitter } = await import("node:events");

      const mockBrainstormManager = new EventEmitter();

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data as string));
              if (messages.length >= 2) resolve();
            };
            setTimeout(() => {
              mockBrainstormManager.emit("sessionStarted", {
                sessionId: "session-123",
                agentId: "agent-456"
              });
            }, 50);
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 1000);
        });

        ws.close();
        const startedEvent = messages.find(
          (m) => (m as { type: string }).type === "brainstormStarted"
        );
        expect(startedEvent).toBeDefined();
        expect((startedEvent as { sessionId: string }).sessionId).toBe(
          "session-123"
        );
        expect((startedEvent as { agentId: string }).agentId).toBe("agent-456");
      } finally {
        await server.stop();
      }
    });

    test("forwards brainstormMessage event", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const { EventEmitter } = await import("node:events");

      const mockBrainstormManager = new EventEmitter();

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data as string));
              if (messages.length >= 2) resolve();
            };
            setTimeout(() => {
              mockBrainstormManager.emit("message", {
                sessionId: "session-123",
                message: {
                  id: "msg-1",
                  role: "assistant",
                  content: "Hello!",
                  timestamp: new Date()
                }
              });
            }, 50);
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 1000);
        });

        ws.close();
        const messageEvent = messages.find(
          (m) => (m as { type: string }).type === "brainstormMessage"
        );
        expect(messageEvent).toBeDefined();
        expect((messageEvent as { sessionId: string }).sessionId).toBe(
          "session-123"
        );
      } finally {
        await server.stop();
      }
    });

    test("forwards brainstormComplete event", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const { EventEmitter } = await import("node:events");

      const mockBrainstormManager = new EventEmitter();

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data as string));
              if (messages.length >= 2) resolve();
            };
            setTimeout(() => {
              mockBrainstormManager.emit("brainstormComplete", {
                sessionId: "session-123",
                taskPreview: { title: "My Feature", description: "A feature" }
              });
            }, 50);
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 1000);
        });

        ws.close();
        const completeEvent = messages.find(
          (m) => (m as { type: string }).type === "brainstormComplete"
        );
        expect(completeEvent).toBeDefined();
        expect((completeEvent as { sessionId: string }).sessionId).toBe(
          "session-123"
        );
        expect(
          (completeEvent as { taskPreview: { title: string } }).taskPreview
            .title
        ).toBe("My Feature");
      } finally {
        await server.stop();
      }
    });

    test("forwards brainstormError event", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const { EventEmitter } = await import("node:events");

      const mockBrainstormManager = new EventEmitter();

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike
      });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data as string));
              if (messages.length >= 2) resolve();
            };
            setTimeout(() => {
              mockBrainstormManager.emit("error", {
                sessionId: "session-123",
                error: new Error("Agent crashed")
              });
            }, 50);
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 1000);
        });

        ws.close();
        const errorEvent = messages.find(
          (m) => (m as { type: string }).type === "brainstormError"
        );
        expect(errorEvent).toBeDefined();
        expect((errorEvent as { sessionId: string }).sessionId).toBe(
          "session-123"
        );
      } finally {
        await server.stop();
      }
    });
  });

  describe("port fallback", () => {
    test("uses next available port when initial port is in use", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      // Start first server on a random port
      const server1 = new AopServer(orchestrator, { port: 0 });
      await server1.start();
      const usedPort = server1.port;

      try {
        // Start second server requesting the same port
        const server2 = new AopServer(orchestrator, { port: usedPort });
        await server2.start();

        try {
          // Second server should have picked the next available port
          expect(server2.port).toBeGreaterThan(usedPort);

          // Both servers should be functional
          const response1 = await fetch(
            `http://localhost:${server1.port}/api/state`
          );
          expect(response1.status).toBe(200);

          const response2 = await fetch(
            `http://localhost:${server2.port}/api/state`
          );
          expect(response2.status).toBe(200);
        } finally {
          await server2.stop();
        }
      } finally {
        await server1.stop();
      }
    });
  });

  describe("taskCreated WebSocket event", () => {
    test("broadcasts taskCreated event when task is approved", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockSession = {
        id: "session-123",
        status: "completed" as const,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        taskPreview: {
          title: "My Feature",
          description: "A new feature",
          requirements: "Must do X",
          acceptanceCriteria: ["Does X"]
        }
      };

      const mockBrainstormManager = {
        getSession: mock(() => mockSession),
        endSession: mock(() => Promise.resolve()),
        on: mock(() => {}),
        off: mock(() => {})
      };

      const mockCreateTask = mock(() =>
        Promise.resolve({ taskFolder: "my-feature" })
      );

      const server = new AopServer(orchestrator, {
        port: 0,
        brainstormManager:
          mockBrainstormManager as unknown as BrainstormManagerLike,
        createTask: mockCreateTask
      });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onopen = async () => {
            ws.onmessage = (event) => {
              messages.push(JSON.parse(event.data as string));
              const taskCreatedEvent = messages.find(
                (m) => (m as { type: string }).type === "taskCreated"
              );
              if (taskCreatedEvent) resolve();
            };

            await fetch(
              `http://localhost:${server.port}/api/brainstorm/session-123/approve`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskTitle: "My Feature" })
              }
            );
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 2000);
        });

        ws.close();
        const taskCreatedEvent = messages.find(
          (m) => (m as { type: string }).type === "taskCreated"
        );
        expect(taskCreatedEvent).toBeDefined();
        expect((taskCreatedEvent as { sessionId: string }).sessionId).toBe(
          "session-123"
        );
        expect((taskCreatedEvent as { taskFolder: string }).taskFolder).toBe(
          "my-feature"
        );
      } finally {
        await server.stop();
      }
    });
  });
});

describe("Multi-project API endpoints", () => {
  describe("GET /api/projects", () => {
    test("returns list of all registered projects", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockProjects = [
        {
          name: "project-a",
          path: "/home/user/project-a",
          gitRemote: "git@github.com:user/project-a.git",
          registered: new Date("2026-01-15")
        },
        {
          name: "project-b",
          path: "/home/user/project-b",
          gitRemote: null,
          registered: new Date("2026-01-20")
        }
      ];

      const mockListProjects = mock(() => Promise.resolve(mockProjects));
      const mockScanProject = mock(() =>
        Promise.resolve({ tasks: [], plans: {}, subtasks: {} })
      );

      const server = new AopServer(orchestrator, {
        port: 0,
        listProjects: mockListProjects,
        scanProject: mockScanProject
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/projects`
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          projects: Array<{
            name: string;
            path: string;
            registered: string;
            taskCount: number;
          }>;
        };
        expect(body.projects).toHaveLength(2);
        expect(body.projects[0]!.name).toBe("project-a");
        expect(body.projects[0]!.taskCount).toBe(0);
        expect(body.projects[1]!.name).toBe("project-b");
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when listProjects not configured", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/projects`
        );
        expect(response.status).toBe(500);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("not configured");
      } finally {
        await server.stop();
      }
    });
  });

  describe("GET /api/projects/:name", () => {
    test("returns project details and state", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockProject = {
        name: "my-project",
        path: "/home/user/my-project",
        gitRemote: "git@github.com:user/my-project.git",
        registered: new Date("2026-01-15")
      };

      const mockState = {
        tasks: [
          {
            folder: "task-1",
            frontmatter: {
              title: "Task 1",
              status: "PENDING" as const,
              created: new Date(),
              priority: "medium" as const,
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "Test task",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        plans: {},
        subtasks: {}
      };

      const mockGetProject = mock(() => Promise.resolve(mockProject));
      const mockScanProject = mock(() => Promise.resolve(mockState));

      const server = new AopServer(orchestrator, {
        port: 0,
        getProject: mockGetProject,
        scanProject: mockScanProject
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/projects/my-project`
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          project: typeof mockProject;
          state: typeof mockState;
        };
        expect(body.project.name).toBe("my-project");
        expect(body.state.tasks).toHaveLength(1);
        expect(mockGetProject).toHaveBeenCalledWith("my-project");
      } finally {
        await server.stop();
      }
    });

    test("returns 404 when project not found", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockGetProject = mock(() => Promise.resolve(null));

      const server = new AopServer(orchestrator, {
        port: 0,
        getProject: mockGetProject
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/projects/nonexistent`
        );
        expect(response.status).toBe(404);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("not found");
      } finally {
        await server.stop();
      }
    });
  });

  describe("GET /api/projects/:name/tasks", () => {
    test("returns tasks for a specific project", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockProject = {
        name: "my-project",
        path: "/home/user/my-project",
        gitRemote: null,
        registered: new Date()
      };

      const mockScanResult = {
        tasks: [
          {
            folder: "task-1",
            frontmatter: {
              title: "Task 1",
              status: "PENDING" as const,
              created: new Date(),
              priority: "medium" as const,
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "Test",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        plans: {
          "task-1": {
            folder: "task-1",
            frontmatter: {
              status: "INPROGRESS" as const,
              task: "task-1",
              created: new Date()
            },
            subtasks: []
          }
        },
        subtasks: {}
      };

      const mockGetProject = mock(() => Promise.resolve(mockProject));
      const mockScanProject = mock(() => Promise.resolve(mockScanResult));

      const server = new AopServer(orchestrator, {
        port: 0,
        getProject: mockGetProject,
        scanProject: mockScanProject
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/projects/my-project/tasks`
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as typeof mockScanResult;
        expect(body.tasks).toHaveLength(1);
        expect(body.tasks[0]!.folder).toBe("task-1");
        expect(body.plans["task-1"]).toBeDefined();
      } finally {
        await server.stop();
      }
    });

    test("returns 404 when project not found", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockGetProject = mock(() => Promise.resolve(null));

      const server = new AopServer(orchestrator, {
        port: 0,
        getProject: mockGetProject
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/projects/nonexistent/tasks`
        );
        expect(response.status).toBe(404);
      } finally {
        await server.stop();
      }
    });
  });

  describe("GET /api/tasks (aggregate)", () => {
    test("returns tasks aggregated across all projects", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const mockProjects = [
        {
          name: "project-a",
          path: "/a",
          gitRemote: null,
          registered: new Date()
        },
        {
          name: "project-b",
          path: "/b",
          gitRemote: null,
          registered: new Date()
        }
      ];

      const mockScanResults = {
        "project-a": {
          tasks: [
            {
              folder: "task-a1",
              frontmatter: {
                title: "Task A1",
                status: "PENDING" as const,
                created: new Date(),
                priority: "high" as const,
                tags: [],
                assignee: null,
                dependencies: [],
                startedAt: null,
                completedAt: null,
                durationMs: null
              },
              description: "",
              requirements: "",
              acceptanceCriteria: []
            }
          ],
          plans: {},
          subtasks: {}
        },
        "project-b": {
          tasks: [
            {
              folder: "task-b1",
              frontmatter: {
                title: "Task B1",
                status: "INPROGRESS" as const,
                created: new Date(),
                priority: "medium" as const,
                tags: [],
                assignee: null,
                dependencies: [],
                startedAt: null,
                completedAt: null,
                durationMs: null
              },
              description: "",
              requirements: "",
              acceptanceCriteria: []
            }
          ],
          plans: {},
          subtasks: {}
        }
      };

      const mockListProjects = mock(() => Promise.resolve(mockProjects));
      const mockScanProject = mock((name: string) =>
        Promise.resolve(mockScanResults[name as keyof typeof mockScanResults])
      );

      const server = new AopServer(orchestrator, {
        port: 0,
        listProjects: mockListProjects,
        scanProject: mockScanProject
      });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks`
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          projects: Record<string, { tasks: unknown[] }>;
        };
        expect(body.projects["project-a"]!.tasks).toHaveLength(1);
        expect(body.projects["project-b"]!.tasks).toHaveLength(1);
      } finally {
        await server.stop();
      }
    });

    test("returns 500 when listProjects not configured", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/tasks`
        );
        expect(response.status).toBe(500);
      } finally {
        await server.stop();
      }
    });
  });

  describe("WebSocket project context", () => {
    test("includes projectName in state updates when configured", async () => {
      const { AopServer } = await import("./aop-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new AopServer(orchestrator, {
        port: 0,
        currentProjectName: "my-project"
      });
      await server.start();

      try {
        const ws = new WebSocket(`ws://localhost:${server.port}/api/events`);
        const messages: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data as string));
            resolve();
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("timeout")), 1000);
        });

        ws.close();
        expect(messages).toHaveLength(1);
        const stateMessage = messages[0] as {
          type: string;
          data: unknown;
          projectName?: string;
        };
        expect(stateMessage.type).toBe("state");
        expect(stateMessage.projectName).toBe("my-project");
      } finally {
        await server.stop();
      }
    });
  });
});
