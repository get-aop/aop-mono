#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { configureLogging, type LoggingOptions, type LogLevel } from "@aop/infra";
import { printError, printHelp } from "./commands/help.ts";
import {
  applyCommand,
  configGetCommand,
  configSetCommand,
  repoInitCommand,
  repoRemoveCommand,
  runCommand,
  startCommand,
  statusCommand,
  stopCommand,
  taskReadyCommand,
  taskRemoveCommand,
} from "./commands/index.ts";
import { type CommandContext, createCommandContext } from "./context.ts";
import { closeDatabase, getDatabase } from "./db/connection.ts";
import { runMigrations } from "./db/migrations.ts";

const formatTimestamp = (date: Date): string => {
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

const setupLogging = async (): Promise<void> => {
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

const initializeDatabase = async (): Promise<CommandContext> => {
  const db = getDatabase();
  await runMigrations(db);
  return createCommandContext(db);
};

type CommandHandler = (args: string[], ctx?: CommandContext) => Promise<void>;

interface CommandDef {
  needsDb: boolean;
  handler: CommandHandler;
}

const requireArg = (args: string[], index: number, usage: string): string => {
  if (args[index] === undefined) {
    printError(usage);
    process.exit(1);
  }
  return args[index];
};

const requireCtx = (ctx: CommandContext | undefined): CommandContext => {
  if (!ctx) {
    throw new Error("Internal error: command requires database context");
  }
  return ctx;
};

const commands: Record<string, CommandDef> = {
  start: { needsDb: false, handler: () => startCommand() },
  stop: { needsDb: false, handler: () => stopCommand() },
  status: {
    needsDb: true,
    handler: (args, ctx) => {
      const jsonFlag = args.includes("--json");
      const taskId = args.find((a) => a !== "--json");
      return statusCommand(requireCtx(ctx), taskId, { json: jsonFlag });
    },
  },
  "repo:init": { needsDb: true, handler: (args, ctx) => repoInitCommand(requireCtx(ctx), args[0]) },
  "repo:remove": {
    needsDb: true,
    handler: (args, ctx) => {
      const forceFlag = args.includes("--force");
      const path = args.find((a) => a !== "--force");
      return repoRemoveCommand(requireCtx(ctx), path, { force: forceFlag });
    },
  },
  "task:ready": {
    needsDb: true,
    handler: (args, ctx) => {
      const workflowIdx = args.indexOf("--workflow");
      let workflow: string | undefined;
      if (workflowIdx !== -1) {
        workflow = args[workflowIdx + 1];
        args.splice(workflowIdx, 2);
      }
      const identifier = requireArg(args, 0, "Usage: aop task:ready <task-id> [--workflow <name>]");
      return taskReadyCommand(requireCtx(ctx), identifier, { workflow });
    },
  },
  "task:remove": {
    needsDb: true,
    handler: (args, ctx) => {
      const forceFlag = args.includes("--force");
      const identifier = args.find((a) => a !== "--force");
      if (!identifier) {
        printError("Usage: aop task:remove <task-id> [--force]");
        process.exit(1);
      }
      return taskRemoveCommand(requireCtx(ctx), identifier, { force: forceFlag });
    },
  },
  "task:run": {
    needsDb: true,
    handler: (args, ctx) =>
      runCommand(requireCtx(ctx), requireArg(args, 0, "Usage: aop task:run <task-id|path>")),
  },
  run: {
    needsDb: true,
    handler: (args, ctx) =>
      runCommand(requireCtx(ctx), requireArg(args, 0, "Usage: aop run <task-id|path>")),
  },
  apply: {
    needsDb: true,
    handler: (args, ctx) =>
      applyCommand(requireCtx(ctx), requireArg(args, 0, "Usage: aop apply <task-id>")),
  },
  "config:get": {
    needsDb: true,
    handler: (args, ctx) => configGetCommand(requireCtx(ctx), args[0]),
  },
  "config:set": {
    needsDb: true,
    handler: (args, ctx) => {
      const key = requireArg(args, 0, "Usage: aop config:set <key> <value>");
      const value = requireArg(args, 1, "Usage: aop config:set <key> <value>");
      return configSetCommand(requireCtx(ctx), key, value);
    },
  },
};

const main = async (): Promise<void> => {
  await setupLogging();

  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    printHelp();
    process.exit(0);
  }

  const cmd = commands[command];
  if (!cmd) {
    printError(`Unknown command '${command}'`);
    printHelp();
    process.exit(1);
  }

  try {
    const ctx = cmd.needsDb ? await initializeDatabase() : undefined;
    await cmd.handler(args, ctx);
  } finally {
    await closeDatabase();
  }
};

main();
