import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { OrchestratorState } from "../types";

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

describe("DashboardServer", () => {
  describe("GET /api/state", () => {
    test("returns orchestrator state as JSON", async () => {
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
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

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
      await server.start();

      try {
        const response = await fetch(
          `http://localhost:${server.port}/api/state`
        );
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
      } finally {
        await server.stop();
      }
    });

    test("handles OPTIONS preflight request", async () => {
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 3456 });
      await server.start();

      try {
        expect(server.port).toBe(3456);
      } finally {
        await server.stop();
      }
    });

    test("uses port 0 for random available port", async () => {
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const updateTaskStatusMock = mock(() => Promise.resolve());

      const server = new DashboardServer(orchestrator, {
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const updateSubtaskStatusMock = mock(() => Promise.resolve());

      const server = new DashboardServer(orchestrator, {
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const createPrMock = mock(() =>
        Promise.resolve({ prUrl: "https://github.com/org/repo/pull/123" })
      );

      const server = new DashboardServer(orchestrator, {
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const createPrMock = mock(() => Promise.reject(new Error("gh failed")));

      const server = new DashboardServer(orchestrator, {
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getDiffMock = mock(() =>
        Promise.resolve({ diff: "diff --git a/file.ts b/file.ts\n+added line" })
      );

      const server = new DashboardServer(orchestrator, {
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getDiffMock = mock(() =>
        Promise.reject(new Error("git diff failed"))
      );

      const server = new DashboardServer(orchestrator, {
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getSubtaskLogsMock = mock(() =>
        Promise.resolve({ logs: ["line 1", "line 2", "line 3"] })
      );

      const server = new DashboardServer(orchestrator, {
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getSubtaskLogsMock = mock(() =>
        Promise.reject(new Error("Log file not found"))
      );

      const server = new DashboardServer(orchestrator, {
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);

      const server = new DashboardServer(orchestrator, { port: 0 });
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
      const { DashboardServer } = await import("./dashboard-server");
      const orchestrator = createMockOrchestrator(emptyState);
      const getSubtaskLogsMock = mock(() => Promise.resolve({ logs: [] }));

      const server = new DashboardServer(orchestrator, {
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
