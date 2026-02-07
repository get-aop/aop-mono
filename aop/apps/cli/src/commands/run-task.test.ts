import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockRequireServer = mock(() => Promise.resolve());

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

const { runTaskCommand } = await import("./run-task.ts");

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

describe("runTaskCommand", () => {
  test("calls requireServer before fetching", async () => {
    mockRequireServer.mockRejectedValue(new Error("process.exit"));
    await expect(runTaskCommand("my-change")).rejects.toThrow("process.exit");
    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockFetchServer).not.toHaveBeenCalled();
  });

  test("sends POST with changeName and cwd", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { status: "success", changeName: "my-change", sessionId: "s1" },
    });

    await runTaskCommand("my-change");
    expect(mockFetchServer).toHaveBeenCalledWith("/api/run-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeName: "my-change", cwd: process.cwd() }),
    });
  });

  test("succeeds without warning", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { status: "success", changeName: "my-change", sessionId: "s1" },
    });

    await runTaskCommand("my-change");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("succeeds with warning", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: {
        status: "success",
        changeName: "my-change",
        sessionId: "s1",
        warning: "Task already exists",
      },
    });

    await runTaskCommand("my-change");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("exits on server error response", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Failed to start task" },
    });

    await expect(runTaskCommand("my-change")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on fetch exception", async () => {
    mockFetchServer.mockRejectedValue(new Error("Network failure"));

    await expect(runTaskCommand("my-change")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
