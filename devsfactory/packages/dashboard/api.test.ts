import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createApiClient } from "./api";
import type { OrchestratorState, TaskStatus } from "./types";

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
});
