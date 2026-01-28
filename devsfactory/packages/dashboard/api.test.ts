import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createApiClient } from "./api";
import type {
  BrainstormDraft,
  OrchestratorState,
  SubtaskPreview,
  TaskStatus
} from "./types";

describe("api client", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("createApiClient", () => {
    test("creates client with default base URL", () => {
      const client = createApiClient();
      expect(client).toBeDefined();
      expect(client.baseUrl).toBe("http://localhost:3000");
    });

    test("creates client with custom base URL", () => {
      const client = createApiClient("http://custom:8080");
      expect(client.baseUrl).toBe("http://custom:8080");
    });
  });

  describe("fetchState", () => {
    test("fetches state from /api/state", async () => {
      const mockState: OrchestratorState = {
        tasks: [],
        plans: {},
        subtasks: {}
      };
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockState), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      const state = await client.fetchState();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe("http://test:3000/api/state");
      expect(state).toEqual(mockState);
    });

    test("throws on non-ok response", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response("Not Found", { status: 404, statusText: "Not Found" })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient();
      await expect(client.fetchState()).rejects.toThrow("404");
    });
  });

  describe("updateTaskStatus", () => {
    test("sends POST to /api/tasks/:folder/status", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      await client.updateTaskStatus("my-task", "INPROGRESS");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/tasks/my-task/status");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(options.body)).toEqual({ status: "INPROGRESS" });
    });

    test("throws on non-ok response", async () => {
      mockFetch = mock(() =>
        Promise.resolve(new Response("Bad Request", { status: 400 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient();
      await expect(
        client.updateTaskStatus("my-task", "INVALID" as TaskStatus)
      ).rejects.toThrow("400");
    });
  });

  describe("updateSubtaskStatus", () => {
    test("sends POST to /api/subtasks/:folder/:file/status", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      await client.updateSubtaskStatus("my-task", "001-setup.md", "DONE");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "http://test:3000/api/subtasks/my-task/001-setup.md/status"
      );
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ status: "DONE" });
    });
  });

  describe("createPullRequest", () => {
    test("sends POST to /api/tasks/:folder/create-pr", async () => {
      const prResponse = { prUrl: "https://github.com/org/repo/pull/123" };
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify(prResponse), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      const result = await client.createPullRequest("my-task");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/tasks/my-task/create-pr");
      expect(options.method).toBe("POST");
      expect(result).toEqual(prResponse);
    });

    test("returns prUrl from response", async () => {
      const prResponse = { prUrl: "https://github.com/org/repo/pull/456" };
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify(prResponse), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient();
      const result = await client.createPullRequest("task-folder");

      expect(result.prUrl).toBe("https://github.com/org/repo/pull/456");
    });
  });

  describe("getSubtaskLogs", () => {
    test("fetches logs from /api/tasks/:folder/subtasks/:file/logs", async () => {
      const logsResponse = { logs: ["log line 1", "log line 2"] };
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify(logsResponse), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      const result = await client.getSubtaskLogs("my-task", "001-subtask.md");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "http://test:3000/api/tasks/my-task/subtasks/001-subtask.md/logs"
      );
      expect(result).toEqual(logsResponse);
    });

    test("throws on non-ok response", async () => {
      mockFetch = mock(() =>
        Promise.resolve(new Response("Not Found", { status: 404 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient();
      await expect(
        client.getSubtaskLogs("nonexistent", "001-subtask.md")
      ).rejects.toThrow("404");
    });
  });

  describe("startBrainstorm", () => {
    test("sends POST to /api/brainstorm/start", async () => {
      const response = { sessionId: "session-1", agentId: "agent-1" };
      mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(response), { status: 200 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      const result = await client.startBrainstorm("Help me build a feature");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/brainstorm/start");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({
        initialMessage: "Help me build a feature"
      });
      expect(result).toEqual(response);
    });

    test("sends empty initialMessage when not provided", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ sessionId: "s1", agentId: "a1" }), {
            status: 200
          })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient();
      await client.startBrainstorm();

      const [, options] = mockFetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ initialMessage: undefined });
    });
  });

  describe("sendBrainstormMessage", () => {
    test("sends POST to /api/brainstorm/:sessionId/message", async () => {
      mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      await client.sendBrainstormMessage("session-1", "My requirements");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/brainstorm/session-1/message");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ content: "My requirements" });
    });
  });

  describe("endBrainstorm", () => {
    test("sends POST to /api/brainstorm/:sessionId/end", async () => {
      const response = { draftId: "draft-1" };
      mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(response), { status: 200 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      const result = await client.endBrainstorm("session-1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/brainstorm/session-1/end");
      expect(options.method).toBe("POST");
      expect(result).toEqual(response);
    });
  });

  describe("confirmBrainstorm", () => {
    test("sends POST to /api/brainstorm/:sessionId/confirm", async () => {
      mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      await client.confirmBrainstorm("session-1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/brainstorm/session-1/confirm");
      expect(options.method).toBe("POST");
    });
  });

  describe("approveBrainstorm", () => {
    test("sends POST to /api/brainstorm/:sessionId/approve with subtasks", async () => {
      const subtasks: SubtaskPreview[] = [
        { title: "Setup", description: "Set up project", dependencies: [] }
      ];
      const response = { taskFolder: "my-new-task" };
      mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(response), { status: 200 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      const result = await client.approveBrainstorm("session-1", { subtasks });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/brainstorm/session-1/approve");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ subtasks });
      expect(result).toEqual(response);
    });
  });

  describe("listDrafts", () => {
    test("sends GET to /api/brainstorm/drafts", async () => {
      const drafts: BrainstormDraft[] = [
        {
          sessionId: "draft-1",
          messages: [],
          partialTaskData: { title: "Draft Task" },
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ drafts }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      const result = await client.listDrafts();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/brainstorm/drafts");
      expect(result.drafts).toHaveLength(1);
    });
  });

  describe("resumeDraft", () => {
    test("sends POST to /api/brainstorm/drafts/:sessionId/resume", async () => {
      const response = { sessionId: "draft-1", agentId: "agent-1" };
      mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(response), { status: 200 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      const result = await client.resumeDraft("draft-1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/brainstorm/drafts/draft-1/resume");
      expect(options.method).toBe("POST");
      expect(result).toEqual(response);
    });
  });

  describe("deleteDraft", () => {
    test("sends DELETE to /api/brainstorm/drafts/:sessionId", async () => {
      mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const client = createApiClient("http://test:3000");
      await client.deleteDraft("draft-1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://test:3000/api/brainstorm/drafts/draft-1");
      expect(options.method).toBe("DELETE");
    });
  });
});
