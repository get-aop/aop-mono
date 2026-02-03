import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon } from "./daemon.ts";

describe("Daemon Signal Handlers", () => {
  let testDir: string;
  let testDbPath: string;
  let testPidFile: string;
  let daemon: ReturnType<typeof createDaemon> | null = null;

  beforeEach(async () => {
    testDir = join(tmpdir(), `daemon-signals-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  test("SIGTERM triggers graceful shutdown", async () => {
    daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);

    process.emit("SIGTERM");
    await Bun.sleep(300);

    expect(daemon.isRunning()).toBe(false);
  });

  test("SIGINT triggers graceful shutdown", async () => {
    daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);

    process.emit("SIGINT");
    await Bun.sleep(300);

    expect(daemon.isRunning()).toBe(false);
  });
});
