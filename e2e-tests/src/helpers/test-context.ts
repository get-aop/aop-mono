import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Subprocess } from "bun";
import {
  API_KEY,
  DASHBOARD_DEV_BIN,
  DASHBOARD_DEV_CWD,
  DASHBOARD_PORT_RANGE,
  E2E_TEST_HOME_DIR,
  LOCAL_SERVER_PORT_RANGE,
  REMOTE_SERVER_BIN,
  REMOTE_SERVER_PORT_RANGE,
} from "./constants";
import { type LocalServerContext, startLocalServer, stopLocalServer } from "./local-server";

export interface RemoteServerContext {
  process: Subprocess;
  port: number;
  url: string;
}

export interface DashboardContext {
  process: Subprocess;
  port: number;
  url: string;
}

export interface TestContext {
  localServerPort: number;
  localServerUrl: string;
  localServer: LocalServerContext;
  remoteServerPort: number | null;
  remoteServerUrl: string | null;
  remoteServer: RemoteServerContext | null;
  dashboardPort: number;
  dashboardUrl: string;
  dashboard: DashboardContext;
  dbPath: string;
  baseDir: string;
  reposDir: string;
  pgDatabaseName: string | null;
  pgDatabaseUrl: string | null;
  env: Record<string, string>;
}

export interface CreateTestContextOptions {
  remoteServer?: boolean;
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

const derivePgDatabaseName = (testFilename: string): string => {
  const sanitized = testFilename.replace(/[^a-zA-Z0-9]/g, "_");
  return `aop_e2e_${sanitized}`;
};

const derivePgDatabaseUrl = (dbName: string): string => {
  const baseUrl = process.env.AOP_DATABASE_URL ?? "postgresql://aop:aop@localhost:25432/aop";
  const urlParts = baseUrl.split("/");
  urlParts[urlParts.length - 1] = dbName;
  return urlParts.join("/");
};

const dropAndCreateDatabase = async (pgDatabaseUrl: string, dbName: string): Promise<void> => {
  const { default: postgres } = await import("postgres");
  const baseUrl = pgDatabaseUrl.replace(`/${dbName}`, "/postgres");
  const sql = postgres(baseUrl, { max: 1 });
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await sql.end();
  }
};

const startRemoteServer = async (
  port: number,
  pgDatabaseUrl: string,
): Promise<RemoteServerContext> => {
  const url = `http://localhost:${port}`;

  const proc = Bun.spawn({
    cmd: [process.execPath, REMOTE_SERVER_BIN],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      AOP_SERVER_PORT: String(port),
      AOP_SERVER_URL: url,
      AOP_DATABASE_URL: pgDatabaseUrl,
    },
  });

  const healthy = await waitForHealth(url, "/health", 15_000);
  if (!healthy) {
    proc.kill();
    throw new Error(`Remote server failed to become healthy at ${url}/health`);
  }

  return { process: proc, port, url };
};

const stopRemoteServer = async (ctx: RemoteServerContext): Promise<void> => {
  ctx.process.kill("SIGTERM");
  await ctx.process.exited;
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
  const { remoteServer: needsRemote = true, localServerEnv: extraLocalServerEnv } = options;

  const baseDir = join(E2E_TEST_HOME_DIR, testFilename);
  const reposDir = join(baseDir, "repos");
  const worktreesDir = join(baseDir, "worktrees");
  const dbPath = join(baseDir, "aop.db");

  // Clean slate
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(reposDir, { recursive: true });
  await mkdir(worktreesDir, { recursive: true });

  let remoteCtx: RemoteServerContext | null = null;
  let pgDatabaseName: string | null = null;
  let pgDatabaseUrl: string | null = null;
  let remoteServerPort: number | null = null;
  let remoteServerUrl: string | null = null;

  if (needsRemote) {
    pgDatabaseName = derivePgDatabaseName(testFilename);
    pgDatabaseUrl = derivePgDatabaseUrl(pgDatabaseName);
    await dropAndCreateDatabase(pgDatabaseUrl, pgDatabaseName);

    remoteServerPort = await findFreePort(
      REMOTE_SERVER_PORT_RANGE.min,
      REMOTE_SERVER_PORT_RANGE.max,
    );
    remoteCtx = await startRemoteServer(remoteServerPort, pgDatabaseUrl);
    remoteServerUrl = remoteCtx.url;
  }

  const localServerPort = await findFreePort(
    LOCAL_SERVER_PORT_RANGE.min,
    LOCAL_SERVER_PORT_RANGE.max,
  );
  const localServerUrl = `http://localhost:${localServerPort}`;

  const localServerEnv: Record<string, string> = {
    AOP_LOCAL_SERVER_URL: localServerUrl,
    ...extraLocalServerEnv,
  };
  if (remoteServerUrl) {
    localServerEnv.AOP_SERVER_URL = remoteServerUrl;
    localServerEnv.AOP_API_KEY = API_KEY;
  }

  const localServer = await startLocalServer({
    port: localServerPort,
    dbPath,
    env: localServerEnv,
  });

  const dashboardPort = await findFreePort(DASHBOARD_PORT_RANGE.min, DASHBOARD_PORT_RANGE.max);
  const dashboardCtx = await startDashboardDev(dashboardPort, localServerUrl);

  process.stdout.write(
    `\n[test-context] "${testFilename}" ports → local-server: ${localServerPort}` +
      (remoteServerPort ? ` | remote-server: ${remoteServerPort}` : "") +
      ` | dashboard: ${dashboardCtx.url}\n\n`,
  );

  const env: Record<string, string> = {
    ...process.env,
    AOP_LOCAL_SERVER_PORT: String(localServerPort),
    AOP_LOCAL_SERVER_URL: localServerUrl,
    AOP_DB_PATH: dbPath,
  };
  if (remoteServerUrl) {
    env.AOP_SERVER_URL = remoteServerUrl;
    env.AOP_API_KEY = API_KEY;
  }
  if (pgDatabaseUrl) {
    env.AOP_DATABASE_URL = pgDatabaseUrl;
  }

  return {
    localServerPort,
    localServerUrl,
    localServer,
    remoteServerPort,
    remoteServerUrl,
    remoteServer: remoteCtx,
    dashboardPort,
    dashboardUrl: dashboardCtx.url,
    dashboard: dashboardCtx,
    dbPath,
    baseDir,
    reposDir,
    pgDatabaseName,
    pgDatabaseUrl,
    env,
  };
};

export const destroyTestContext = async (ctx: TestContext): Promise<void> => {
  await stopDashboardDev(ctx.dashboard);
  await stopLocalServer(ctx.localServer);
  if (ctx.remoteServer) {
    await stopRemoteServer(ctx.remoteServer);
  }
};
