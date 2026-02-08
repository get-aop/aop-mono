import { readFileSync } from "node:fs";

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
