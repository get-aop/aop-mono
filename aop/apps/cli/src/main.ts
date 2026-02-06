#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI layer requires console output for user feedback

import { mkdir } from "node:fs/promises";
import { configureLogging, type LoggingOptions, type LogLevel } from "@aop/infra";
import cac, { type CAC } from "cac";
import {
  applyCommand,
  configGetCommand,
  configSetCommand,
  createTaskCommand,
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
  cli
    .command("status [taskId]", "Show status")
    .option("--json", "Output as JSON")
    .action((taskId, options) => statusCommand(taskId, { json: options.json }));

  cli.command("repo:init [path]", "Register repository").action((path) => repoInitCommand(path));

  cli
    .command("repo:remove [path]", "Unregister repository")
    .option("--force", "Abort working tasks")
    .action((path, options) => repoRemoveCommand(path, { force: options.force }));

  cli
    .command("task:ready <identifier>", "Mark task as READY")
    .option("--workflow <name>", "Workflow name")
    .option("--base-branch <branch>", "Base branch for worktree creation")
    .action((identifier, options) =>
      taskReadyCommand(identifier, {
        workflow: options.workflow,
        baseBranch: options.baseBranch,
      }),
    );

  cli
    .command("task:remove <identifier>", "Remove task")
    .option("--force", "Abort working task")
    .action((identifier, options) => taskRemoveCommand(identifier, { force: options.force }));

  cli
    .command("apply <taskId>", "Apply worktree changes to main repo")
    .action((taskId) => applyCommand(taskId));

  cli
    .command("create-task [description]", "Create a new task interactively")
    .option("--debug", "Enable debug mode")
    .option("--raw", "Show raw output")
    .action(async (description, options) => {
      await createTaskCommand(description, {
        debug: options.debug,
        raw: options.raw,
      });
    });

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

  cli.on("command:*", () => {
    console.error(`Unknown command: ${cli.args.join(" ")}`);
    console.error(`Run "aop --help" for usage`);
    process.exit(1);
  });

  const main = async (): Promise<void> => {
    await setupLogging();

    try {
      const parsed = cli.parse();

      // Show help when run with no arguments
      if (parsed.args.length === 0 && !parsed.options.help && !parsed.options.version) {
        cli.outputHelp();
      }
    } catch (error) {
      if (error instanceof Error && error.constructor.name === "CACError") {
        console.error(`Error: ${error.message}\n`);
        if (cli.matchedCommand) {
          cli.matchedCommand.outputHelp();
        }
        process.exit(1);
      }
      throw error;
    }
  };

  main();
}
