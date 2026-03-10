import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
}));

const { statusCommand } = await import("./status.ts");

const originalExit = process.exit;
const originalWrite = Bun.write;

beforeEach(() => {
  mockFetchServer.mockReset();
  process.exit = mock(() => {
    throw new Error("process.exit");
  }) as never;
});

afterEach(() => {
  process.exit = originalExit;
  Bun.write = originalWrite;
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-abc-123",
  repoId: "repo-1",
  changePath: "changes/my-feature",
  status: "DONE",
  baseBranch: "main",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T01:00:00Z",
  ...overrides,
});

const makeStatusResponse = (tasks = [makeTask()]) => ({
  ok: true,
  data: {
    globalCapacity: { working: 1, max: 5 },
    repos: [
      {
        id: "repo-1",
        name: "my-repo",
        path: "/home/user/project",
        working: 1,
        max: 3,
        tasks,
      },
    ],
  },
});

describe("statusCommand - full status", () => {
  test("fetches and displays status", async () => {
    mockFetchServer.mockResolvedValue(makeStatusResponse());
    await statusCommand();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/status");
  });

  test("exits when status fetch fails", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Server error" },
    });

    await expect(statusCommand()).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("handles empty repos list", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { globalCapacity: { working: 0, max: 5 }, repos: [] },
    });

    await statusCommand();
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("outputs JSON when json option set", async () => {
    const statusData = makeStatusResponse();
    mockFetchServer.mockResolvedValue(statusData);

    let written = "";
    Bun.write = mock((_dest: unknown, data: Uint8Array) => {
      written += new TextDecoder().decode(data);
      return Promise.resolve(data.byteLength);
    }) as unknown as typeof Bun.write;

    await statusCommand(undefined, { json: true });
    const parsed = JSON.parse(written.trim());
    expect(parsed.globalCapacity).toEqual({ working: 1, max: 5 });
  });
});

describe("statusCommand - single task", () => {
  test("finds task by full id", async () => {
    mockFetchServer.mockResolvedValue(makeStatusResponse());
    await statusCommand("task-abc-123");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("finds task by id prefix", async () => {
    mockFetchServer.mockResolvedValue(makeStatusResponse());
    await statusCommand("task-abc");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("finds task by changePath", async () => {
    mockFetchServer.mockResolvedValue(makeStatusResponse());
    await statusCommand("changes/my-feature");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("finds task by changePath suffix (change name only)", async () => {
    mockFetchServer.mockResolvedValue(makeStatusResponse());
    await statusCommand("my-feature");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("finds task by full path including repo path", async () => {
    mockFetchServer.mockResolvedValue(makeStatusResponse());
    await statusCommand("/home/user/project/changes/my-feature");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("exits when task not found", async () => {
    mockFetchServer.mockResolvedValue(makeStatusResponse());
    await expect(statusCommand("nonexistent")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("outputs task not found as JSON when json option set", async () => {
    mockFetchServer.mockResolvedValue(makeStatusResponse());

    let written = "";
    Bun.write = mock((_dest: unknown, data: Uint8Array) => {
      written += new TextDecoder().decode(data);
      return Promise.resolve(data.byteLength);
    }) as unknown as typeof Bun.write;

    await expect(statusCommand("nonexistent", { json: true })).rejects.toThrow("process.exit");
    const parsed = JSON.parse(written.trim());
    expect(parsed.error).toBe("Task not found");
  });

  test("outputs found task as JSON when json option set", async () => {
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: {
          task: {
            id: "task-abc-123",
            status: "DONE",
            worktree_path: null,
          },
        },
      })
      .mockResolvedValue(makeStatusResponse());

    let written = "";
    Bun.write = mock((_dest: unknown, data: Uint8Array) => {
      written += new TextDecoder().decode(data);
      return Promise.resolve(data.byteLength);
    }) as unknown as typeof Bun.write;

    await statusCommand("task-abc-123", { json: true });
    const parsed = JSON.parse(written.trim());
    expect(parsed.id).toBe("task-abc-123");
    expect(parsed.status).toBe("DONE");
    expect(parsed.worktree_path).toBeNull();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/tasks/resolve/task-abc-123");
  });
});
