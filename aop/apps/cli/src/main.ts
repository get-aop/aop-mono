#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI layer requires console output for user feedback

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { configureLogging, type LoggingOptions, type LogLevel } from "@aop/infra";
import cac, { type CAC } from "cac";
import {
  applyCommand,
  configGetCommand,
  configSetCommand,
  createTaskCommand,
  repoInitCommand,
  repoRemoveCommand,
  runTaskCommand,
  statusCommand,
  taskReadyCommand,
  taskRemoveCommand,
} from "./commands/index.ts";

type CommandHandlers = {
  applyCommand: typeof applyCommand;
  configGetCommand: typeof configGetCommand;
  configSetCommand: typeof configSetCommand;
  createTaskCommand: typeof createTaskCommand;
  repoInitCommand: typeof repoInitCommand;
  repoRemoveCommand: typeof repoRemoveCommand;
  runTaskCommand: typeof runTaskCommand;
  statusCommand: typeof statusCommand;
  taskReadyCommand: typeof taskReadyCommand;
  taskRemoveCommand: typeof taskRemoveCommand;
};

type LoggingDependencies = {
  mkdir: typeof mkdir;
  configureLogging: typeof configureLogging;
  now: () => Date;
};

type CliDependencies = {
  loadProjectEnv: typeof loadProjectEnv;
  setupLogging: typeof setupLogging;
  exit: (code: number) => never;
  error: (...args: unknown[]) => void;
};

const defaultCommandHandlers: CommandHandlers = {
  applyCommand,
  configGetCommand,
  configSetCommand,
  createTaskCommand,
  repoInitCommand,
  repoRemoveCommand,
  runTaskCommand,
  statusCommand,
  taskReadyCommand,
  taskRemoveCommand,
};

export const parseEnvFile = (content: string): Map<string, string> => {
  const vars = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    vars.set(key, value);
  }
  return vars;
};

/** Load .env from the AOP project root, resolved relative to CLI source files */
export const loadProjectEnv = async (): Promise<void> => {
  const projectRoot = resolve(import.meta.dirname, "..", "..", "..");
  const envPath = resolve(projectRoot, ".env");
  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) return;

  const content = await envFile.text();
  const vars = parseEnvFile(content);
  for (const [key, value] of vars) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

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

export const setupLogging = async (
  dependencies: Partial<LoggingDependencies> = {},
): Promise<void> => {
  const runtime: LoggingDependencies = {
    mkdir,
    configureLogging,
    now: () => new Date(),
    ...dependencies,
  };

  const logDir = process.env.AOP_LOG_DIR;
  const logLevel = (process.env.AOP_LOG_LEVEL as LogLevel) || "info";
  const options: LoggingOptions = { level: logLevel, format: "pretty", serviceName: "cli" };

  if (logDir) {
    await runtime.mkdir(logDir, { recursive: true });
    const timestamp = formatTimestamp(runtime.now());
    options.sinks = {
      console: true,
      files: [
        { path: `${logDir}/aop-${timestamp}.jsonl`, format: "json" },
        { path: `${logDir}/aop-${timestamp}.log`, format: "pretty" },
      ],
    };
  }

  await runtime.configureLogging(options);
};

export const registerCommands = (
  cli: CAC,
  commands: CommandHandlers = defaultCommandHandlers,
): void => {
  cli
    .command("status [taskId]", "Show status")
    .option("--json", "Output as JSON")
    .action((taskId, options) => commands.statusCommand(taskId, { json: options.json }));

  cli
    .command("repo:init [path]", "Register repository")
    .action((path) => commands.repoInitCommand(path));

  cli
    .command("repo:remove [path]", "Unregister repository")
    .option("--force", "Abort working tasks")
    .action((path, options) => commands.repoRemoveCommand(path, { force: options.force }));

  cli
    .command("task:ready <identifier>", "Mark task as READY")
    .option("--workflow <name>", "Workflow name")
    .option("--base-branch <branch>", "Base branch for worktree creation")
    .action((identifier, options) =>
      commands.taskReadyCommand(identifier, {
        workflow: options.workflow,
        baseBranch: options.baseBranch,
      }),
    );

  cli
    .command("task:remove <identifier>", "Remove task")
    .option("--force", "Abort working task")
    .action((identifier, options) =>
      commands.taskRemoveCommand(identifier, { force: options.force }),
    );

  cli
    .command("apply <taskId>", "Apply worktree changes to main repo")
    .action((taskId) => commands.applyCommand(taskId));

  cli
    .command("create-task [description]", "Create a new task interactively")
    .option("--debug", "Enable debug mode")
    .option("--raw", "Show raw output")
    .action(async (description, options) => {
      await commands.createTaskCommand(description, {
        debug: options.debug,
        raw: options.raw,
      });
    });

  cli
    .command("run-task <changeName>", "Run opsx:new and opsx:ff for a change")
    .action((changeName) => commands.runTaskCommand(changeName));

  cli
    .command("config:get [key]", "Get config value(s)")
    .action((key) => commands.configGetCommand(key));

  cli
    .command("config:set <key> <value>", "Set config value")
    .action((key, value) => commands.configSetCommand(key, value));
};

export const createCli = (
  dependencies: Partial<Pick<CliDependencies, "exit" | "error">> = {},
): CAC => {
  const runtime = {
    exit: process.exit as CliDependencies["exit"],
    error: (...args: unknown[]) => console.error(...args),
    ...dependencies,
  };

  const cli = cac("aop");
  registerCommands(cli);
  cli.help();
  cli.version("0.1.0");

  cli.on("command:*", () => {
    runtime.error(`Unknown command: ${cli.args.join(" ")}`);
    runtime.error(`Run "aop --help" for usage`);
    runtime.exit(1);
  });

  return cli;
};

export const runCli = async (
  cli: CAC,
  dependencies: Partial<CliDependencies> = {},
): Promise<void> => {
  const runtime: CliDependencies = {
    loadProjectEnv,
    setupLogging,
    exit: process.exit as CliDependencies["exit"],
    error: (...args: unknown[]) => console.error(...args),
    ...dependencies,
  };

  await runtime.loadProjectEnv();
  await runtime.setupLogging();

  try {
    const parsed = cli.parse();

    // Show help when run with no arguments and no command was matched
    if (
      !cli.matchedCommand &&
      parsed.args.length === 0 &&
      !parsed.options.help &&
      !parsed.options.version
    ) {
      cli.outputHelp();
    }
  } catch (error) {
    if (error instanceof Error && error.constructor.name === "CACError") {
      runtime.error(`Error: ${error.message}\n`);
      if (cli.matchedCommand) {
        cli.matchedCommand.outputHelp();
      }
      runtime.exit(1);
    }
    throw error;
  }
};

if (import.meta.main) {
  const cli = createCli();
  runCli(cli);
}
