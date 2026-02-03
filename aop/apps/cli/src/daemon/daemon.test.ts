import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createDaemon,
  getDaemonPid,
  getDefaultPidFile,
  isDaemonRunning,
  isProcessAlive,
  notifyDaemon,
  stopDaemonByPid,
} from "./daemon.ts";

describe("isProcessAlive", () => {
  test("returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("returns false for non-existent process", () => {
    expect(isProcessAlive(999999999)).toBe(false);
  });
});

describe("isDaemonRunning", () => {
  let testPidFile: string;

  beforeEach(() => {
    testPidFile = join(tmpdir(), `aop-test-${Date.now()}.pid`);
  });

  afterEach(() => {
    if (existsSync(testPidFile)) {
      unlinkSync(testPidFile);
    }
  });

  test("returns false when pid file does not exist", () => {
    expect(isDaemonRunning(testPidFile)).toBe(false);
  });

  test("returns true when pid file contains current process pid", () => {
    writeFileSync(testPidFile, String(process.pid));
    expect(isDaemonRunning(testPidFile)).toBe(true);
  });

  test("returns false when pid file contains dead process pid", () => {
    writeFileSync(testPidFile, "999999999");
    expect(isDaemonRunning(testPidFile)).toBe(false);
  });

  test("returns false when pid file contains invalid content", () => {
    writeFileSync(testPidFile, "not-a-number");
    expect(isDaemonRunning(testPidFile)).toBe(false);
  });
});

describe("getDaemonPid", () => {
  let testPidFile: string;

  beforeEach(() => {
    testPidFile = join(tmpdir(), `aop-test-pid-${Date.now()}.pid`);
  });

  afterEach(() => {
    if (existsSync(testPidFile)) {
      unlinkSync(testPidFile);
    }
  });

  test("returns null when pid file does not exist", () => {
    expect(getDaemonPid(testPidFile)).toBe(null);
  });

  test("returns pid when process is alive", () => {
    writeFileSync(testPidFile, String(process.pid));
    expect(getDaemonPid(testPidFile)).toBe(process.pid);
  });

  test("returns null when process is dead", () => {
    writeFileSync(testPidFile, "999999999");
    expect(getDaemonPid(testPidFile)).toBe(null);
  });

  test("returns null when pid file contains invalid content", () => {
    writeFileSync(testPidFile, "invalid");
    expect(getDaemonPid(testPidFile)).toBe(null);
  });
});

describe("stopDaemonByPid", () => {
  let testPidFile: string;

  beforeEach(() => {
    testPidFile = join(tmpdir(), `aop-test-stop-${Date.now()}.pid`);
  });

  afterEach(() => {
    if (existsSync(testPidFile)) {
      unlinkSync(testPidFile);
    }
  });

  test("returns false when pid file does not exist", () => {
    expect(stopDaemonByPid(testPidFile)).toBe(false);
  });

  test("returns false when process is dead", () => {
    writeFileSync(testPidFile, "999999999");
    expect(stopDaemonByPid(testPidFile)).toBe(false);
  });
});

describe("notifyDaemon", () => {
  let testPidFile: string;

  beforeEach(() => {
    testPidFile = join(tmpdir(), `aop-test-notify-${Date.now()}.pid`);
  });

  afterEach(() => {
    if (existsSync(testPidFile)) {
      unlinkSync(testPidFile);
    }
  });

  test("returns false when pid file does not exist", () => {
    expect(notifyDaemon(testPidFile)).toBe(false);
  });

  test("returns false when process is dead", () => {
    writeFileSync(testPidFile, "999999999");
    expect(notifyDaemon(testPidFile)).toBe(false);
  });

  test("returns true when sending signal to alive process", async () => {
    // Set up a temporary handler so the test process doesn't die
    const signalPromise = new Promise<void>((resolve) => {
      const handler = () => {
        process.removeListener("SIGUSR1", handler);
        resolve();
      };
      process.on("SIGUSR1", handler);
    });

    writeFileSync(testPidFile, String(process.pid));
    expect(notifyDaemon(testPidFile)).toBe(true);

    // Wait for signal to be delivered
    await signalPromise;
  });
});

describe("getDefaultPidFile", () => {
  test("returns path under home directory", () => {
    const pidFile = getDefaultPidFile();
    expect(pidFile).toContain(".aop");
    expect(pidFile).toContain("aop.pid");
  });
});

describe("createDaemon", () => {
  let tempDir: string;
  let testPidFile: string;
  let testDbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "daemon-test-"));
    testPidFile = join(tempDir, "test.pid");
    testDbPath = join(tempDir, "test.db");
  });

  afterEach(async () => {
    if (existsSync(testPidFile)) {
      unlinkSync(testPidFile);
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns daemon interface with start, stop, isRunning", () => {
    const daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    expect(typeof daemon.start).toBe("function");
    expect(typeof daemon.stop).toBe("function");
    expect(typeof daemon.isRunning).toBe("function");
  });

  test("isRunning returns false before start", () => {
    const daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });
    expect(daemon.isRunning()).toBe(false);
  });

  test("creates pid file on start", async () => {
    const daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    await daemon.start();

    expect(existsSync(testPidFile)).toBe(true);
    expect(daemon.isRunning()).toBe(true);

    await daemon.stop();
  });

  test("removes pid file on stop", async () => {
    const daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    await daemon.start();
    expect(existsSync(testPidFile)).toBe(true);

    await daemon.stop();
    expect(existsSync(testPidFile)).toBe(false);
    expect(daemon.isRunning()).toBe(false);
  });

  test("isRunning returns true after start", async () => {
    const daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    await daemon.start();
    expect(daemon.isRunning()).toBe(true);

    await daemon.stop();
    expect(daemon.isRunning()).toBe(false);
  });

  test("start is idempotent when already running", async () => {
    const daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    await daemon.start();
    await daemon.start();

    expect(daemon.isRunning()).toBe(true);

    await daemon.stop();
  });

  test("stop is idempotent when not running", async () => {
    const daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    await daemon.stop();
    await daemon.stop();

    expect(daemon.isRunning()).toBe(false);
  });

  test("stop handles concurrent calls", async () => {
    const daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    await daemon.start();

    const [result1, result2] = await Promise.all([daemon.stop(), daemon.stop()]);

    expect(result1).toBeUndefined();
    expect(result2).toBeUndefined();
    expect(daemon.isRunning()).toBe(false);
  });

  test("uses default paths when config is empty", () => {
    const daemon = createDaemon({});
    expect(daemon.isRunning()).toBe(false);
  });
});

describe("Daemon PID file operations", () => {
  let tempDir: string;
  let testPidFile: string;
  let testDbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "daemon-pid-test-"));
    testPidFile = join(tempDir, "nested", "dir", "test.pid");
    testDbPath = join(tempDir, "test.db");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates pid file in nested directory", async () => {
    mkdirSync(dirname(testPidFile), { recursive: true });

    const daemon = createDaemon({ dbPath: testDbPath, pidFile: testPidFile });

    await daemon.start();
    expect(existsSync(testPidFile)).toBe(true);

    await daemon.stop();
  });
});
