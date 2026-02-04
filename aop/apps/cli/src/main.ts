#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { configureLogging, type LoggingOptions, type LogLevel } from "@aop/infra";
import cac, { type CAC } from "cac";
import {
  applyCommand,
  configGetCommand,
  configSetCommand,
  repoInitCommand,
  repoRemoveCommand,
  statusCommand,
  taskReadyCommand,
  taskRemoveCommand,
} from "./commands/index.ts";

export const formatTimestamp = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
};

export const setupLogging = async (): Promise<void> => {
  const logDir = process.env.AOP_LOG_DIR;
  const logLevel = (process.env.AOP_LOG_LEVEL as LogLevel) || "info";
  const options: LoggingOptions = { level: logLevel, format: "pretty" };

  if (logDir) {
    await mkdir(logDir, { recursive: true });
    const timestamp = formatTimestamp(new Date());
    options.sinks = {
      console: true,
      files: [
        { path: `${logDir}/aop-${timestamp}.jsonl`, format: "json" },
        { path: `${logDir}/aop-${timestamp}.log`, format: "pretty" },
      ],
    };
  }

  await configureLogging(options);
};

export const registerCommands = (cli: CAC): void => {
  // Status
  cli
    .command("status [taskId]", "Show status")
    .option("--json", "Output as JSON")
    .action((taskId, options) => statusCommand(taskId, { json: options.json }));

  // Repository commands
  cli.command("repo:init [path]", "Register repository").action((path) => repoInitCommand(path));

  cli
    .command("repo:remove [path]", "Unregister repository")
    .option("--force", "Abort working tasks")
    .action((path, options) => repoRemoveCommand(path, { force: options.force }));

  // Task commands
  cli
    .command("task:ready <identifier>", "Mark task as READY")
    .option("--workflow <name>", "Workflow name")
    .action((identifier, options) => taskReadyCommand(identifier, { workflow: options.workflow }));

  cli
    .command("task:remove <identifier>", "Remove task")
    .option("--force", "Abort working task")
    .action((identifier, options) => taskRemoveCommand(identifier, { force: options.force }));

  cli
    .command("apply <taskId>", "Apply worktree changes to main repo")
    .action((taskId) => applyCommand(taskId));

  // Config commands
  cli.command("config:get [key]", "Get config value(s)").action((key) => configGetCommand(key));

  cli
    .command("config:set <key> <value>", "Set config value")
    .action((key, value) => configSetCommand(key, value));
};

if (import.meta.main) {
  const cli = cac("aop");
  registerCommands(cli);
  cli.help();
  cli.version("0.1.0");

  const main = async (): Promise<void> => {
    await setupLogging();
    cli.parse();
  };

  main();
}
