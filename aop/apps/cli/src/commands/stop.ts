import { getLogger } from "@aop/infra";
import {
  getDaemonPid,
  getDefaultPidFile,
  isDaemonRunning,
  stopDaemonByPid,
} from "../daemon/daemon.ts";

const logger = getLogger("aop", "cli", "stop");

const getPidFile = (): string => process.env.AOP_PID_FILE ?? getDefaultPidFile();

export const stopCommand = async (): Promise<void> => {
  const pidFile = getPidFile();

  if (!isDaemonRunning(pidFile)) {
    logger.info("No daemon is running");
    return;
  }

  const pid = getDaemonPid(pidFile);
  logger.info("Stopping daemon (pid {pid})", { pid });

  const stopped = stopDaemonByPid(pidFile);
  if (!stopped) {
    logger.error("Failed to stop daemon");
    process.exit(1);
  }

  await waitForDaemonStop(pidFile);
  logger.info("Daemon stopped");
};

const waitForDaemonStop = async (pidFile: string, timeoutMs = 10000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isDaemonRunning(pidFile)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Daemon failed to stop within timeout");
};
