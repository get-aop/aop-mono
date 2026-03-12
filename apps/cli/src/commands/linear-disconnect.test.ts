import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockRequireServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

const { linearDisconnectCommand } = await import("./linear-disconnect.ts");

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

describe("linearDisconnectCommand", () => {
  test("disconnects Linear integration", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { ok: true },
    });

    await linearDisconnectCommand();

    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/linear/disconnect", {
      method: "POST",
    });
  });

  test("exits when disconnect fails", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Disconnect failed" },
    });

    await expect(linearDisconnectCommand()).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
