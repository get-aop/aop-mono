import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  ApiError,
  applyTask,
  blockTask,
  cleanupWorktrees,
  fetchBranches,
  fetchWorkflows,
  getMetrics,
  getSettings,
  getStatus,
  listDirectories,
  markReady,
  registerRepo,
  removeTask,
  updateSettings,
} from "./client";

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
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "task-2",
                repoId: "repo-1",
                status: "WORKING",
                changePath: "changes/feat-2",
                baseBranch: null,
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
      repoPath: "/path/to/repo",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
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

describe("fetchBranches", () => {
  test("fetches branches for a repo", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ branches: ["main", "feature-a", "develop"], current: "main" }),
    );

    const result = await fetchBranches("repo-1");

    expect(result.branches).toEqual(["main", "feature-a", "develop"]);
    expect(result.current).toBe("main");
    expect(mockFetch).toHaveBeenCalledWith("/api/repos/repo-1/branches", expect.any(Object));
  });

  test("throws ApiError on failure", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Repo not found" }, 404));

    await expect(fetchBranches("bad-repo")).rejects.toThrow(ApiError);
  });
});

describe("fetchWorkflows", () => {
  test("fetches workflow names", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ workflows: ["aop-default", "custom-workflow"] }),
    );

    const result = await fetchWorkflows();

    expect(result).toEqual(["aop-default", "custom-workflow"]);
    expect(mockFetch).toHaveBeenCalledWith("/api/workflows", expect.any(Object));
  });

  test("throws ApiError on failure", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Server error" }, 500));

    await expect(fetchWorkflows()).rejects.toThrow(ApiError);
  });
});

describe("markReady", () => {
  test("marks task as ready without workflow", async () => {
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

  test("marks task as ready with workflow", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1" }));

    await markReady("repo-1", "task-1", "custom-workflow");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/ready",
      expect.objectContaining({
        body: JSON.stringify({ workflow: "custom-workflow" }),
      }),
    );
  });

  test("marks task as ready with workflow and baseBranch", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1" }));

    await markReady("repo-1", "task-1", "custom-workflow", "feature-branch");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/ready",
      expect.objectContaining({
        body: JSON.stringify({ workflow: "custom-workflow", baseBranch: "feature-branch" }),
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
    byStatus: { DRAFT: 0, READY: 0, WORKING: 0, BLOCKED: 0, DONE: done, REMOVED: 0 },
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

describe("applyTask", () => {
  test("applies task without target branch", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        affectedFiles: ["src/index.ts", "src/utils.ts"],
        conflictingFiles: [],
      }),
    );

    const result = await applyTask("repo-1", "task-1");

    expect(result.ok).toBe(true);
    expect(result.affectedFiles).toEqual(["src/index.ts", "src/utils.ts"]);
    expect(result.conflictingFiles).toEqual([]);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/apply",
      expect.objectContaining({
        method: "POST",
        body: "{}",
      }),
    );
  });

  test("applies task with target branch", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, affectedFiles: ["src/index.ts"], conflictingFiles: [] }),
    );

    await applyTask("repo-1", "task-1", "feature-branch");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/apply",
      expect.objectContaining({
        body: JSON.stringify({ targetBranch: "feature-branch" }),
      }),
    );
  });

  test("returns noChanges when no files affected", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, affectedFiles: [], conflictingFiles: [], noChanges: true }),
    );

    const result = await applyTask("repo-1", "task-1");

    expect(result.noChanges).toBe(true);
    expect(result.affectedFiles).toEqual([]);
  });

  test("returns conflicting files on success", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        affectedFiles: ["src/a.ts"],
        conflictingFiles: ["src/a.ts"],
      }),
    );

    const result = await applyTask("repo-1", "task-1");

    expect(result.ok).toBe(true);
    expect(result.conflictingFiles).toEqual(["src/a.ts"]);
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
