import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockRequireServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

const { linearUnlockCommand } = await import("./linear-unlock.ts");

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

describe("linearUnlockCommand", () => {
  test("unlocks the token store without prompting for a passphrase", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { ok: true },
    });

    await linearUnlockCommand();

    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/linear/unlock", {
      method: "POST",
    });
  });

  test("exits when unlock fails", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 409,
      error: { error: "Linear secure storage is unavailable" },
    });

    await expect(linearUnlockCommand()).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
