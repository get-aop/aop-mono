#!/usr/bin/env bun

/* biome-ignore-all lint/suspicious/noConsole: CLI script */
/**
 * List all running AOP-managed claude agent processes.
 *
 * Usage:
 *   bun scripts/list-agents.ts
 */

import { readdirSync, readFileSync } from "node:fs";

interface AgentProcess {
  pid: number;
  taskId: string;
  stepId: string;
  uptime: string;
}

const listAgents = (): AgentProcess[] => {
  const agents: AgentProcess[] = [];

  const pids = readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number);

  for (const pid of pids) {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
      if (!cmdline.includes("claude")) continue;

      const environ = readFileSync(`/proc/${pid}/environ`, "utf-8");
      const env = new Map(
        environ
          .split("\0")
          .filter(Boolean)
          .map((entry) => {
            const idx = entry.indexOf("=");
            return [entry.slice(0, idx), entry.slice(idx + 1)] as [string, string];
          }),
      );

      const stepId = env.get("AOP_STEP_ID");
      if (!stepId) continue;

      const taskId = env.get("AOP_TASK_ID") ?? "unknown";
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const startTicks = Number(stat.split(" ")[21]);
      const uptimeSecs = readFileSync("/proc/uptime", "utf-8");
      const systemUptime = Number(uptimeSecs.split(" ")[0]);
      const clockTicks = 100; // standard on Linux
      const processStartSecs = startTicks / clockTicks;
      const elapsedSecs = Math.floor(systemUptime - processStartSecs);
      const uptime = formatDuration(elapsedSecs);

      agents.push({ pid, taskId, stepId, uptime });
    } catch {
      // Process may have exited between listing and reading
    }
  }

  return agents;
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
