import type { Subprocess } from "bun";
import { DEFAULT_LOCAL_SERVER_PORT, DEFAULT_LOCAL_SERVER_URL, LOCAL_SERVER_BIN } from "./constants";

export interface LocalServerContext {
  process: Subprocess;
  port: number;
  url: string;
}

export interface StartLocalServerOptions {
  port?: number;
  dbPath?: string;
}

export const startLocalServer = async (
  options: StartLocalServerOptions = {},
): Promise<LocalServerContext> => {
  const port = options.port ?? DEFAULT_LOCAL_SERVER_PORT;
  const url = `http://localhost:${port}`;

  const env: Record<string, string> = {
    ...process.env,
    AOP_PORT: String(port),
  };

  if (options.dbPath) {
    env.AOP_DB_PATH = options.dbPath;
  }

  const proc = Bun.spawn({
    cmd: [process.execPath, LOCAL_SERVER_BIN],
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  // Wait for server to be ready
  const ready = await waitForServerReady(url, { timeout: 10_000 });
  if (!ready) {
    proc.kill();
    throw new Error("Local server failed to start within timeout");
  }

  return { process: proc, port, url };
};

export const stopLocalServer = async (ctx: LocalServerContext): Promise<void> => {
  ctx.process.kill("SIGTERM");
  await ctx.process.exited;
};

export const isLocalServerRunning = async (url?: string): Promise<boolean> => {
  const serverUrl = url ?? DEFAULT_LOCAL_SERVER_URL;
  try {
    const response = await fetch(`${serverUrl}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

interface WaitForServerReadyOptions {
  timeout?: number;
  pollInterval?: number;
}

const waitForServerReady = async (
  url: string,
  options: WaitForServerReadyOptions = {},
): Promise<boolean> => {
  const { timeout = 10_000, pollInterval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const running = await isLocalServerRunning(url);
    if (running) {
      return true;
    }
    await Bun.sleep(pollInterval);
  }

  return false;
};

export const requireLocalServer = async (url?: string): Promise<void> => {
  const running = await isLocalServerRunning(url);
  if (!running) {
    throw new Error(
      `Local server not running at ${url ?? DEFAULT_LOCAL_SERVER_URL}.\n` +
        "Start it with: bun run apps/local-server/src/run.ts\n" +
        "Or use: bun dev",
    );
  }
};

export const triggerServerRefresh = async (url?: string): Promise<boolean> => {
  const serverUrl = url ?? DEFAULT_LOCAL_SERVER_URL;
  try {
    const response = await fetch(`${serverUrl}/api/refresh`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Directly set task status via test-only API endpoint.
 * Requires AOP_TEST_MODE=true on the server.
 */
export const setTaskStatus = async (
  taskId: string,
  status: string,
  url?: string,
): Promise<boolean> => {
  const serverUrl = url ?? DEFAULT_LOCAL_SERVER_URL;
  try {
    const response = await fetch(`${serverUrl}/api/tasks/${taskId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
};
