import { readdirSync, readFileSync } from "node:fs";

export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const isClaudeProcess = (pid: number): boolean => {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    return cmdline.includes("claude");
  } catch {
    return false;
  }
};

export const findPidByStepId = (stepId: string): number | null => {
  try {
    const pids = readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry))
      .map(Number);

    for (const pid of pids) {
      try {
        const environ = readFileSync(`/proc/${pid}/environ`, "utf-8");
        if (
          environ.includes(`AOP_STEP_ID=${stepId}\0`) ||
          environ.endsWith(`AOP_STEP_ID=${stepId}`)
        ) {
          return pid;
        }
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // /proc not available (non-Linux)
  }
  return null;
};
