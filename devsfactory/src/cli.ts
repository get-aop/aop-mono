#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AgentRunner } from "./core/agent-runner";
import { Orchestrator } from "./core/orchestrator";
import {
  formatJobCompletedMessage,
  formatSubtaskCompletedMessage,
  formatSubtaskStartMessage
} from "./cli-log-formatter";
import { parseStatsArgs, runStatsCommand } from "./commands/stats";
import { renderSummaryTable } from "./core/summary-table";
import { generateTaskSummary } from "./core/timing";
import { configureLogger, getLogger } from "./infra/logger";
import { parseStreamJson } from "./providers/claude";
import type { AgentProcess, Config, Subtask, Task } from "./types";

const VERSION = "0.1.0";

const HELP_TEXT = `
aop - Agent Orchestration Platform

USAGE
  aop [options]

DESCRIPTION
  Starts the orchestrator daemon that watches the .devsfactory directory
  for task definitions, manages git worktrees, and spawns Claude agents
  to implement tasks.

OPTIONS
  -h, --help      Show this help message
  -v, --version   Show version number

ENVIRONMENT VARIABLES
  DEVSFACTORY_DIR       Task definitions directory (default: .devsfactory)
  WORKTREES_DIR         Git worktrees directory (default: .worktrees)
  MAX_CONCURRENT_AGENTS Maximum parallel agents (default: 2)
  DEBOUNCE_MS           File watcher debounce in ms (default: 100)
  RETRY_INITIAL_MS      Initial retry backoff in ms (default: 2000)
  RETRY_MAX_MS          Maximum retry backoff in ms (default: 300000)
  RETRY_MAX_ATTEMPTS    Maximum retry attempts (default: 5)
  DEBUG                 Enable debug logging (set to "true" or "1")
  LOG_MODE              Log format: "pretty" or "json" (default: pretty)

SETUP
  1. Create a .devsfactory directory in your project root
  2. Add task definitions as markdown files (see documentation)
  3. Optionally create a .env file with configuration
  4. Run 'aop' from your project root

COMMANDS
  stats <task-folder>   Export timing statistics as JSON

EXAMPLES
  # Start orchestrator with defaults
  aop

  # Start with custom config
  MAX_CONCURRENT_AGENTS=4 DEBUG=true aop

  # Using .env file
  echo "MAX_CONCURRENT_AGENTS=4" > .env
  aop

  # Export timing stats for a task
  aop stats my-task-folder

DOCUMENTATION
  https://github.com/anthropics/devsfactory
`;

interface ParsedArgs {
  help: boolean;
  version: boolean;
  command?: string;
  commandArgs: string[];
  error?: string;
}

const parseArgs = (args: string[]): ParsedArgs => {
  const result: ParsedArgs = {
    help: false,
    version: false,
    commandArgs: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "-h" || arg === "--help") {
      result.help = true;
      return result;
    }
    if (arg === "-v" || arg === "--version") {
      result.version = true;
      return result;
    }
    if (arg === "stats") {
      result.command = "stats";
      result.commandArgs = args.slice(i + 1);
      return result;
    }
    if (arg.startsWith("-")) {
      result.error = `Unknown option: ${arg}`;
      return result;
    }
  }

  return result;
};

const parseEnvConfig = (): Config => {
  const cwd = process.cwd();

  const devsfactoryDir = join(
    cwd,
    process.env.DEVSFACTORY_DIR ?? ".devsfactory"
  );
  const worktreesDir = join(cwd, process.env.WORKTREES_DIR ?? ".worktrees");
  const maxConcurrentAgents = Number(process.env.MAX_CONCURRENT_AGENTS ?? 2);
  const debounceMs = Number(process.env.DEBOUNCE_MS ?? 100);
  const retryInitialMs = Number(process.env.RETRY_INITIAL_MS ?? 2000);
  const retryMaxMs = Number(process.env.RETRY_MAX_MS ?? 300000);
  const retryMaxAttempts = Number(process.env.RETRY_MAX_ATTEMPTS ?? 5);

  return {
    maxConcurrentAgents,
    devsfactoryDir,
    worktreesDir,
    debounceMs,
    retryBackoff: {
      initialMs: retryInitialMs,
      maxMs: retryMaxMs,
      maxAttempts: retryMaxAttempts
    },
    ignorePatterns: [".git", "*.swp", "*.tmp", "*~", ".DS_Store"]
  };
};

const isInsideGitRepo = async (): Promise<boolean> => {
  try {
    const result = await Bun.$`git rev-parse --is-inside-work-tree`.quiet();
    return result.text().trim() === "true";
  } catch {
    return false;
  }
};

const validateEnvironment = async (config: Config): Promise<string[]> => {
  const errors: string[] = [];

  if (!existsSync(config.devsfactoryDir)) {
    errors.push(
      `Directory not found: ${config.devsfactoryDir}\n` +
        `  Create it with: mkdir ${process.env.DEVSFACTORY_DIR ?? ".devsfactory"}`
    );
  }

  // Check if we're in a git repository (works from any subdirectory or worktree)
  const inGitRepo = await isInsideGitRepo();
  if (!inGitRepo) {
    errors.push(
      "Not a git repository. The orchestrator requires git for worktree management.\n" +
        "  Initialize with: git init"
    );
  }

  return errors;
};

const showHelp = () => {
  console.log(HELP_TEXT.trim());
};

const showVersion = () => {
  console.log(`aop v${VERSION}`);
};

const showError = (message: string) => {
  console.error(`Error: ${message}\n`);
  console.error("Run 'aop --help' for usage information.");
};

const handleStatsCommand = async (commandArgs: string[]) => {
  const cwd = process.cwd();
  const devsfactoryDir = join(
    cwd,
    process.env.DEVSFACTORY_DIR ?? ".devsfactory"
  );

  const statsArgs = parseStatsArgs(commandArgs);
  if (statsArgs.error) {
    showError(statsArgs.error);
    process.exit(1);
  }

  const result = await runStatsCommand(statsArgs.taskFolder!, devsfactoryDir);
  if (result.success) {
    console.log(result.output);
    process.exit(0);
  } else {
    showError(result.error!);
    process.exit(1);
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const { help, version, command, commandArgs, error } = parseArgs(args);

  if (error) {
    showError(error);
    process.exit(1);
  }

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (version) {
    showVersion();
    process.exit(0);
  }

  if (command === "stats") {
    await handleStatsCommand(commandArgs);
    return;
  }

  const config = parseEnvConfig();
  const validationErrors = await validateEnvironment(config);

  if (validationErrors.length > 0) {
    console.error("Configuration errors:\n");
    for (const err of validationErrors) {
      console.error(`  - ${err}\n`);
    }
    console.error("Run 'aop --help' for setup instructions.");
    process.exit(1);
  }

  await configureLogger();
  const log = getLogger("orchestrator");
  const agentLog = getLogger("agent");

  log.info("Starting orchestrator", {
    devsfactoryDir: config.devsfactoryDir,
    worktreesDir: config.worktreesDir,
    maxConcurrentAgents: config.maxConcurrentAgents
  });

  // Create agent runner to capture Claude output
  const agentRunner = new AgentRunner();
  const agentMetadata = new Map<
    string,
    { type: string; taskFolder: string; subtaskFile?: string }
  >();

  agentRunner.on(
    "started",
    (data: { agentId: string; process: AgentProcess }) => {
      const { agentId, process: agent } = data;
      agentMetadata.set(agentId, {
        type: agent.type,
        taskFolder: agent.taskFolder,
        subtaskFile: agent.subtaskFile
      });
      log.info("Agent started", {
        agentType: agent.type,
        task: agent.taskFolder,
        subtask: agent.subtaskFile,
        agentId: agentId.slice(-8),
        pid: agent.pid
      });
    }
  );

  agentRunner.on("output", (data: { agentId: string; line: string }) => {
    const meta = agentMetadata.get(data.agentId);
    const prettified = parseStreamJson(data.line);
    if (prettified) {
      agentLog.info("Agent output", {
        agentType: meta?.type ?? "unknown",
        subtask: meta?.subtaskFile,
        agentId: data.agentId.slice(-8),
        output: prettified
      });
    }
  });

  agentRunner.on("completed", (data: { agentId: string; exitCode: number }) => {
    const meta = agentMetadata.get(data.agentId);
    if (data.exitCode === 0) {
      log.info("Agent completed", {
        agentType: meta?.type ?? "unknown",
        subtask: meta?.subtaskFile,
        agentId: data.agentId.slice(-8)
      });
    } else {
      log.warn("Agent completed with error", {
        agentType: meta?.type ?? "unknown",
        subtask: meta?.subtaskFile,
        agentId: data.agentId.slice(-8),
        exitCode: data.exitCode
      });
    }
    agentMetadata.delete(data.agentId);
  });

  const orchestrator = new Orchestrator(config, agentRunner);

  orchestrator.on("stateChanged", () => {
    const state = orchestrator.getState();
    log.debug("State changed", {
      tasks: state.tasks.length,
      activePlans: Object.keys(state.plans).length
    });
  });

  orchestrator.on("recoveryAction", (data) => {
    log.warn("Recovery action", data);
  });

  orchestrator.on(
    "subtaskStarted",
    (data: {
      taskFolder: string;
      subtaskNumber: number;
      subtaskTotal: number;
      subtaskTitle: string;
    }) => {
      log.info(
        formatSubtaskStartMessage(
          data.subtaskNumber,
          data.subtaskTotal,
          data.subtaskTitle
        ),
        { taskFolder: data.taskFolder }
      );
    }
  );

  orchestrator.on(
    "subtaskCompleted",
    (data: {
      taskFolder: string;
      subtaskNumber: number;
      subtaskTotal: number;
      subtaskTitle: string;
      durationMs: number;
    }) => {
      log.info(
        formatSubtaskCompletedMessage(
          data.subtaskNumber,
          data.subtaskTotal,
          data.subtaskTitle,
          data.durationMs
        ),
        { taskFolder: data.taskFolder, durationMs: data.durationMs }
      );
    }
  );

  orchestrator.on(
    "workerJobCompleted",
    (data: {
      jobId: string;
      job: { type: string; taskFolder: string; subtaskFile?: string };
      durationMs: number;
    }) => {
      log.info(formatJobCompletedMessage(data.job.type, data.durationMs), {
        jobId: data.jobId,
        taskFolder: data.job.taskFolder,
        subtask: data.job.subtaskFile
      });
    }
  );

  orchestrator.on("workerJobFailed", (data) => {
    log.error(`Job failed: ${data.error}`, data);
  });

  orchestrator.on("workerJobRetrying", (data) => {
    log.warn(
      `Job retrying (attempt ${data.attempt}, next in ${data.nextRetryMs}ms)`,
      data
    );
  });

  orchestrator.on(
    "taskCompleted",
    ({ task, subtasks }: { task: Task; subtasks: Subtask[] }) => {
      const summary = generateTaskSummary(task, subtasks);
      const table = renderSummaryTable(summary);
      console.log("\n" + table + "\n");
    }
  );

  const shutdown = async () => {
    log.info("Shutting down...");
    await orchestrator.stop();
    log.info("Orchestrator stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await orchestrator.start();
  log.info("Orchestrator running. Press Ctrl+C to stop.");
};

main().catch((err) => {
  console.error("\nFatal error:", err.message ?? err);
  console.error("\nRun 'aop --help' for usage information.");
  process.exit(1);
});
