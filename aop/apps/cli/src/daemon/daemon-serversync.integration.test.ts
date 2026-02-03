import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerSync } from "../sync/server-sync.ts";
import { createMockServerSync } from "../sync/test-utils.ts";
import { createDaemon } from "./daemon.ts";

describe("Daemon ServerSync Integration", () => {
  let testDir: string;
  let testDbPath: string;
  let testPidFile: string;
  let daemon: ReturnType<typeof createDaemon> | null = null;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `daemon-serversync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");
    testPidFile = join(testDir, "test.pid");
  });

  afterEach(async () => {
    if (daemon?.isRunning()) {
      await daemon.stop();
    }
    daemon = null;
    await Bun.sleep(100);
    rmSync(testDir, { recursive: true, force: true });
  });

  test("getServerSync returns null before start", () => {
    daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });
    expect(daemon.getServerSync()).toBe(null);
  });

  test("getServerSync returns injected serverSync after start", async () => {
    const mockSync = createMockServerSync();
    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();
    expect(daemon.getServerSync()).toBe(mockSync);
  });

  test("daemon authenticates with injected serverSync on start", async () => {
    let authenticateCalled = false;
    let flushQueueCalled = false;
    let retryQueuedCalled = false;

    const mockSync: ServerSync = {
      ...createMockServerSync(),
      authenticate: async () => {
        authenticateCalled = true;
        return { clientId: "test", effectiveMaxConcurrentTasks: 3 };
      },
      flushOfflineQueue: async () => {
        flushQueueCalled = true;
      },
      retryQueuedReadyTasks: async () => {
        retryQueuedCalled = true;
      },
    };

    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();

    expect(authenticateCalled).toBe(true);
    expect(flushQueueCalled).toBe(true);
    expect(retryQueuedCalled).toBe(true);
  });

  test("daemon continues if authentication fails", async () => {
    const mockSync: ServerSync = {
      ...createMockServerSync(),
      authenticate: async () => {
        throw new Error("Auth failed");
      },
    };

    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();
    expect(daemon.isRunning()).toBe(true);
  });

  test("daemon flushes offline queue on shutdown", async () => {
    let flushed = false;
    const mockSync: ServerSync = {
      ...createMockServerSync(),
      getOfflineQueueSize: () => 2,
      flushOfflineQueue: async () => {
        flushed = true;
      },
    };

    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();
    await daemon.stop();

    expect(flushed).toBe(true);
  });

  test("daemon handles flush failure gracefully on shutdown", async () => {
    const mockSync: ServerSync = {
      ...createMockServerSync(),
      getOfflineQueueSize: () => 1,
      flushOfflineQueue: async () => {
        throw new Error("Flush failed");
      },
    };

    daemon = createDaemon({
      dbPath: testDbPath,
      pidFile: testPidFile,
      serverSync: mockSync,
    });

    await daemon.start();
    await daemon.stop();

    expect(daemon.isRunning()).toBe(false);
  });
});
