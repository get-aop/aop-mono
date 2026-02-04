import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AOP_URLS } from "@aop/common";
import {
  cleanupTestRepos,
  createTempRepo,
  getFullStatus,
  isLocalServerRunning,
  runAopCommand,
  setupE2ETestDir,
  startLocalServer,
  stopLocalServer,
  type TempRepoResult,
} from "./helpers";

const E2E_TIMEOUT = 60_000;

describe("local server lifecycle", () => {
  let repo: TempRepoResult;

  beforeAll(async () => {
    await setupE2ETestDir();
    repo = await createTempRepo("local-server");
  });

  afterAll(async () => {
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "server starts and responds to health checks",
    async () => {
      // Skip if server is already running (e.g., from bun dev)
      const alreadyRunning = await isLocalServerRunning();
      if (alreadyRunning) {
        // Just verify health check works
        const response = await fetch(`${AOP_URLS.LOCAL_SERVER}/api/health`);
        expect(response.ok).toBe(true);
        const health = (await response.json()) as { ok: boolean };
        expect(health.ok).toBe(true);
        return;
      }

      const serverCtx = await startLocalServer();

      try {
        expect(await isLocalServerRunning()).toBe(true);

        const response = await fetch(`${serverCtx.url}/api/health`);
        expect(response.ok).toBe(true);
        const health = (await response.json()) as { ok: boolean; service: string };
        expect(health.ok).toBe(true);
        expect(health.service).toBe("aop-local-server");
      } finally {
        await stopLocalServer(serverCtx);
      }

      expect(await isLocalServerRunning()).toBe(false);
    },
    E2E_TIMEOUT,
  );

  test(
    "CLI commands fail gracefully when server not running",
    async () => {
      // Skip if server is already running
      const alreadyRunning = await isLocalServerRunning();
      if (alreadyRunning) {
        return;
      }

      const { exitCode, stderr } = await runAopCommand(["status"]);

      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toMatch(/server|connection|refused/);
    },
    E2E_TIMEOUT,
  );

  test(
    "status shows server state correctly",
    async () => {
      // Skip if server is already running (from bun dev)
      const alreadyRunning = await isLocalServerRunning();
      if (alreadyRunning) {
        const status = await getFullStatus();
        expect(status).not.toBeNull();
        expect(status?.ready).toBe(true);
        return;
      }

      const serverCtx = await startLocalServer();

      try {
        const { exitCode, stdout } = await runAopCommand(["status", "--json"]);

        expect(exitCode).toBe(0);
        const status = JSON.parse(stdout);
        expect(status.ready).toBe(true);
        expect(status.globalCapacity).toBeDefined();
        expect(status.globalCapacity.max).toBeGreaterThan(0);
      } finally {
        await stopLocalServer(serverCtx);
      }
    },
    E2E_TIMEOUT,
  );

  test(
    "server handles graceful shutdown",
    async () => {
      // Skip if server is already running
      const alreadyRunning = await isLocalServerRunning();
      if (alreadyRunning) {
        return;
      }

      const serverCtx = await startLocalServer();

      // Verify running
      expect(await isLocalServerRunning()).toBe(true);

      // Stop gracefully
      await stopLocalServer(serverCtx);

      // Verify stopped
      expect(await isLocalServerRunning()).toBe(false);
    },
    E2E_TIMEOUT,
  );
});
