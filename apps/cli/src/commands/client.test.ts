import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

process.env.AOP_LOCAL_SERVER_PORT ??= "4111";
process.env.AOP_LOCAL_SERVER_URL ??= "http://127.0.0.1:4111";

const clientModulePath = "./client.ts?client-test";
const clientModule = await import(clientModulePath);
const { fetchServer, getServerUrl, isServerRunning, requireServer } =
  clientModule as typeof import("./client.ts");

const originalExit = process.exit;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.exit = mock((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never;
});

afterEach(() => {
  process.exit = originalExit;
  globalThis.fetch = originalFetch;
});

describe("getServerUrl", () => {
  test("returns local server URL from config", () => {
    const serverUrl = getServerUrl();
    expect(typeof serverUrl).toBe("string");
    expect(serverUrl.length).toBeGreaterThan(0);
  });

  test("falls back to the source install local server URL when env is unset", () => {
    const originalServerUrl = process.env.AOP_LOCAL_SERVER_URL;
    delete process.env.AOP_LOCAL_SERVER_URL;

    expect(getServerUrl()).toBe("http://127.0.0.1:25150");

    if (originalServerUrl === undefined) {
      delete process.env.AOP_LOCAL_SERVER_URL;
      return;
    }

    process.env.AOP_LOCAL_SERVER_URL = originalServerUrl;
  });
});

describe("isServerRunning", () => {
  test("returns true when health endpoint is ok", async () => {
    globalThis.fetch = mock(async () => ({ ok: true })) as unknown as typeof fetch;

    await expect(isServerRunning()).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(`${getServerUrl()}/api/health`, {
      signal: expect.any(AbortSignal),
    });
  });

  test("returns false when health endpoint is not ok", async () => {
    globalThis.fetch = mock(async () => ({ ok: false })) as unknown as typeof fetch;

    await expect(isServerRunning()).resolves.toBe(false);
  });

  test("returns false when fetch throws", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    await expect(isServerRunning()).resolves.toBe(false);
  });
});

describe("requireServer", () => {
  test("does not exit when server is healthy", async () => {
    globalThis.fetch = mock(async () => ({ ok: true })) as unknown as typeof fetch;

    await expect(requireServer()).resolves.toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("logs error and exits when server is not healthy", async () => {
    globalThis.fetch = mock(async () => ({ ok: false })) as unknown as typeof fetch;

    await expect(requireServer()).rejects.toThrow("process.exit:1");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("fetchServer", () => {
  test("returns ok=true and parsed data for successful responses", async () => {
    const body = { status: "ok", value: 42 };
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => body,
    })) as unknown as typeof fetch;

    const result = await fetchServer<{ status: string; value: number }>("/api/status", {
      method: "GET",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(`${getServerUrl()}/api/status`, {
      method: "GET",
    });
    expect(result).toEqual({ ok: true, data: body });
  });

  test("returns ok=false with status and error payload for failed responses", async () => {
    const errorBody = { error: "bad request", detail: "invalid input" };
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 400,
      json: async () => errorBody,
    })) as unknown as typeof fetch;

    const result = await fetchServer<{ status: string }>("/api/create-task/start", {
      method: "POST",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: errorBody,
    });
  });
});
