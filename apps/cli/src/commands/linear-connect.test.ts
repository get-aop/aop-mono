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

const { linearConnectCommand } = await import("./linear-connect.ts");

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

describe("linearConnectCommand", () => {
  test("prompts for a passphrase and requests an authorization URL", async () => {
    mockPromptForPassphrase.mockResolvedValue("correct horse battery staple");
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { authorizeUrl: "https://linear.app/oauth/authorize?state=abc" },
    });

    await linearConnectCommand();

    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockPromptForPassphrase).toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/linear/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "correct horse battery staple" }),
    });
  });

  test("exits when connect fails", async () => {
    mockPromptForPassphrase.mockResolvedValue("correct horse battery staple");
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 503,
      error: { error: "Linear OAuth is not configured" },
    });

    await expect(linearConnectCommand()).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
