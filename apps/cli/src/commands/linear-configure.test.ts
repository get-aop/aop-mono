import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockRequireServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

const { linearConfigureCommand } = await import("./linear-configure.ts");

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

describe("linearConfigureCommand", () => {
  test("saves client id and callback URL together", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        settings: [
          { key: "linear_client_id", value: "linear-client-id" },
          { key: "linear_callback_url", value: "http://127.0.0.1:4310/api/linear/callback" },
        ],
      },
    });

    await linearConfigureCommand({
      clientId: "linear-client-id",
      callbackUrl: "http://127.0.0.1:4310/api/linear/callback",
    });

    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: [
          { key: "linear_client_id", value: "linear-client-id" },
          { key: "linear_callback_url", value: "http://127.0.0.1:4310/api/linear/callback" },
        ],
      }),
    });
  });

  test("exits when no options are provided", async () => {
    await expect(linearConfigureCommand({})).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
