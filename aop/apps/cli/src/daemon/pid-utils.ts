import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getLogger } from "@aop/infra";

const logger = getLogger("aop", "pid-utils");

export const DEFAULT_PID_FILE = join(homedir(), ".aop", "aop.pid");

export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const isDaemonRunning = (pidFile = DEFAULT_PID_FILE): boolean => {
  if (!existsSync(pidFile)) {
    return false;
  }

  try {
    const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    return isProcessAlive(pid);
  } catch {
    return false;
  }
};

export const getDaemonPid = (pidFile = DEFAULT_PID_FILE): number | null => {
  if (!existsSync(pidFile)) {
    return null;
  }

  try {
    const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    return isProcessAlive(pid) ? pid : null;
  } catch {
    return null;
  }
};

export const stopDaemonByPid = (pidFile = DEFAULT_PID_FILE): boolean => {
  const pid = getDaemonPid(pidFile);
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
};

export const getDefaultPidFile = (): string => DEFAULT_PID_FILE;

export const notifyDaemon = (pidFile = DEFAULT_PID_FILE): boolean => {
  const pid = getDaemonPid(pidFile);
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, "SIGUSR1");
    return true;
  } catch {
    return false;
  }
};

export const writePidFile = (pidFile: string): void => {
  writeFileSync(pidFile, String(process.pid));
  logger.debug("Wrote PID file: {path}", { path: pidFile, pid: process.pid });
};

export const removePidFile = (pidFile: string): void => {
  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
    logger.debug("Removed PID file: {path}", { path: pidFile });
  }
};
