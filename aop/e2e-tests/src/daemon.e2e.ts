import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  cleanupTestRepos,
  createTempRepo,
  isDaemonRunning,
  runAopCommand,
  setupE2ETestDir,
  startDaemon,
  stopDaemon,
  type TempRepoResult,
} from "./helpers";

const E2E_TIMEOUT = 60_000;

describe("daemon lifecycle", () => {
  let repo: TempRepoResult;

  beforeAll(async () => {
    await setupE2ETestDir();
    repo = await createTempRepo("daemon");
  });

  afterAll(async () => {
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "start creates PID file and stop removes it",
    async () => {
      const { success, pid, context, wasAlreadyRunning } = await startDaemon();

      expect(success).toBe(true);
      expect(pid).toBeGreaterThan(0);
      expect(existsSync(context.pidFile)).toBe(true);
      expect(isDaemonRunning(context)).toBe(true);

      if (!wasAlreadyRunning) {
        const stopped = await stopDaemon(context, wasAlreadyRunning);

        expect(stopped).toBe(true);
        expect(existsSync(context.pidFile)).toBe(false);
        expect(isDaemonRunning(context)).toBe(false);
      }
    },
    E2E_TIMEOUT,
  );

  test(
    "start when already running reports existing daemon",
    async () => {
      const first = await startDaemon();
      expect(first.success).toBe(true);

      try {
        const { exitCode, stdout } = await runAopCommand(["start"]);

        expect(exitCode).toBe(0);
        expect(stdout).toContain("already running");
      } finally {
        await stopDaemon(first.context, first.wasAlreadyRunning);
      }
    },
    E2E_TIMEOUT,
  );

  test(
    "stop when not running reports no daemon",
    async () => {
      const { context, wasAlreadyRunning: alreadyRunning } = await startDaemon();
      await stopDaemon(context, alreadyRunning);

      if (!alreadyRunning) {
        const { exitCode, stdout } = await runAopCommand(["stop"]);

        expect(exitCode).toBe(0);
        expect(stdout).toContain("No daemon");
      }
    },
    E2E_TIMEOUT,
  );

  test(
    "status shows daemon state correctly",
    async () => {
      const { context, wasAlreadyRunning: alreadyRunning } = await startDaemon();

      try {
        const { exitCode, stdout } = await runAopCommand(["status", "--json"]);

        expect(exitCode).toBe(0);
        const status = JSON.parse(stdout);
        expect(status.daemon.running).toBe(true);
        expect(status.daemon.pid).toBeGreaterThan(0);
      } finally {
        await stopDaemon(context, alreadyRunning);
      }

      if (!alreadyRunning) {
        const { exitCode: afterExitCode, stdout: afterStdout } = await runAopCommand([
          "status",
          "--json",
        ]);

        expect(afterExitCode).toBe(0);
        const afterStatus = JSON.parse(afterStdout);
        expect(afterStatus.daemon.running).toBe(false);
        expect(afterStatus.daemon.pid).toBeNull();
      }
    },
    E2E_TIMEOUT,
  );
});
