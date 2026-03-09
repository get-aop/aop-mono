import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
}));

const { configSetCommand } = await import("./config-set.ts");

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

describe("configSetCommand", () => {
  test("sends PUT with key and value", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { ok: true, key: "max_concurrent", value: "10" },
    });

    await configSetCommand("max_concurrent", "10");
    expect(mockFetchServer).toHaveBeenCalledWith("/api/settings/max_concurrent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "10" }),
    });
  });

  test("exits on invalid key with valid keys list", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 400,
      error: { error: "Invalid key", validKeys: ["max_concurrent", "timeout"] },
    });

    await expect(configSetCommand("bad_key", "val")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on generic error", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Server error" },
    });

    await expect(configSetCommand("max_concurrent", "10")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
