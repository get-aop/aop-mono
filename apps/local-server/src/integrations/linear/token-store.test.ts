import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface LinearTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface LinearTokenStore {
  save(tokens: LinearTokenSet, passphrase: string): Promise<void>;
  getStatus(): Promise<{ connected: boolean; locked: boolean }>;
  unlock(passphrase: string): Promise<void>;
  read(): Promise<LinearTokenSet>;
  lock(): Promise<void> | void;
  disconnect(): Promise<void>;
}

interface LinearTokenStoreModule {
  createLinearTokenStore(options: { filePath: string }): LinearTokenStore;
}

const loadTokenStoreModule = async (): Promise<LinearTokenStoreModule> =>
  (await import("./token-store.ts")) as LinearTokenStoreModule;

describe("integrations/linear/token-store", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aop-linear-token-store-"));
    filePath = join(tempDir, "linear-tokens.enc");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("persists tokens to disk without storing plaintext secrets", async () => {
    const { createLinearTokenStore } = await loadTokenStoreModule();
    const store = createLinearTokenStore({ filePath });

    await store.save(
      {
        accessToken: "linear-access-secret",
        refreshToken: "linear-refresh-secret",
        expiresAt: "2026-03-12T12:00:00.000Z",
      },
      "correct horse battery staple",
    );

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("linear-access-secret");
    expect(raw).not.toContain("linear-refresh-secret");
  });

  test("starts locked when reopening persisted tokens and can be unlocked", async () => {
    const { createLinearTokenStore } = await loadTokenStoreModule();
    const firstStore = createLinearTokenStore({ filePath });
    const expectedTokens: LinearTokenSet = {
      accessToken: "linear-access-secret",
      refreshToken: "linear-refresh-secret",
      expiresAt: "2026-03-12T12:00:00.000Z",
    };

    await firstStore.save(expectedTokens, "correct horse battery staple");

    const reopenedStore = createLinearTokenStore({ filePath });
    expect(await reopenedStore.getStatus()).toEqual({
      connected: true,
      locked: true,
    });

    await expect(reopenedStore.read()).rejects.toThrow("Linear token store is locked");

    await reopenedStore.unlock("correct horse battery staple");
    expect(await reopenedStore.read()).toEqual(expectedTokens);
  });

  test("locks again after reading and deletes secrets on disconnect", async () => {
    const { createLinearTokenStore } = await loadTokenStoreModule();
    const store = createLinearTokenStore({ filePath });

    await store.save(
      {
        accessToken: "linear-access-secret",
        refreshToken: "linear-refresh-secret",
        expiresAt: "2026-03-12T12:00:00.000Z",
      },
      "correct horse battery staple",
    );

    await store.unlock("correct horse battery staple");
    expect((await store.read()).accessToken).toBe("linear-access-secret");

    await store.lock();
    await expect(store.read()).rejects.toThrow("Linear token store is locked");

    await store.disconnect();
    expect(await Bun.file(filePath).exists()).toBe(false);
    expect(await store.getStatus()).toEqual({
      connected: false,
      locked: true,
    });
  });
});
