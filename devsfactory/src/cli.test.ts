import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

const COMMANDS = [
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

const parseEnvConfig = () => {
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

  return {
    maxConcurrentAgents,
    devsfactoryDir,
    worktreesDir,
    debounceMs,
    retryBackoff: { initialMs: retryInitialMs, maxMs: retryMaxMs },
    ignorePatterns: [".git", "*.swp", "*.tmp", "*~", ".DS_Store"]
  };
};

describe("CLI argument parsing", () => {
  test("returns help flag for -h", () => {
    const result = parseArgs(["-h"]);
    expect(result.help).toBe(true);
    expect(result.version).toBe(false);
    expect(result.command).toBeUndefined();
  });

  test("returns help flag for --help", () => {
    const result = parseArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("returns version flag for -v", () => {
    const result = parseArgs(["-v"]);
    expect(result.version).toBe(true);
    expect(result.help).toBe(false);
  });

  test("returns version flag for --version", () => {
    const result = parseArgs(["--version"]);
    expect(result.version).toBe(true);
  });

  test("parses init command", () => {
    const result = parseArgs(["init"]);
    expect(result.command).toBe("init");
    expect(result.commandArgs).toEqual([]);
  });

  test("parses init command with path argument", () => {
    const result = parseArgs(["init", "/path/to/repo"]);
    expect(result.command).toBe("init");
    expect(result.commandArgs).toEqual(["/path/to/repo"]);
  });

  test("parses projects command", () => {
    const result = parseArgs(["projects"]);
    expect(result.command).toBe("projects");
    expect(result.commandArgs).toEqual([]);
  });

  test("parses projects command with remove subcommand", () => {
    const result = parseArgs(["projects", "remove", "my-project"]);
    expect(result.command).toBe("projects");
    expect(result.commandArgs).toEqual(["remove", "my-project"]);
  });

  test("parses status command", () => {
    const result = parseArgs(["status"]);
    expect(result.command).toBe("status");
    expect(result.commandArgs).toEqual([]);
  });

  test("parses status command with project argument", () => {
    const result = parseArgs(["status", "my-project"]);
    expect(result.command).toBe("status");
    expect(result.commandArgs).toEqual(["my-project"]);
  });

  test("parses run command", () => {
    const result = parseArgs(["run"]);
    expect(result.command).toBe("run");
    expect(result.commandArgs).toEqual([]);
  });

  test("parses run command with project argument", () => {
    const result = parseArgs(["run", "my-project"]);
    expect(result.command).toBe("run");
    expect(result.commandArgs).toEqual(["my-project"]);
  });

  test("parses run command with --all flag", () => {
    const result = parseArgs(["run", "--all"]);
    expect(result.command).toBe("run");
    expect(result.commandArgs).toEqual(["--all"]);
  });

  test("parses stats command", () => {
    const result = parseArgs(["stats", "my-task"]);
    expect(result.command).toBe("stats");
    expect(result.commandArgs).toEqual(["my-task"]);
  });

  test("parses create-task command", () => {
    const result = parseArgs(["create-task"]);
    expect(result.command).toBe("create-task");
    expect(result.commandArgs).toEqual([]);
  });

  test("parses create-task command with description", () => {
    const result = parseArgs(["create-task", "Add user authentication"]);
    expect(result.command).toBe("create-task");
    expect(result.commandArgs).toEqual(["Add user authentication"]);
  });

  test("parses create-task command with description and project", () => {
    const result = parseArgs(["create-task", "Add auth", "-p", "my-project"]);
    expect(result.command).toBe("create-task");
    expect(result.commandArgs).toEqual(["Add auth", "-p", "my-project"]);
  });

  test("parses sys-debug command", () => {
    const result = parseArgs(["sys-debug"]);
    expect(result.command).toBe("sys-debug");
    expect(result.commandArgs).toEqual([]);
  });

  test("parses sys-debug command with description", () => {
    const result = parseArgs(["sys-debug", "Tests failing with timeout"]);
    expect(result.command).toBe("sys-debug");
    expect(result.commandArgs).toEqual(["Tests failing with timeout"]);
  });

  test("parses sys-debug command with description and project", () => {
    const result = parseArgs([
      "sys-debug",
      "Tests failing",
      "-p",
      "my-project"
    ]);
    expect(result.command).toBe("sys-debug");
    expect(result.commandArgs).toEqual(["Tests failing", "-p", "my-project"]);
  });

  test("returns no command for empty args", () => {
    const result = parseArgs([]);
    expect(result.command).toBeUndefined();
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
    expect(result.commandArgs).toEqual([]);
  });

  test("returns error for unknown option", () => {
    const result = parseArgs(["--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });

  test("help flag takes precedence over command", () => {
    const result = parseArgs(["-h", "run"]);
    expect(result.help).toBe(true);
    expect(result.command).toBeUndefined();
  });
});

describe("CLI config parsing", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DEVSFACTORY_DIR;
    delete process.env.WORKTREES_DIR;
    delete process.env.MAX_CONCURRENT_AGENTS;
    delete process.env.DEBOUNCE_MS;
    delete process.env.RETRY_INITIAL_MS;
    delete process.env.RETRY_MAX_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("uses default values when env vars not set", () => {
    const config = parseEnvConfig();
    const cwd = process.cwd();

    expect(config.devsfactoryDir).toBe(join(cwd, ".devsfactory"));
    expect(config.worktreesDir).toBe(join(cwd, ".worktrees"));
    expect(config.maxConcurrentAgents).toBe(2);
    expect(config.debounceMs).toBe(100);
    expect(config.retryBackoff.initialMs).toBe(2000);
    expect(config.retryBackoff.maxMs).toBe(300000);
  });

  test("reads custom values from env vars", () => {
    process.env.DEVSFACTORY_DIR = "custom/tasks";
    process.env.WORKTREES_DIR = "custom/worktrees";
    process.env.MAX_CONCURRENT_AGENTS = "5";
    process.env.DEBOUNCE_MS = "200";
    process.env.RETRY_INITIAL_MS = "5000";
    process.env.RETRY_MAX_MS = "600000";

    const config = parseEnvConfig();
    const cwd = process.cwd();

    expect(config.devsfactoryDir).toBe(join(cwd, "custom/tasks"));
    expect(config.worktreesDir).toBe(join(cwd, "custom/worktrees"));
    expect(config.maxConcurrentAgents).toBe(5);
    expect(config.debounceMs).toBe(200);
    expect(config.retryBackoff.initialMs).toBe(5000);
    expect(config.retryBackoff.maxMs).toBe(600000);
  });

  test("includes default ignore patterns", () => {
    const config = parseEnvConfig();

    expect(config.ignorePatterns).toEqual([
      ".git",
      "*.swp",
      "*.tmp",
      "*~",
      ".DS_Store"
    ]);
  });
});
