#!/usr/bin/env bun
import { agentCommand } from "./commands/agent";
import { parseAuthArgs, runAuthCommand, runAuthStatus } from "./commands/auth";
import {
  parseCreateTaskArgs,
  runCreateTaskCommand
} from "./commands/create-task";
import { dashboardCommand } from "./commands/dashboard";
import { parseInitArgs, runInitCommand } from "./commands/init";
import { parseMigrateArgs, runMigrateCommand } from "./commands/migrate";
import { parseProjectsArgs, runProjectsCommand } from "./commands/projects";
import { serverCommand } from "./commands/server";
import { startTaskCommand } from "./commands/start-task";
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
  auth                     Check Claude Code authentication
  auth status              Check authentication status
  server                   Run AOP server (stateless coordinator)
  dashboard                Connect to remote server and show dashboard UI
  agent                    Run as a remote agent (connects to server)
  agent --init             Initialize agent configuration
  init [path]              Register a git repository with AOP
  projects                 List all registered projects
  projects remove <name>   Unregister a project
  status [project]         Show status of tasks across projects
  start-task <task-folder> | --task-id <id> Move a task to PENDING
  stats <task-folder>      Export timing statistics as JSON
  create-task <desc>       Create a new task via Claude Code
  sys-debug <desc>         Debug an issue via Claude Code
  migrate                  Migrate existing markdown files to SQLite

ENVIRONMENT VARIABLES
  DASHBOARD_PORT        Dashboard server port (default: 3001)
  MAX_CONCURRENT_AGENTS Maximum parallel agents (default: 2)

SETUP
  1. Install Claude Code: npm install -g @anthropic-ai/claude-code
  2. Run 'claude' to authenticate Claude Code
  3. Install aop globally: bun install -g aop
  4. Run 'aop server --secret <your-secret>' to start the server
  5. Go to your project directory and run 'aop init'
  6. Run 'aop create-task "your task description"' to create a task

EXAMPLES
  # Start AOP server
  aop server --secret <your-secret>

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
  "agent",
  "auth",
  "dashboard",
  "init",
  "migrate",
  "projects",
  "server",
  "status",
  "start-task",
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
aop auth - Check Claude Code authentication status

USAGE
  aop auth [options]
  aop auth status

OPTIONS
  -h, --help    Show this help message

SUBCOMMANDS
  status    Check authentication status

DESCRIPTION
  Verifies that Claude Code is installed and properly authenticated.
  AOP uses Claude Code for all AI operations, so Claude Code must be
  installed and authenticated before using AOP.

EXAMPLES
  aop auth           # Check and verify Claude Code setup
  aop auth status    # Check if authenticated
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
  if (!paths) {
    showError(
      "Not in a project context. Run from a registered project directory."
    );
    process.exit(1);
  }

  const statsArgs = parseStatsArgs(commandArgs);
  if (statsArgs.error) {
    showError(statsArgs.error);
    process.exit(1);
  }

  const result = await runStatsCommand(
    statsArgs.taskFolder!,
    paths.projectName
  );
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

const handleMigrateCommand = async (commandArgs: string[]) => {
  const migrateArgs = parseMigrateArgs(commandArgs);

  if (migrateArgs.help) {
    console.log(
      `
aop migrate - Migrate existing markdown files to SQLite

USAGE
  aop migrate [options]

OPTIONS
  --dry-run        Show what would be migrated without making changes
  --remove-files   Remove markdown files after successful migration
  -h, --help       Show this help message

DESCRIPTION
  Imports existing task, plan, and subtask markdown files from ~/.aop/tasks/
  into the SQLite database. Use this when upgrading from file-based storage.

  Files already in SQLite are skipped. The command reports a summary of
  tasks, subtasks, and plans imported.

EXAMPLES
  aop migrate                  # Migrate all files to SQLite
  aop migrate --dry-run        # Preview what would be migrated
  aop migrate --remove-files   # Migrate and delete original files
`.trim()
    );
    process.exit(0);
  }

  if (migrateArgs.error) {
    showError(migrateArgs.error);
    process.exit(1);
  }

  const result = await runMigrateCommand(migrateArgs);
  if (result.success) {
    const s = result.summary!;
    console.log("\nMigration complete:");
    console.log(`  Tasks imported:     ${s.tasksImported}`);
    console.log(`  Subtasks imported:  ${s.subtasksImported}`);
    console.log(`  Plans imported:     ${s.plansImported}`);
    console.log(`  Skipped (existing): ${s.skipped}`);
    if (s.errors > 0) {
      console.log(`  Errors:             ${s.errors}`);
      if (result.failedFiles) {
        console.log("\nFailed files:");
        for (const file of result.failedFiles) {
          console.log(`  - ${file}`);
        }
      }
    }
    process.exit(result.hasErrors ? 1 : 0);
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
    case "agent":
      return agentCommand(commandArgs);
    case "auth":
      return handleAuthCommand(commandArgs);
    case "dashboard":
      return dashboardCommand(commandArgs);
    case "init":
      return handleInitCommand(commandArgs);
    case "migrate":
      return handleMigrateCommand(commandArgs);
    case "projects":
      return handleProjectsCommand(commandArgs);
    case "server":
      return serverCommand(commandArgs);
    case "status":
      return handleStatusCommand(commandArgs);
    case "start-task":
      return startTaskCommand(commandArgs);
    case "stats":
      return handleStatsCommand(commandArgs);
    case "create-task":
      return handleCreateTaskCommand(commandArgs);
    case "sys-debug":
      return handleSysDebugCommand(commandArgs);
    case undefined:
      return showHelp();
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
