import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const clientModulePath = "./client.ts?dashboard-client-test";
const clientModule = await import(clientModulePath);
const {
  ApiError,
  blockTask,
  cleanupWorktrees,
  connectLinear,
  disconnectLinear,
  fetchExecutions,
  getLinearStatus,
  getMetrics,
  getPauseContext,
  getSettings,
  getStatus,
  getWorkflows,
  listDirectories,
  markReady,
  registerRepo,
  removeTask,
  resumeTask,
  testLinearConnection,
  unlockLinear,
  updateSettings,
} = clientModule as typeof import("./client");

const mockFetch = mock(() => Promise.resolve(new Response()));

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockClear();
});

afterEach(() => {
  mockFetch.mockReset();
});

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("ApiError", () => {
  test("creates error with status, code, and message", () => {
    const error = new ApiError(404, "NOT_FOUND", "Resource not found");
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Resource not found");
    expect(error.name).toBe("ApiError");
  });
});

describe("getStatus", () => {
  test("fetches and transforms status data", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ready: true,
        globalCapacity: { working: 1, max: 3 },
        repos: [
          {
            id: "repo-1",
            name: "my-repo",
            path: "/path/to/repo",
            tasks: [
              {
                id: "task-1",
                repoId: "repo-1",
                status: "DRAFT",
                changePath: "changes/feat-1",
                baseBranch: null,
                preferredProvider: null,
                preferredWorkflow: null,
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-01-01T00:00:00Z",
                dependencyState: "waiting",
                blockedByTaskIds: ["task-0"],
                blockedByRefs: ["ABC-120"],
              },
              {
                id: "task-2",
                repoId: "repo-1",
                status: "WORKING",
                changePath: "changes/feat-2",
                baseBranch: null,
                preferredProvider: null,
                preferredWorkflow: null,
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-01-01T00:00:00Z",
              },
            ],
          },
        ],
      }),
    );

    const result = await getStatus();

    expect(result.ready).toBe(true);
    expect(result.capacity).toEqual({ working: 1, max: 3 });
    expect(result.repos).toEqual([{ id: "repo-1", name: "my-repo", path: "/path/to/repo" }]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toEqual({
      id: "task-1",
      repoId: "repo-1",
      status: "DRAFT",
      changePath: "changes/feat-1",
      baseBranch: null,
      preferredProvider: null,
      preferredWorkflow: null,
      repoPath: "/path/to/repo",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      dependencyState: "waiting",
      blockedByTaskIds: ["task-0"],
      blockedByRefs: ["ABC-120"],
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/status", expect.any(Object));
  });

  test("throws ApiError on failure", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Server error" }, 500));

    await expect(getStatus()).rejects.toThrow(ApiError);
    await expect(
      getStatus().catch((e) => {
        expect(e.status).toBe(500);
        expect(e.code).toBe("Server error");
        throw e;
      }),
    ).rejects.toThrow();
  });

  test("handles unknown error code", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(
      getStatus().catch((e) => {
        expect(e.code).toBe("UNKNOWN");
        throw e;
      }),
    ).rejects.toThrow();
  });
});

describe("markReady", () => {
  test("marks task as ready without retry step", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1" }));

    const result = await markReady("repo-1", "task-1");

    expect(result.taskId).toBe("task-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/ready",
      expect.objectContaining({
        method: "POST",
        body: "{}",
      }),
    );
  });

  test("marks task as ready with retryFromStep", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1" }));

    await markReady("repo-1", "task-1", "full-review");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/ready",
      expect.objectContaining({
        body: JSON.stringify({ retryFromStep: "full-review" }),
      }),
    );
  });
});

describe("removeTask", () => {
  test("removes task without force", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1", aborted: false }));

    const result = await removeTask("repo-1", "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.aborted).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  test("removes task with force", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1", aborted: true }));

    const result = await removeTask("repo-1", "task-1", true);

    expect(result.aborted).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1?force=true",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("getMetrics", () => {
  const createMetrics = (total: number, done: number) => ({
    total,
    byStatus: {
      DRAFT: 0,
      READY: 0,
      RESUMING: 0,
      WORKING: 0,
      PAUSED: 0,
      BLOCKED: 0,
      DONE: done,
      REMOVED: 0,
    },
    successRate: total > 0 ? done / total : 0,
    avgDurationMs: 1000,
    avgFailedDurationMs: 500,
  });

  test("fetches metrics without repoId", async () => {
    const metrics = createMetrics(10, 5);
    mockFetch.mockResolvedValueOnce(jsonResponse(metrics));

    const result = await getMetrics();

    expect(result).toEqual(metrics);
    expect(mockFetch).toHaveBeenCalledWith("/api/metrics", expect.any(Object));
  });

  test("fetches metrics with repoId", async () => {
    const metrics = createMetrics(3, 1);
    mockFetch.mockResolvedValueOnce(jsonResponse(metrics));

    const result = await getMetrics("repo-1");

    expect(result).toEqual(metrics);
    expect(mockFetch).toHaveBeenCalledWith("/api/metrics?repoId=repo-1", expect.any(Object));
  });
});

describe("listDirectories", () => {
  test("lists directories without path", async () => {
    const response = {
      path: "/home/user",
      directories: ["projects", "documents"],
      parent: "/home",
      isGitRepo: false,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await listDirectories();

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith("/api/fs/directories", expect.any(Object));
  });

  test("lists directories with path", async () => {
    const response = {
      path: "/home/user/projects",
      directories: ["repo1", "repo2"],
      parent: "/home/user",
      isGitRepo: false,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await listDirectories("/home/user/projects");

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/fs/directories?path=%2Fhome%2Fuser%2Fprojects",
      expect.any(Object),
    );
  });

  test("lists directories with hidden flag", async () => {
    const response = {
      path: "/home/user",
      directories: [".config", ".local", "projects"],
      parent: "/home",
      isGitRepo: false,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await listDirectories("/home/user", true);

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/fs/directories?path=%2Fhome%2Fuser&hidden=true",
      expect.any(Object),
    );
  });
});

describe("registerRepo", () => {
  test("registers a new repository", async () => {
    const response = { ok: true, repoId: "repo-123", alreadyExists: false };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await registerRepo("/path/to/repo");

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "/path/to/repo" }),
      }),
    );
  });

  test("handles already existing repository", async () => {
    const response = { ok: true, repoId: "repo-123", alreadyExists: true };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await registerRepo("/path/to/repo");

    expect(result.alreadyExists).toBe(true);
  });
});

describe("blockTask", () => {
  test("blocks a task", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, taskId: "task-1", agentKilled: true }),
    );

    const result = await blockTask("repo-1", "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/block",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("getSettings", () => {
  test("fetches settings", async () => {
    const settings = [
      { key: "theme", value: "dark" },
      { key: "maxConcurrent", value: "3" },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ settings }));

    const result = await getSettings();

    expect(result).toEqual(settings);
    expect(mockFetch).toHaveBeenCalledWith("/api/settings", expect.any(Object));
  });
});

describe("getWorkflows", () => {
  test("fetches available workflows", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ workflows: ["aop-default", "simple"] }));

    const result = await getWorkflows();

    expect(result).toEqual(["aop-default", "simple"]);
    expect(mockFetch).toHaveBeenCalledWith("/api/workflows", expect.any(Object));
  });
});

describe("updateSettings", () => {
  test("updates settings", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const settings = [{ key: "theme", value: "light" }];
    await updateSettings(settings);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ settings }),
      }),
    );
  });
});

describe("Linear API client", () => {
  test("fetches Linear connection status", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ connected: true, locked: false }));

    const result = await getLinearStatus();

    expect(result).toEqual({ connected: true, locked: false });
    expect(mockFetch).toHaveBeenCalledWith("/api/linear/status", expect.any(Object));
  });

  test("starts the Linear OAuth flow", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ authorizeUrl: "https://linear.app/oauth/authorize?state=abc" }),
    );

    const result = await connectLinear();

    expect(result.authorizeUrl).toContain("linear.app/oauth/authorize");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/linear/connect",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  test("unlocks the Linear token store", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await unlockLinear();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/linear/unlock",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  test("tests the unlocked Linear connection", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        organizationName: "Acme",
        userName: "Jane Doe",
        userEmail: "jane@example.com",
      }),
    );

    const result = await testLinearConnection();

    expect(result.organizationName).toBe("Acme");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/linear/test-connection",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("disconnects the Linear integration", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await disconnectLinear();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/linear/disconnect",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("getPauseContext", () => {
  test("fetches pause context for a paused task", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        pauseContext: "INPUT_REASON: Need API key\nINPUT_TYPE: text",
        signal: "REQUIRES_INPUT",
      }),
    );

    const result = await getPauseContext("repo-1", "task-1");

    expect(result.pauseContext).toBe("INPUT_REASON: Need API key\nINPUT_TYPE: text");
    expect(result.signal).toBe("REQUIRES_INPUT");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/pause-context",
      expect.any(Object),
    );
  });

  test("returns null pauseContext and signal when no context exists", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ pauseContext: null, signal: null }));

    const result = await getPauseContext("repo-1", "task-1");

    expect(result.pauseContext).toBeNull();
    expect(result.signal).toBeNull();
  });

  test("returns signal for review workflow", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ pauseContext: "Plan for implementation...", signal: "PLAN_READY" }),
    );

    const result = await getPauseContext("repo-1", "task-1");

    expect(result.signal).toBe("PLAN_READY");
    expect(result.pauseContext).toBe("Plan for implementation...");
  });
});

describe("resumeTask", () => {
  test("resumes a paused task with input", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, taskId: "task-1", message: "Resume initiated" }),
    );

    const result = await resumeTask("repo-1", "task-1", "my-api-key-123");

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/resume",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ input: "my-api-key-123" }),
      }),
    );
  });

  test("throws ApiError when task is not paused", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Task is not paused" }, 409));

    await expect(resumeTask("repo-1", "task-1", "input")).rejects.toThrow(ApiError);
  });
});

describe("cleanupWorktrees", () => {
  test("cleans up worktrees", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ cleaned: 3, failed: 1 }));

    const result = await cleanupWorktrees();

    expect(result.cleaned).toBe(3);
    expect(result.failed).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings/cleanup-worktrees",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("fetchExecutions", () => {
  test("fetches executions for a task", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        executions: [
          {
            id: "exec-1",
            taskId: "task-1",
            status: "completed",
            startedAt: "2024-01-01T00:00:00Z",
            finishedAt: "2024-01-01T00:10:00Z",
            steps: [
              {
                id: "step-exec-1",
                stepId: "iterate",
                stepType: "implement",
                status: "success",
                startedAt: "2024-01-01T00:00:00Z",
                endedAt: "2024-01-01T00:05:00Z",
              },
              {
                id: "step-exec-2",
                stepId: "full-review",
                stepType: "review",
                status: "failure",
                startedAt: "2024-01-01T00:05:00Z",
                endedAt: "2024-01-01T00:10:00Z",
                error: "Review failed",
              },
            ],
          },
        ],
      }),
    );

    const result = await fetchExecutions("repo-1", "task-1");

    expect(result).toHaveLength(1);
    const exec = result[0];
    expect(exec?.id).toBe("exec-1");
    expect(exec?.steps).toHaveLength(2);
    expect(exec?.steps[0]?.stepId).toBe("iterate");
    expect(exec?.steps[1]?.stepId).toBe("full-review");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/executions",
      expect.any(Object),
    );
  });

  test("returns empty array when no executions", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ executions: [] }));

    const result = await fetchExecutions("repo-1", "task-1");

    expect(result).toEqual([]);
  });
});
