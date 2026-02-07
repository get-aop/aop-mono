import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockRequireServer = mock(() => Promise.resolve());

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

const { applyCommand } = await import("./apply.ts");

const originalExit = process.exit;

beforeEach(() => {
  mockFetchServer.mockReset();
  mockRequireServer.mockReset();
  mockRequireServer.mockResolvedValue(undefined);
  process.exit = mock(() => {
    throw new Error("process.exit");
  }) as never;
});

afterEach(() => {
  process.exit = originalExit;
});

describe("applyCommand", () => {
  test("calls requireServer before anything else", async () => {
    mockRequireServer.mockRejectedValue(new Error("process.exit"));
    await expect(applyCommand("task-1")).rejects.toThrow("process.exit");
    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockFetchServer).not.toHaveBeenCalled();
  });

  test("exits when task resolve returns 404", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 404,
      error: { error: "Not found" },
    });

    await expect(applyCommand("missing-task")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits when task resolve returns other error", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Internal server error" },
    });

    await expect(applyCommand("task-1")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on apply 404 - Task not found", async () => {
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: { task: { id: "t1", repo_id: "r1", status: "DONE" } },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        error: { error: "Task not found" },
      });

    await expect(applyCommand("t1")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on apply 409 - Invalid task status", async () => {
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: { task: { id: "t1", repo_id: "r1", status: "DONE" } },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: { error: "Invalid task status", status: "WORKING" },
      });

    await expect(applyCommand("t1")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on apply 409 - uncommitted changes", async () => {
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: { task: { id: "t1", repo_id: "r1", status: "DONE" } },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: { error: "Main repository has uncommitted changes" },
      });

    await expect(applyCommand("t1")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on apply 409 - Conflicts detected", async () => {
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: { task: { id: "t1", repo_id: "r1", status: "DONE" } },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: { error: "Conflicts detected", conflictingFiles: ["a.ts", "b.ts"] },
      });

    await expect(applyCommand("t1")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("succeeds with noChanges", async () => {
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: { task: { id: "t1", repo_id: "r1", status: "DONE" } },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { ok: true, affectedFiles: [], noChanges: true },
      });

    await applyCommand("t1");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("succeeds with affected files", async () => {
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: { task: { id: "t1", repo_id: "r1", status: "DONE" } },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { ok: true, affectedFiles: ["src/a.ts", "src/b.ts"] },
      });

    await applyCommand("t1");
    expect(process.exit).not.toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledTimes(2);
    expect(mockFetchServer.mock.calls.at(1)?.at(0)).toBe("/api/repos/r1/tasks/t1/apply");
    expect(mockFetchServer.mock.calls.at(1)?.at(1)).toEqual({ method: "POST" });
  });

  test("encodes identifier in resolve URL", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 404,
      error: { error: "Not found" },
    });

    await expect(applyCommand("my task/name")).rejects.toThrow("process.exit");
    expect(mockFetchServer.mock.calls.at(0)?.at(0)).toBe(
      `/api/tasks/resolve/${encodeURIComponent("my task/name")}`,
    );
  });
});
