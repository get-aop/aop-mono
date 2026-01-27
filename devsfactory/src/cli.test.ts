import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

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
