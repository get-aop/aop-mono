#!/usr/bin/env bun
import { join } from "node:path";
import {
  parseAuthArgs,
  runAuthCommand,
  runAuthStatus,
  runAuthWithToken
} from "./commands/auth";
import {
  parseCreateTaskArgs,
  runCreateTaskCommand
} from "./commands/create-task";
import { parseInitArgs, runInitCommand } from "./commands/init";
import { parseProjectsArgs, runProjectsCommand } from "./commands/projects";
import { parseRunArgs, runStart, runStatus, runStop } from "./commands/run";
import { parseStatsArgs, runStatsCommand } from "./commands/stats";
import { parseStatusArgs, runStatusCommand } from "./commands/status";
import { parseSysDebugArgs, runSysDebugCommand } from "./commands/sys-debug";
import { ensureGlobalDir } from "./core/global-bootstrap";
import { resolvePaths } from "./core/path-resolver";

const VERSION = "0.1.0";

const HELP_TEXT = `
aop - Agent Orchestration Platform

USAGE
  aop [command] [options]

DESCRIPTION
  A CLI tool that orchestrates AI agents to implement software tasks.
  Tasks are defined as markdown files, and agents work in git worktrees
  to implement them autonomously.

OPTIONS
  -h, --help      Show this help message
  -v, --version   Show version number

COMMANDS
  auth                     Set up Anthropic API authentication
  auth status              Check authentication status
  run                      Start AOP orchestrator (default)
  run stop                 Stop AOP containers
  run status               Show AOP container status
  init [path]              Register a git repository with AOP
  projects                 List all registered projects
  projects remove <name>   Unregister a project
  status [project]         Show status of tasks across projects
  stats <task-folder>      Export timing statistics as JSON
  create-task <desc>       Create a new task via Claude Code
  sys-debug <desc>         Debug an issue via Claude Code

ENVIRONMENT VARIABLES
  DASHBOARD_PORT        Dashboard server port (default: 3001)
  MAX_CONCURRENT_AGENTS Maximum parallel agents (default: 2)

SETUP
  1. Install aop globally: bun install -g aop
  2. Run 'aop auth' to set up Anthropic API authentication
  3. Run 'aop run' to start the orchestrator (requires Docker)
  4. Go to your project directory and run 'aop init'
  5. Run 'aop create-task "your task description"' to create a task

EXAMPLES
  # Start AOP orchestrator
  aop run

  # Stop AOP
  aop run stop

  # Check AOP status
  aop run status

  # Register current repository
  aop init

  # Create a new task
  aop create-task "Add user authentication with JWT"

  # View status of all projects
  aop status

DOCUMENTATION
  https://github.com/anthropics/devsfactory
`;

const COMMANDS = [
  "auth",
  "init",
  "projects",
  "status",
  "run",
  "stats",
  "create-task",
  "sys-debug"
] as const;

type Command = (typeof COMMANDS)[number];

interface ParsedArgs {
  help: boolean;
  version: boolean;
  command?: Command;
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
    if (COMMANDS.includes(arg as Command)) {
      result.command = arg as Command;
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

const handleAuthCommand = async (commandArgs: string[]) => {
  const authArgs = parseAuthArgs(commandArgs);

  if (authArgs.help) {
    console.log(
      `
aop auth - Set up Anthropic API authentication

USAGE
  aop auth [options]
  aop auth <token>
  aop auth status

OPTIONS
  -h, --help          Show this help message
  -t, --token <tok>   Store a token directly (skip browser flow)

SUBCOMMANDS
  status    Check authentication status

DESCRIPTION
  Sets up authentication for the Anthropic API using Claude's setup-token flow.
  This opens a browser window to authenticate and stores the token locally.

  The token is stored in ~/.claude-agi/auth.json and automatically used
  by commands like 'aop create-task'.

  You can also pass a token directly if you already have one.

EXAMPLES
  aop auth                      # Set up via browser
  aop auth sk-ant-oat01-xxx     # Store token directly
  aop auth status               # Check if authenticated
`.trim()
    );
    process.exit(0);
  }

  if (authArgs.error) {
    showError(authArgs.error);
    process.exit(1);
  }

  if (authArgs.status) {
    const result = await runAuthStatus();
    if (result.success) {
      console.log(result.message);
      process.exit(0);
    } else {
      showError(result.error!);
      process.exit(1);
    }
  }

  if (authArgs.token) {
    const result = await runAuthWithToken(authArgs.token);
    if (result.success) {
      console.log(result.message);
      process.exit(0);
    } else {
      showError(result.error!);
      process.exit(1);
    }
  }

  const result = await runAuthCommand();
  if (result.success) {
    console.log(result.message);
    process.exit(0);
  } else {
    showError(result.error!);
    process.exit(1);
  }
};

const handleInitCommand = async (commandArgs: string[]) => {
  const initArgs = parseInitArgs(commandArgs);

  if (initArgs.help) {
    console.log(
      `
aop init - Register a git repository with AOP

USAGE
  aop init [path]

ARGUMENTS
  path    Path to the git repository (default: current directory)

EXAMPLES
  aop init              # Register current directory
  aop init /path/to/repo  # Register specific repository
`.trim()
    );
    process.exit(0);
  }

  if (initArgs.error) {
    showError(initArgs.error);
    process.exit(1);
  }

  const result = await runInitCommand(initArgs.path);
  if (result.success) {
    console.log(result.message);
    process.exit(0);
  } else {
    showError(result.error!);
    process.exit(1);
  }
};

const handleProjectsCommand = async (commandArgs: string[]) => {
  const projectsArgs = parseProjectsArgs(commandArgs);

  if (projectsArgs.error) {
    showError(projectsArgs.error);
    process.exit(1);
  }

  const result = await runProjectsCommand(
    projectsArgs.subcommand,
    projectsArgs.projectName
  );
  if (result.success) {
    console.log(result.output);
    process.exit(0);
  } else {
    showError(result.error!);
    process.exit(1);
  }
};

const handleStatusCommand = async (commandArgs: string[]) => {
  const statusArgs = parseStatusArgs(commandArgs);

  if (statusArgs.help) {
    console.log(
      `
aop status - Show status of tasks across projects

USAGE
  aop status [project]

ARGUMENTS
  project    Project name (optional). If omitted:
             - Shows current project if in a project directory
             - Shows all projects summary otherwise

DESCRIPTION
  Displays task status for one or more projects. Shows task counts
  grouped by status (PENDING, INPROGRESS, DONE).

  When viewing a single project, shows detailed task list with
  progress information for tasks in progress.

EXAMPLES
  aop status              # Show all projects or current project
  aop status my-project   # Show detailed status for my-project
`.trim()
    );
    process.exit(0);
  }

  if (statusArgs.error) {
    showError(statusArgs.error);
    process.exit(1);
  }

  const result = await runStatusCommand(statusArgs.projectName);
  if (result.success) {
    console.log(result.output);
    process.exit(0);
  } else {
    showError(result.error!);
    process.exit(1);
  }
};

const handleStatsCommand = async (commandArgs: string[]) => {
  const paths = await resolvePaths();
  const devsfactoryDir =
    paths?.devsfactoryDir ?? join(process.cwd(), ".devsfactory");

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

const handleCreateTaskCommand = async (commandArgs: string[]) => {
  const createTaskArgs = parseCreateTaskArgs(commandArgs);

  if (createTaskArgs.help) {
    console.log(
      `
aop create-task - Create a new task via Claude Code

USAGE
  aop create-task <description> [options]

ARGUMENTS
  description    Task description (can be very detailed, use quotes)

OPTIONS
  -p, --project <name>   Project name (default: auto-detect from cwd)
  -s, --slug <name>      Slug for the task folder name
  -d, --debug            Enable Claude debug mode (shows detailed output)
  -r, --raw              Show raw Claude JSON output (for debugging)
  -h, --help             Show this help message

DESCRIPTION
  Spawns Claude Code and runs the /create-task skill with your description.
  Claude will brainstorm requirements and break the task into subtasks.

EXAMPLES
  aop create-task "Add user authentication with JWT"
  aop create-task "Fix the login bug where users get logged out" -p my-project
  aop create-task "Implement dark mode" --slug dark-mode
  aop create-task "Debug issue" --debug
  aop create-task "Test" --raw  # See raw Claude output
`.trim()
    );
    process.exit(0);
  }

  if (createTaskArgs.error) {
    showError(createTaskArgs.error);
    process.exit(1);
  }

  const result = await runCreateTaskCommand(createTaskArgs);
  if (result.success) {
    if (result.message) {
      console.log(result.message);
    }
    process.exit(0);
  } else {
    showError(result.error!);
    process.exit(1);
  }
};

const handleSysDebugCommand = async (commandArgs: string[]) => {
  const sysDebugArgs = parseSysDebugArgs(commandArgs);

  if (sysDebugArgs.help) {
    console.log(
      `
aop sys-debug - Debug an issue via Claude Code

USAGE
  aop sys-debug <description> [options]

ARGUMENTS
  description    Bug or issue description (can be very detailed, use quotes)

OPTIONS
  -p, --project <name>   Project name (default: auto-detect from cwd)
  -d, --debug            Enable Claude debug mode (shows detailed output)
  -h, --help             Show this help message

DESCRIPTION
  Spawns Claude Code and runs the /systematic-debugging skill with your
  description. Claude will systematically investigate and debug the issue.

EXAMPLES
  aop sys-debug "Tests are failing with timeout errors"
  aop sys-debug "Login page crashes on submit" -p my-project
  aop sys-debug "Memory leak in the dashboard component"
  aop sys-debug "API returns 500" --debug
`.trim()
    );
    process.exit(0);
  }

  if (sysDebugArgs.error) {
    showError(sysDebugArgs.error);
    process.exit(1);
  }

  const result = await runSysDebugCommand(sysDebugArgs);
  if (result.success) {
    if (result.message) {
      console.log(result.message);
    }
    process.exit(0);
  } else {
    showError(result.error!);
    process.exit(1);
  }
};

const dispatchCommand = async (
  command: Command | undefined,
  commandArgs: string[]
): Promise<void> => {
  switch (command) {
    case "auth":
      return handleAuthCommand(commandArgs);
    case "init":
      return handleInitCommand(commandArgs);
    case "projects":
      return handleProjectsCommand(commandArgs);
    case "status":
      return handleStatusCommand(commandArgs);
    case "stats":
      return handleStatsCommand(commandArgs);
    case "create-task":
      return handleCreateTaskCommand(commandArgs);
    case "sys-debug":
      return handleSysDebugCommand(commandArgs);
    case "run":
    case undefined:
      return handleRunCommand(commandArgs);
  }
};

const RUN_HELP_TEXT = `
aop run - Start AOP orchestrator

USAGE
  aop run [options]
  aop run stop
  aop run status

OPTIONS
  -h, --help  Show this help message

SUBCOMMANDS
  stop     Stop AOP containers
  status   Show AOP container status

DESCRIPTION
  Starts the AOP orchestrator in a Docker container.

  After starting, go to your project directory, run 'aop init' to register it,
  then use 'aop create-task' to create tasks for the AI agents.

EXAMPLES
  aop run          # Start AOP
  aop run stop     # Stop AOP
  aop run status   # Check status
`.trim();

const handleRunCommand = async (commandArgs: string[]) => {
  const runArgs = parseRunArgs(commandArgs);

  if (runArgs.help) {
    console.log(RUN_HELP_TEXT);
    process.exit(0);
  }

  if (runArgs.error) {
    showError(runArgs.error);
    process.exit(1);
  }

  if (runArgs.stop) {
    const result = await runStop();
    if (result.success) {
      console.log(result.message);
      process.exit(0);
    } else {
      showError(result.error!);
      process.exit(1);
    }
  }

  if (runArgs.status) {
    const result = await runStatus();
    if (result.success) {
      console.log(result.message);
      process.exit(0);
    } else {
      showError(result.error!);
      process.exit(1);
    }
  }

  const options = {
    dashboardPort: Number(process.env.DASHBOARD_PORT ?? 3001),
    maxConcurrentAgents: Number(process.env.MAX_CONCURRENT_AGENTS ?? 2)
  };

  const result = await runStart(options, (message) => console.log(message));

  if (result.success) {
    console.log(`\n${result.message}`);
    if (result.dashboardUrl) {
      openBrowser(result.dashboardUrl);
    }
    process.exit(0);
  } else {
    showError(result.error!);
    process.exit(1);
  }
};

const main = async () => {
  await ensureGlobalDir();

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

  await dispatchCommand(command, commandArgs);
};

main().catch((err) => {
  console.error("\nFatal error:", err.message ?? err);
  console.error("\nRun 'aop --help' for usage information.");
  process.exit(1);
});
