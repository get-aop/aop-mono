import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
}));

const { repoInitCommand } = await import("./repo-init.ts");

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

describe("repoInitCommand", () => {
  test("sends POST with given path", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { ok: true, repoId: "repo-1", alreadyExists: false },
    });

    await repoInitCommand("/home/user/project");
    expect(mockFetchServer).toHaveBeenCalledWith("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/home/user/project" }),
    });
  });

  test("uses cwd when no path provided", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { ok: true, repoId: "repo-1", alreadyExists: false },
    });

    await repoInitCommand();
    const call = mockFetchServer.mock.calls.at(0);
    const body = JSON.parse(call?.at(1)?.body);
    expect(body.path).toBe(process.cwd());
  });

  test("completes successfully for new repo", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { ok: true, repoId: "repo-1", alreadyExists: false },
    });

    await repoInitCommand("/some/path");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("completes successfully when repo already exists", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { ok: true, repoId: "repo-1", alreadyExists: true },
    });

    await repoInitCommand("/some/path");
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("exits on not a git repository error", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 400,
      error: { error: "Not a git repository" },
    });

    await expect(repoInitCommand("/tmp/not-git")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on generic error", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Unknown failure" },
    });

    await expect(repoInitCommand("/some/path")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
