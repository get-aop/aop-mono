import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockPromptForPassphrase = mock();
const mockRequireServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

mock.module("./linear-passphrase.ts", () => ({
  promptForPassphrase: mockPromptForPassphrase,
}));

const { linearUnlockCommand } = await import("./linear-unlock.ts");

const originalExit = process.exit;

beforeEach(() => {
  mockFetchServer.mockReset();
  mockPromptForPassphrase.mockReset();
  mockRequireServer.mockReset();
  process.exit = mock(() => {
    throw new Error("process.exit");
  }) as never;
});

afterEach(() => {
  process.exit = originalExit;
});

describe("linearUnlockCommand", () => {
  test("prompts for a passphrase and unlocks the token store", async () => {
    mockPromptForPassphrase.mockResolvedValue("correct horse battery staple");
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { ok: true },
    });

    await linearUnlockCommand();

    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockPromptForPassphrase).toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/linear/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "correct horse battery staple" }),
    });
  });

  test("exits when unlock fails", async () => {
    mockPromptForPassphrase.mockResolvedValue("wrong passphrase");
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 409,
      error: { error: "Invalid Linear token store passphrase" },
    });

    await expect(linearUnlockCommand()).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
