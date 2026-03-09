import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Subprocess } from "bun";
import {
  DASHBOARD_DEV_BIN,
  DASHBOARD_DEV_CWD,
  DASHBOARD_PORT_RANGE,
  E2E_TEST_HOME_DIR,
  LOCAL_SERVER_PORT_RANGE,
} from "./constants";
import { type LocalServerContext, startLocalServer, stopLocalServer } from "./local-server";

export interface DashboardContext {
  process: Subprocess;
  port: number;
  url: string;
}

export interface TestContext {
  localServerPort: number;
  localServerUrl: string;
  localServer: LocalServerContext;
  dashboardPort: number;
  dashboardUrl: string;
  dashboard: DashboardContext;
  dbPath: string;
  baseDir: string;
  reposDir: string;
  env: Record<string, string>;
}

export interface CreateTestContextOptions {
  localServerEnv?: Record<string, string>;
}

export const findFreePort = async (rangeStart: number, rangeEnd: number): Promise<number> => {
  const range = rangeEnd - rangeStart + 1;
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = rangeStart + Math.floor(Math.random() * range);
    const available = await isPortFree(port);
    if (available) return port;
  }
  throw new Error(
    `No free port in range ${rangeStart}-${rangeEnd} — are too many test runs active?`,
  );
};

const isPortFree = async (port: number): Promise<boolean> => {
  try {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
      },
    });
    listener.stop(true);
    return true;
  } catch {
    return false;
  }
};

const startDashboardDev = async (
  port: number,
  localServerUrl: string,
): Promise<DashboardContext> => {
  const url = `http://localhost:${port}`;

  const proc = Bun.spawn({
    cmd: [process.execPath, DASHBOARD_DEV_BIN],
    cwd: DASHBOARD_DEV_CWD,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      AOP_DASHBOARD_PORT: String(port),
      AOP_DASHBOARD_URL: url,
      AOP_LOCAL_SERVER_URL: localServerUrl,
    },
  });

  const healthy = await waitForHealth(url, "/", 15_000);
  if (!healthy) {
    proc.kill();
    throw new Error(`Dashboard dev server failed to start at ${url}`);
  }

  return { process: proc, port, url };
};

const stopDashboardDev = async (ctx: DashboardContext): Promise<void> => {
  ctx.process.kill("SIGTERM");
  await ctx.process.exited;
};

const waitForHealth = async (baseUrl: string, path: string, timeout: number): Promise<boolean> => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await Bun.sleep(200);
  }
  return false;
};

export const createTestContext = async (
  testFilename: string,
  options: CreateTestContextOptions = {},
): Promise<TestContext> => {
  const baseDir = join(E2E_TEST_HOME_DIR, testFilename);
  const reposDir = join(baseDir, "repos");
  const worktreesDir = join(baseDir, "worktrees");
  const dbPath = join(baseDir, "aop.db");

  await rm(baseDir, { recursive: true, force: true });
  await mkdir(reposDir, { recursive: true });
  await mkdir(worktreesDir, { recursive: true });

  const localServerPort = await findFreePort(
    LOCAL_SERVER_PORT_RANGE.min,
    LOCAL_SERVER_PORT_RANGE.max,
  );
  const localServerUrl = `http://localhost:${localServerPort}`;

  const localServer = await startLocalServer({
    port: localServerPort,
    dbPath,
    env: {
      AOP_LOCAL_SERVER_URL: localServerUrl,
      ...options.localServerEnv,
    },
  });

  const dashboardPort = await findFreePort(DASHBOARD_PORT_RANGE.min, DASHBOARD_PORT_RANGE.max);
  const dashboard = await startDashboardDev(dashboardPort, localServerUrl);

  const env: Record<string, string> = {
    ...process.env,
    AOP_LOCAL_SERVER_PORT: String(localServerPort),
    AOP_LOCAL_SERVER_URL: localServerUrl,
    AOP_DB_PATH: dbPath,
  };

  return {
    localServerPort,
    localServerUrl,
    localServer,
    dashboardPort,
    dashboardUrl: dashboard.url,
    dashboard,
    dbPath,
    baseDir,
    reposDir,
    env,
  };
};

export const destroyTestContext = async (ctx: TestContext): Promise<void> => {
  await stopDashboardDev(ctx.dashboard);
  await stopLocalServer(ctx.localServer);
};
