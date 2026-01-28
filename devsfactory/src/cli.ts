#!/usr/bin/env bun
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AgentRunner } from "./core/agent-runner";
import { DashboardServer } from "./core/dashboard-server";
import { Orchestrator } from "./core/orchestrator";
import { configureLogger, getLogger } from "./infra/logger";
import { parseStreamJson } from "./providers/claude";
import type { AgentProcess, Config } from "./types";

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
  DASHBOARD_PORT        Dashboard server port (default: 3001)
  DEBOUNCE_MS           File watcher debounce in ms (default: 100)
  RETRY_INITIAL_MS      Initial retry backoff in ms (default: 2000)
  RETRY_MAX_MS          Maximum retry backoff in ms (default: 300000)
  RETRY_MAX_ATTEMPTS    Maximum retry attempts (default: 5)
  DEBUG                 Enable debug logging (set to "true" or "1")
  LOG_MODE              Log format: "pretty" or "json" (default: pretty)

SETUP
  1. Run 'aop' from your project root (creates .devsfactory if needed)
  2. Add task definitions as markdown files (see documentation)
  3. Optionally create a .env file with configuration

EXAMPLES
  # Start orchestrator with defaults
  aop

  # Start with custom config
  MAX_CONCURRENT_AGENTS=4 DEBUG=true aop

  # Using .env file
  echo "MAX_CONCURRENT_AGENTS=4" > .env
  aop

DOCUMENTATION
  https://github.com/anthropics/devsfactory
`;

const parseArgs = (
  args: string[]
): { help: boolean; version: boolean; error?: string } => {
  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      return { help: true, version: false };
    }
    if (arg === "-v" || arg === "--version") {
      return { help: false, version: true };
    }
    if (arg.startsWith("-")) {
      return { help: false, version: false, error: `Unknown option: ${arg}` };
    }
  }
  return { help: false, version: false };
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

const openBrowser = async (url: string): Promise<void> => {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      await Bun.$`open ${url}`.quiet();
    } else if (platform === "win32") {
      await Bun.$`cmd /c start ${url}`.quiet();
    } else {
      await Bun.$`xdg-open ${url}`.quiet();
    }
  } catch {
    // Silently ignore if browser can't be opened
  }
};

const isInsideGitRepo = async (): Promise<boolean> => {
  try {
    const result = await Bun.$`git rev-parse --is-inside-work-tree`.quiet();
    return result.text().trim() === "true";
  } catch {
    return false;
  }
};

const validateEnvironment = async (
  config: Config
): Promise<{ errors: string[]; shouldCreateDir: boolean }> => {
  const errors: string[] = [];

  // Check if we're in a git repository first (works from any subdirectory or worktree)
  const inGitRepo = await isInsideGitRepo();
  if (!inGitRepo) {
    errors.push(
      "Not a git repository. The orchestrator requires git for worktree management.\n" +
        "  Initialize with: git init"
    );
  }

  const shouldCreateDir =
    errors.length === 0 && !existsSync(config.devsfactoryDir);

  return { errors, shouldCreateDir };
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

const main = async () => {
  const args = process.argv.slice(2);
  const { help, version, error } = parseArgs(args);

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

  const config = parseEnvConfig();
  const { errors: validationErrors, shouldCreateDir } =
    await validateEnvironment(config);

  if (validationErrors.length > 0) {
    console.error("Configuration errors:\n");
    for (const err of validationErrors) {
      console.error(`  - ${err}\n`);
    }
    console.error("Run 'aop --help' for setup instructions.");
    process.exit(1);
  }

  if (shouldCreateDir) {
    mkdirSync(config.devsfactoryDir, { recursive: true });
  }

  await configureLogger();
  const log = getLogger("orchestrator");

  if (shouldCreateDir) {
    log.info(
      `Created ${process.env.DEVSFACTORY_DIR ?? ".devsfactory"} directory`
    );
  }
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

  // Start dashboard server
  const dashboardPort = Number(process.env.DASHBOARD_PORT ?? 3001);
  const dashboardServer = new DashboardServer(orchestrator, {
    port: dashboardPort,
    devsfactoryDir: config.devsfactoryDir
  });
  await dashboardServer.start();
  const dashboardUrl = `http://localhost:${dashboardServer.port}`;
  log.info(`Dashboard available at ${dashboardUrl}`);
  openBrowser(dashboardUrl);

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

  orchestrator.on("workerJobCompleted", (data) => {
    log.info("Job completed", data);
  });

  orchestrator.on("workerJobFailed", (data) => {
    log.error(`Job failed: ${data.error}`, data);
  });

  orchestrator.on("workerJobRetrying", (data) => {
    log.warn(
      `Job retrying (attempt ${data.attempt}, next in ${data.nextRetryMs}ms)`,
      data
    );
  });

  const shutdown = async () => {
    log.info("Shutting down...");
    await dashboardServer.stop();
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
