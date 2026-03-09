import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const isLinux = process.platform === "linux";

export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Detects zombie processes (exited but not reaped by parent). */
export const isZombie = (pid: number): boolean => {
  try {
    if (isLinux) {
      const status = readFileSync(`/proc/${pid}/status`, "utf-8");
      return /^State:\s+Z/m.test(status);
    }
    const state = execSync(`ps -p ${pid} -o state=`, {
      encoding: "utf-8",
    }).trim();
    return state === "Z";
  } catch {
    return false;
  }
};

/** Returns true only if the process is alive AND not a zombie. */
export const isAgentRunning = (pid: number): boolean => {
  return isProcessAlive(pid) && !isZombie(pid);
};

export const isClaudeProcess = (pid: number): boolean => {
  try {
    if (isLinux) {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
      return cmdline.includes("claude");
    }
    const cmd = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8" });
    return cmd.includes("claude");
  } catch {
    return false;
  }
};

export const findPidByStepId = (stepId: string): number | null => {
  if (isLinux) {
    return findPidByEnvLinux("AOP_STEP_ID", stepId);
  }
  return findPidByEnvMacOS("AOP_STEP_ID", stepId);
};

export const findPidsByTaskId = (taskId: string): number[] => {
  if (isLinux) {
    return findPidsByEnvLinux("AOP_TASK_ID", taskId);
  }
  return findPidsByEnvMacOS("AOP_TASK_ID", taskId);
};

export const findPidByEnvLinux = (envKey: string, envValue: string): number | null => {
  try {
    const pids = readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry))
      .map(Number);

    for (const pid of pids) {
      try {
        const environ = readFileSync(`/proc/${pid}/environ`, "utf-8");
        if (
          environ.includes(`${envKey}=${envValue}\0`) ||
          environ.endsWith(`${envKey}=${envValue}`)
        ) {
          return pid;
        }
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // /proc not available
  }
  return null;
};

export const findPidsByEnvLinux = (envKey: string, envValue: string): number[] => {
  const result: number[] = [];
  try {
    const pids = readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry))
      .map(Number);

    for (const pid of pids) {
      try {
        const environ = readFileSync(`/proc/${pid}/environ`, "utf-8");
        if (
          environ.includes(`${envKey}=${envValue}\0`) ||
          environ.endsWith(`${envKey}=${envValue}`)
        ) {
          result.push(pid);
        }
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // /proc not available
  }
  return result;
};

const getAgentPidsMacOS = (): Array<{ pid: number; env: string }> => {
  try {
    const psOutput = execSync("ps eww -eo pid,command | grep -i claude | grep -v grep", {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return psOutput
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match) return null;
        return { pid: Number(match[1]), env: match[2] ?? "" };
      })
      .filter((entry): entry is { pid: number; env: string } => entry !== null);
  } catch {
    return [];
  }
};

const findPidByEnvMacOS = (envKey: string, envValue: string): number | null => {
  const target = `${envKey}=${envValue}`;
  // Fast path: check known PID from caller context if available
  for (const { pid, env } of getAgentPidsMacOS()) {
    if (env.includes(target)) return pid;
  }
  return null;
};

const findPidsByEnvMacOS = (envKey: string, envValue: string): number[] => {
  const target = `${envKey}=${envValue}`;
  return getAgentPidsMacOS()
    .filter(({ env }) => env.includes(target))
    .map(({ pid }) => pid);
};
