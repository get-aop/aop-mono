import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
}));

const { configGetCommand } = await import("./config-get.ts");

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

describe("configGetCommand", () => {
  test("fetches all settings when no key provided", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: {
        settings: [
          { key: "max_concurrent", value: "5" },
          { key: "timeout", value: "30" },
        ],
      },
    });

    await configGetCommand();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/settings");
  });

  test("exits when fetching all settings fails", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Server error" },
    });

    await expect(configGetCommand()).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("fetches single setting when key provided", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { key: "max_concurrent", value: "5" },
    });

    await configGetCommand("max_concurrent");
    expect(mockFetchServer).toHaveBeenCalledWith("/api/settings/max_concurrent");
  });

  test("exits with valid keys list on invalid key", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 400,
      error: { error: "Invalid key", validKeys: ["max_concurrent", "timeout"] },
    });

    await expect(configGetCommand("bad_key")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on generic single setting error", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Something went wrong" },
    });

    await expect(configGetCommand("max_concurrent")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
