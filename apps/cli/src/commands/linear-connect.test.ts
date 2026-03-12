import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockRequireServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

const { linearConnectCommand } = await import("./linear-connect.ts");

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

describe("linearConnectCommand", () => {
  test("requests an authorization URL without prompting for a passphrase", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { authorizeUrl: "https://linear.app/oauth/authorize?state=abc" },
    });

    await linearConnectCommand();

    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/linear/connect", {
      method: "POST",
    });
  });

  test("exits when connect fails", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 503,
      error: { error: "Linear OAuth is not configured" },
    });

    await expect(linearConnectCommand()).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
