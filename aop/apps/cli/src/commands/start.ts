import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getLogger } from "@aop/infra";
import { getDaemonPid, getDefaultPidFile, isDaemonRunning } from "../daemon/daemon.ts";

const logger = getLogger("aop", "cli", "start");

const AOP_DIR = join(homedir(), ".aop");
const LOG_DIR = process.env.AOP_LOG_DIR ?? join(AOP_DIR, "logs");

const getDaemonScript = (): string => {
  // When running from source: apps/cli/src/commands -> ../daemon/run.ts works
  const fromSource = join(import.meta.dir, "..", "daemon", "run.ts");
  if (existsSync(fromSource)) return fromSource;

  // When running from dist/main.js: need to go to src/daemon/run.ts
  return join(import.meta.dir, "..", "src", "daemon", "run.ts");
};

const getPidFile = (): string => process.env.AOP_PID_FILE ?? getDefaultPidFile();

export const startCommand = async (): Promise<void> => {
  const pidFile = getPidFile();

  if (isDaemonRunning(pidFile)) {
    const pid = getDaemonPid(pidFile);
    logger.info("Daemon is already running (pid {pid})", { pid });
    return;
  }

  await mkdir(LOG_DIR, { recursive: true });

  const child = spawn("bun", ["run", getDaemonScript()], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });

  child.unref();

  await waitForDaemonStart(pidFile);
  const pid = getDaemonPid(pidFile);
  logger.info("Daemon started (pid {pid})", { pid });
};

const waitForDaemonStart = async (pidFile: string, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isDaemonRunning(pidFile)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Daemon failed to start within timeout");
};
