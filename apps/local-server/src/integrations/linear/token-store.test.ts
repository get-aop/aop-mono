import { beforeEach, describe, expect, test } from "bun:test";

interface LinearTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface ExecResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

interface ExecInvocation {
  args: string[];
  env?: Record<string, string | undefined>;
  stdin?: string;
}

interface LinearTokenStore {
  save(tokens: LinearTokenSet): Promise<void>;
  getStatus(): Promise<{ connected: boolean; locked: boolean }>;
  unlock(): Promise<void>;
  read(): Promise<LinearTokenSet>;
  lock(): Promise<void> | void;
  disconnect(): Promise<void>;
}

interface LinearTokenStoreModule {
  createLinearTokenStore(options?: {
    accountName?: string;
    exec?: (invocation: ExecInvocation) => Promise<ExecResult>;
    platform?: NodeJS.Platform;
    serviceName?: string;
  }): LinearTokenStore;
}

const TOKENS: LinearTokenSet = {
  accessToken: "linear-access-secret",
  refreshToken: "linear-refresh-secret",
  expiresAt: "2026-03-12T12:00:00.000Z",
};

const loadTokenStoreModule = async (): Promise<LinearTokenStoreModule> =>
  (await import("./token-store.ts")) as LinearTokenStoreModule;

describe("integrations/linear/token-store", () => {
  let invocations: ExecInvocation[];
  let responses: ExecResult[];

  beforeEach(() => {
    invocations = [];
    responses = [];
  });

  const exec = async (invocation: ExecInvocation): Promise<ExecResult> => {
    invocations.push(invocation);
    const next = responses.shift();
    if (!next) {
      throw new Error("unexpected exec invocation");
    }
    return next;
  };

  test("stores tokens in macOS Keychain without passing the secret via argv", async () => {
    const { createLinearTokenStore } = await loadTokenStoreModule();
    const store = createLinearTokenStore({ exec, platform: "darwin" });
    responses.push({ exitCode: 0 });

    await store.save(TOKENS);

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.args).toEqual([
      "sh",
      "-lc",
      "security add-generic-password -U -s 'aop.linear.oauth' -a 'default' -w \"$AOP_LINEAR_TOKENS\"",
    ]);
    expect(invocations[0]?.env?.AOP_LINEAR_TOKENS).toBe(JSON.stringify(TOKENS));
    expect(invocations[0]?.args.join(" ")).not.toContain("linear-access-secret");
  });

  test("stores tokens in Linux Secret Service via stdin", async () => {
    const { createLinearTokenStore } = await loadTokenStoreModule();
    const store = createLinearTokenStore({ exec, platform: "linux" });
    responses.push({ exitCode: 0 });

    await store.save(TOKENS);

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.args).toEqual([
      "secret-tool",
      "store",
      "--label",
      "AOP Linear OAuth",
      "service",
      "aop.linear.oauth",
      "account",
      "default",
    ]);
    expect(invocations[0]?.stdin).toBe(JSON.stringify(TOKENS));
  });

  test("starts locked when macOS credentials exist and unlock loads them into memory", async () => {
    const { createLinearTokenStore } = await loadTokenStoreModule();
    const store = createLinearTokenStore({ exec, platform: "darwin" });
    responses.push({ exitCode: 0, stdout: JSON.stringify(TOKENS) });
    responses.push({ exitCode: 0, stdout: JSON.stringify(TOKENS) });

    expect(await store.getStatus()).toEqual({ connected: true, locked: true });
    await expect(store.read()).rejects.toThrow("Linear token store is locked");

    await store.unlock();
    expect(await store.read()).toEqual(TOKENS);
  });

  test("locks again after reading and deletes Linux credentials on disconnect", async () => {
    const { createLinearTokenStore } = await loadTokenStoreModule();
    const store = createLinearTokenStore({ exec, platform: "linux" });
    responses.push({ exitCode: 0, stdout: JSON.stringify(TOKENS) });
    responses.push({ exitCode: 0 });
    responses.push({ exitCode: 1, stderr: "not found" });

    await store.unlock();
    expect((await store.read()).accessToken).toBe("linear-access-secret");

    await store.lock();
    await expect(store.read()).rejects.toThrow("Linear token store is locked");

    await store.disconnect();
    expect(await store.getStatus()).toEqual({
      connected: false,
      locked: true,
    });
  });

  test("getStatus fails closed to disconnected when secure storage is unavailable", async () => {
    const { createLinearTokenStore } = await loadTokenStoreModule();
    const store = createLinearTokenStore({ exec, platform: "linux" });
    responses.push({ exitCode: 127, stderr: "secret-tool: command not found" });

    expect(await store.getStatus()).toEqual({
      connected: false,
      locked: true,
    });
  });
});
