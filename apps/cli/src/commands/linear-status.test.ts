import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockRequireServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

const { linearStatusCommand } = await import("./linear-status.ts");

const originalExit = process.exit;

beforeEach(() => {
  mockFetchServer.mockReset();
  mockRequireServer.mockReset();
  process.exit = mock(() => {
    throw new Error("process.exit");
  }) as never;
});

afterEach(() => {
  process.exit = originalExit;
});

describe("linearStatusCommand", () => {
  test("reads only connection status when Linear is disconnected", async () => {
    mockFetchServer.mockResolvedValueOnce({
      ok: true,
      data: { connected: false, locked: true },
    });

    await linearStatusCommand();

    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledTimes(1);
    expect(mockFetchServer).toHaveBeenCalledWith("/api/linear/status");
  });

  test("does not probe Linear when the token store is locked", async () => {
    mockFetchServer.mockResolvedValueOnce({
      ok: true,
      data: { connected: true, locked: true },
    });

    await linearStatusCommand();

    expect(mockFetchServer).toHaveBeenCalledTimes(1);
    expect(mockFetchServer).toHaveBeenCalledWith("/api/linear/status");
  });

  test("loads workspace details when Linear is connected and unlocked", async () => {
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: { connected: true, locked: false },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          organizationName: "Acme",
          userName: "Jane Doe",
          userEmail: "jane@example.com",
        },
      });

    await linearStatusCommand();

    expect(mockFetchServer).toHaveBeenNthCalledWith(1, "/api/linear/status");
    expect(mockFetchServer).toHaveBeenNthCalledWith(2, "/api/linear/test-connection", {
      method: "POST",
    });
  });

  test("exits when loading connection status fails", async () => {
    mockFetchServer.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: { error: "boom" },
    });

    await expect(linearStatusCommand()).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
