import { AOP_BIN, getAopEnv } from "./constants";
import {
  isLocalServerRunning,
  type LocalServerContext,
  requireLocalServer,
  startLocalServer,
  stopLocalServer,
} from "./local-server";

export interface E2EServerContext {
  localServer: LocalServerContext | null;
  env: NodeJS.ProcessEnv;
}

export interface E2EServerStartResult {
  success: boolean;
  context: E2EServerContext;
  wasAlreadyRunning: boolean;
}

export const runAopCommand = async (
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const proc = Bun.spawn({
    cmd: [process.execPath, AOP_BIN, ...args],
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: env ?? getAopEnv(),
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { exitCode, stdout, stderr };
};

export interface E2EServerStartOptions {
  dbPath?: string;
  aopHome?: string;
}

export const startE2EServer = async (
  options: E2EServerStartOptions = {},
): Promise<E2EServerStartResult> => {
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
  const localServer = await startLocalServer({
    dbPath: options.dbPath,
  });

  return {
    success: true,
    context: { localServer, env },
    wasAlreadyRunning: false,
  };
};

export const stopE2EServer = async (
  context: E2EServerContext,
  wasAlreadyRunning: boolean,
): Promise<boolean> => {
  if (wasAlreadyRunning || !context.localServer) {
    return true;
  }

  await stopLocalServer(context.localServer);
  return true;
};

export { requireLocalServer };
