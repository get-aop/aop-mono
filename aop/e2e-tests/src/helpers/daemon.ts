import { AOP_BIN, API_KEY, getAopEnv, SERVER_URL } from "./constants";
import {
  isLocalServerRunning,
  type LocalServerContext,
  requireLocalServer,
  startLocalServer,
  stopLocalServer,
} from "./local-server";

export interface DaemonContext {
  localServer: LocalServerContext | null;
  env: NodeJS.ProcessEnv;
}

export interface StartDaemonResult {
  success: boolean;
  context: DaemonContext;
  wasAlreadyRunning: boolean;
}

export const runAopCommand = async (
  args: string[],
  cwd?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const proc = Bun.spawn({
    cmd: [process.execPath, AOP_BIN, ...args],
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: getAopEnv(),
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { exitCode, stdout, stderr };
};

export interface StartDaemonOptions {
  configureServer?: boolean;
  dbPath?: string;
}

export const startDaemon = async (options: StartDaemonOptions = {}): Promise<StartDaemonResult> => {
  const { configureServer = true } = options;
  const env = getAopEnv();

  // Check if local server is already running
  const alreadyRunning = await isLocalServerRunning();
  if (alreadyRunning) {
    return {
      success: true,
      context: { localServer: null, env },
      wasAlreadyRunning: true,
    };
  }

  // Start local server
  const localServer = await startLocalServer({ dbPath: options.dbPath });

  // Configure server connection if requested
  if (configureServer) {
    await runAopCommand(["config:set", "server_url", SERVER_URL]);
    await runAopCommand(["config:set", "api_key", API_KEY]);
  }

  return {
    success: true,
    context: { localServer, env },
    wasAlreadyRunning: false,
  };
};

export const stopDaemon = async (
  context: DaemonContext,
  wasAlreadyRunning: boolean,
): Promise<boolean> => {
  if (wasAlreadyRunning || !context.localServer) {
    return true;
  }

  await stopLocalServer(context.localServer);
  return true;
};

export const isDaemonRunning = async (_context?: DaemonContext): Promise<boolean> => {
  return isLocalServerRunning();
};

export { requireLocalServer };
