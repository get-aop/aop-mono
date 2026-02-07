import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
}));

const { taskRemoveCommand } = await import("./task-remove.ts");

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

const makeStatusWithTask = (taskId = "task-abc-123", repoId = "repo-1") => ({
  ok: true,
  data: {
    repos: [
      {
        id: repoId,
        tasks: [{ id: taskId, repo_id: repoId }],
      },
    ],
  },
});

describe("taskRemoveCommand", () => {
  test("exits when status fetch fails", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Server error" },
    });

    await expect(taskRemoveCommand("task-abc")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits when task not found in any repo", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { repos: [{ id: "repo-1", tasks: [] }] },
    });

    await expect(taskRemoveCommand("nonexistent")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("sends DELETE to correct URL", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123", aborted: false },
    });

    await taskRemoveCommand("task-abc");
    expect(mockFetchServer.mock.calls.at(1)?.at(0)).toBe("/api/repos/repo-1/tasks/task-abc-123");
    expect(mockFetchServer.mock.calls.at(1)?.at(1)).toEqual({ method: "DELETE" });
  });

  test("sends DELETE with force param", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123", aborted: true },
    });

    await taskRemoveCommand("task-abc", { force: true });
    expect(mockFetchServer.mock.calls.at(1)?.at(0)).toBe(
      "/api/repos/repo-1/tasks/task-abc-123?force=true",
    );
  });

  test("succeeds for normal removal", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123", aborted: false },
    });

    await taskRemoveCommand("task-abc");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("succeeds for aborted removal", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123", aborted: true },
    });

    await taskRemoveCommand("task-abc", { force: true });
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("reports already removed task", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, taskId: "task-abc-123", aborted: false, alreadyRemoved: true },
    });

    await taskRemoveCommand("task-abc");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("exits when task is working without force", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { error: "Task is currently working, use force=true to abort" },
    });

    await expect(taskRemoveCommand("task-abc")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on generic remove error", async () => {
    mockFetchServer.mockResolvedValueOnce(makeStatusWithTask()).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: { error: "Something went wrong" },
    });

    await expect(taskRemoveCommand("task-abc")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("finds task by id prefix", async () => {
    mockFetchServer
      .mockResolvedValueOnce(makeStatusWithTask("task-xyz-789"))
      .mockResolvedValueOnce({
        ok: true,
        data: { ok: true, taskId: "task-xyz-789", aborted: false },
      });

    await taskRemoveCommand("task-xyz");
    expect(mockFetchServer.mock.calls.at(1)?.at(0)).toBe("/api/repos/repo-1/tasks/task-xyz-789");
  });
});
