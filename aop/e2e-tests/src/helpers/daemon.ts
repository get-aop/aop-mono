import { existsSync, readFileSync } from "node:fs";
import { AOP_BIN, API_KEY, DEFAULT_PID_FILE, getAopEnv, SERVER_URL } from "./constants";

export interface DaemonContext {
  pidFile: string;
  env: NodeJS.ProcessEnv;
}

export interface StartDaemonResult {
  success: boolean;
  pid: number | null;
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
}

export const startDaemon = async (options: StartDaemonOptions = {}): Promise<StartDaemonResult> => {
  const { configureServer = true } = options;
  const pidFile = DEFAULT_PID_FILE;
  const env = getAopEnv();
  const context: DaemonContext = { pidFile, env };

  if (isDaemonRunning(context)) {
    const pid = readPidFile(pidFile);
    return { success: true, pid, context, wasAlreadyRunning: true };
  }

  if (configureServer) {
    await runAopCommand(["config:set", "server_url", SERVER_URL]);
    await runAopCommand(["config:set", "api_key", API_KEY]);
  }

  const { exitCode } = await runAopCommand(["start"]);
  if (exitCode !== 0) {
    return { success: false, pid: null, context, wasAlreadyRunning: false };
  }

  await Bun.sleep(100);
  const pid = readPidFile(pidFile);
  return { success: true, pid, context, wasAlreadyRunning: false };
};

export const stopDaemon = async (
  context: DaemonContext,
  wasAlreadyRunning: boolean,
): Promise<boolean> => {
  if (wasAlreadyRunning) {
    return true;
  }

  const { exitCode } = await runAopCommand(["stop"]);
  if (exitCode !== 0) {
    return false;
  }

  const waitForStop = async (retries = 50): Promise<boolean> => {
    for (let i = 0; i < retries; i++) {
      if (!existsSync(context.pidFile)) {
        return true;
      }
      await Bun.sleep(100);
    }
    return false;
  };

  return waitForStop();
};

export const isDaemonRunning = (context: DaemonContext): boolean => {
  const pid = readPidFile(context.pidFile);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readPidFile = (pidFile: string): number | null => {
  if (!existsSync(pidFile)) {
    return null;
  }
  try {
    const content = readFileSync(pidFile, "utf-8").trim();
    return Number.parseInt(content, 10);
  } catch {
    return null;
  }
};
