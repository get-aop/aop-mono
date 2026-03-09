import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestContext,
  destroyTestContext,
  findFreePort,
  isLocalServerRunning,
  LOCAL_SERVER_PORT_RANGE,
  runAopCommand,
  startLocalServer,
  stopLocalServer,
  type TestContext,
} from "./helpers";

const E2E_TIMEOUT = 60_000;

describe("local server lifecycle", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext("local-server");
  });

  afterAll(async () => {
    await destroyTestContext(ctx);
  });

  test(
    "server starts and responds to health checks",
    async () => {
      expect(await isLocalServerRunning(ctx.localServerUrl)).toBe(true);

      const response = await fetch(`${ctx.localServerUrl}/api/health`);
      expect(response.ok).toBe(true);
      const health = (await response.json()) as { ok: boolean; service: string };
      expect(health.ok).toBe(true);
      expect(health.service).toBe("aop");
    },
    E2E_TIMEOUT,
  );

  test(
    "CLI commands fail gracefully when server not running",
    async () => {
      // Use a port that nothing is listening on
      const deadUrl = "http://localhost:19999";
      const env = { ...ctx.env, AOP_LOCAL_SERVER_URL: deadUrl };
      const { exitCode, stderr } = await runAopCommand(["status"], undefined, env);

      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toMatch(/server|connection|refused/);
    },
    E2E_TIMEOUT,
  );

  test(
    "status shows server state correctly",
    async () => {
      const { exitCode, stdout } = await runAopCommand(["status", "--json"], undefined, ctx.env);

      expect(exitCode).toBe(0);
      const status = JSON.parse(stdout);
      expect(status.ready).toBe(true);
      expect(status.globalCapacity).toBeDefined();
      expect(status.globalCapacity.max).toBeGreaterThan(0);
    },
    E2E_TIMEOUT,
  );

  test(
    "server handles graceful shutdown",
    async () => {
      const secondPort = await findFreePort(
        LOCAL_SERVER_PORT_RANGE.min,
        LOCAL_SERVER_PORT_RANGE.max,
      );
      const secondServer = await startLocalServer({ port: secondPort, dbPath: ctx.dbPath });
      const secondUrl = secondServer.url;

      expect(await isLocalServerRunning(secondUrl)).toBe(true);

      await stopLocalServer(secondServer);

      expect(await isLocalServerRunning(secondUrl)).toBe(false);
    },
    E2E_TIMEOUT,
  );
});
