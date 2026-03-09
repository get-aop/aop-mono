#!/usr/bin/env bun

/* biome-ignore-all lint/suspicious/noConsole: CLI script */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: CLI script needs platform detection */
/**
 * List all running AOP-managed agent processes.
 * Works on both Linux and macOS.
 *
 * Usage:
 *   bun scripts/list-agents.ts
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface AgentProcess {
  pid: number;
  taskId: string;
  stepId: string;
  uptime: string;
}

const isLinux = process.platform === "linux";
const isMacOS = process.platform === "darwin";

const AGENT_PATTERNS = ["claude", "opencode", "agent"];
const AOP_ENV_PATTERN = /AOP_(TASK|STEP)_ID=/;

const listAgents = (): AgentProcess[] => {
  if (isLinux) {
    return listAgentsLinux();
  }
  if (isMacOS) {
    return listAgentsMacOS();
  }
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
};

const isAgentProcess = (cmdline: string): boolean => {
  return AGENT_PATTERNS.some((pattern) => cmdline.toLowerCase().includes(pattern));
};

const extractEnvVar = (environ: string, key: string): string | null => {
  const regex = new RegExp(`${key}=([^\\0]+)`);
  const match = environ.match(regex);
  return match?.[1] ?? null;
};

const checkLinuxProcess = (pid: number): AgentProcess | null => {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    if (!isAgentProcess(cmdline)) return null;

    const environ = readFileSync(`/proc/${pid}/environ`, "utf-8");

    const stepId = extractEnvVar(environ, "AOP_STEP_ID");
    if (!stepId) return null;

    const taskId = extractEnvVar(environ, "AOP_TASK_ID") ?? "unknown";
    const uptime = getProcessUptimeLinux(pid);

    return { pid, taskId, stepId, uptime };
  } catch {
    return null;
  }
};

const listAgentsLinux = (): AgentProcess[] => {
  const agents: AgentProcess[] = [];

  const { readdirSync } = require("node:fs");
  const pids = readdirSync("/proc")
    .filter((entry: string) => /^\d+$/.test(entry))
    .map(Number);

  for (const pid of pids) {
    const agent = checkLinuxProcess(pid);
    if (agent) {
      agents.push(agent);
    }
  }

  return agents;
};

const parseMacOSLine = (line: string): { pid: number; etime: string; cmd: string } | null => {
  // Format: PID ELAPSED COMMAND
  const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;

  const pid = Number(match[1]);
  if (Number.isNaN(pid)) return null;

  const etime = match[2] ?? "";
  const cmd = match[3] ?? "";

  return {
    pid,
    etime,
    cmd,
  };
};

const checkMacOSProcess = (line: string): AgentProcess | null => {
  const parsed = parseMacOSLine(line);
  if (!parsed) return null;
  if (!isAgentProcess(parsed.cmd)) return null;

  try {
    const fullCmdOutput = execSync(`ps eww -p ${parsed.pid} -o command=`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });

    const fullCmd = fullCmdOutput.trim();
    if (!AOP_ENV_PATTERN.test(fullCmd)) return null;

    const taskMatch = fullCmd.match(/AOP_TASK_ID=([^\s]+)/);
    const stepMatch = fullCmd.match(/AOP_STEP_ID=([^\s]+)/);
    if (!stepMatch?.[1]) return null;

    return {
      pid: parsed.pid,
      taskId: taskMatch?.[1] ?? "unknown",
      stepId: stepMatch[1] ?? "unknown",
      uptime: formatMacOSUptime(parsed.etime),
    };
  } catch {
    return null;
  }
};

const listAgentsMacOS = (): AgentProcess[] => {
  const agents: AgentProcess[] = [];

  try {
    // Get all processes with claude/opencode/agent in command line
    // -o pid,etime,command gives us: PID ELAPSED_TIME COMMAND
    const psOutput = execSync(
      "ps -eo pid,etime,command | grep -iE '(claude|opencode|agent)' | grep -v grep",
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
    );

    const lines = psOutput.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const agent = checkMacOSProcess(line);
      if (agent) {
        agents.push(agent);
      }
    }
  } catch {
    // No matching processes found or command failed
  }

  return agents;
};

const getProcessUptimeLinux = (pid: number): string => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    const startTicks = Number(stat.split(" ")[21]);
    const uptimeSecs = readFileSync("/proc/uptime", "utf-8");
    const systemUptime = Number(uptimeSecs.split(" ")[0]);
    const clockTicks = 100; // standard on Linux
    const processStartSecs = startTicks / clockTicks;
    const elapsedSecs = Math.floor(systemUptime - processStartSecs);
    return formatDuration(elapsedSecs);
  } catch {
    return "unknown";
  }
};

const formatMacOSUptime = (etime: string): string => {
  try {
    let totalSeconds = 0;
    let timeStr = etime;

    if (timeStr.includes("-")) {
      const parts = timeStr.split("-");
      totalSeconds += Number(parts[0] ?? 0) * 24 * 3600;
      timeStr = parts[1] ?? "";
    }

    const timeParts = timeStr.split(":").map(Number);
    const multipliers =
      timeParts.length === 3 ? [3600, 60, 1] : timeParts.length === 2 ? [60, 1] : [1];
    for (let i = 0; i < timeParts.length; i++) {
      totalSeconds += (timeParts[i] ?? 0) * (multipliers[i] ?? 1);
    }

    return formatDuration(totalSeconds);
  } catch {
    return "unknown";
  }
};

const formatDuration = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const agents = listAgents();

if (agents.length === 0) {
  console.log("No AOP agents running.");
  process.exit(0);
}

console.log(`\n  ${agents.length} AOP agent(s) running\n`);

const header = { pid: "PID", task: "TASK", step: "STEP", uptime: "UPTIME" };
const rows = agents.map((a) => ({
  pid: String(a.pid),
  task: a.taskId,
  step: a.stepId,
  uptime: a.uptime,
}));

const all = [header, ...rows];
const w = {
  pid: Math.max(...all.map((r) => r.pid.length)),
  task: Math.max(...all.map((r) => r.task.length)),
  step: Math.max(...all.map((r) => r.step.length)),
  uptime: Math.max(...all.map((r) => r.uptime.length)),
};

const fmt = (r: (typeof all)[number]) =>
  `  ${r.pid.padEnd(w.pid)}  ${r.task.padEnd(w.task)}  ${r.step.padEnd(w.step)}  ${r.uptime.padStart(w.uptime)}`;

const sep = `  ${"─".repeat(w.pid)}  ${"─".repeat(w.task)}  ${"─".repeat(w.step)}  ${"─".repeat(w.uptime)}`;

console.log(fmt(header));
console.log(sep);
for (const row of rows) {
  console.log(fmt(row));
}
console.log();
