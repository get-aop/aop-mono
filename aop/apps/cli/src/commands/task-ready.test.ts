import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
}));

const { taskReadyCommand } = await import("./task-ready.ts");

const originalExit = process.exit;

beforeEach(() => {
  mockFetchServer.mockReset();
  process.exit = mock(() => {
    throw new Error("process.exit");
  }) as never;
});

afterEach(() => {
  process.exit = originalExit;
});

const makeStatusWithTask = (taskId = "task-abc-123") => ({
  ok: true,
  data: {
    globalCapacity: { working: 0, max: 5 },
    repos: [
      {
        id: "repo-1",
        name: "my-repo",
        path: "/home/user/project",
        working: 0,
        max: 3,
        tasks: [
          {
            id: taskId,
            repoId: "repo-1",
            changePath: "changes/feat",
            status: "CREATED",
            baseBranch: "main",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
    ],
  },
});

describe("taskReadyCommand", () => {
  test("exits when status fetch fails", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Server error" },
    });

    await expect(taskReadyCommand("task-abc")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits when task not found", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { globalCapacity: { working: 0, max: 5 }, repos: [] },
    });

    await expect(taskReadyCommand("nonexistent")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("finds task by id prefix and marks ready", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123" },
    });

    await taskReadyCommand("task-abc");
    expect(mockFetchServer.mock.calls.at(1)?.at(0)).toBe(
      "/api/repos/repo-1/tasks/task-abc-123/ready",
    );
    expect(mockFetchServer.mock.calls.at(1)?.at(1).method).toBe("POST");
  });

  test("passes workflow and baseBranch options in body", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123" },
    });

    await taskReadyCommand("task-abc", { workflow: "deploy", baseBranch: "develop" });
    const body = JSON.parse(mockFetchServer.mock.calls.at(1)?.at(1).body);
    expect(body.workflow).toBe("deploy");
    expect(body.baseBranch).toBe("develop");
  });

  test("sends empty body when no options provided", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123" },
    });

    await taskReadyCommand("task-abc");
    const body = JSON.parse(mockFetchServer.mock.calls.at(1)?.at(1).body);
    expect(body).toEqual({});
  });

  test("reports already ready", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123", alreadyReady: true },
    });

    await taskReadyCommand("task-abc");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("exits on invalid task status error", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { error: "Invalid task status", status: "WORKING" },
    });

    await expect(taskReadyCommand("task-abc")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("passes retryFromStep in body when provided", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123" },
    });

    await taskReadyCommand("task-abc", { retryFromStep: "design_brief" });
    const body = JSON.parse(mockFetchServer.mock.calls.at(1)?.at(1).body);
    expect(body.retryFromStep).toBe("design_brief");
  });

  test("exits on generic ready error", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: { error: "Unknown error" },
    });

    await expect(taskReadyCommand("task-abc")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
