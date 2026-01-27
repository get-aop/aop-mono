import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("default values", () => {
    test("returns default devsfactoryDir when not set", () => {
      delete process.env.DEVSFACTORY_DIR;
      const config = loadConfig();
      expect(config.devsfactoryDir).toBe(".devsfactory");
    });

    test("returns default worktreesDir when not set", () => {
      delete process.env.WORKTREES_DIR;
      const config = loadConfig();
      expect(config.worktreesDir).toBe(".worktrees");
    });

    test("returns default maxConcurrentAgents when not set", () => {
      delete process.env.MAX_CONCURRENT_AGENTS;
      const config = loadConfig();
      expect(config.maxConcurrentAgents).toBe(3);
    });

    test("returns default debounceMs when not set", () => {
      delete process.env.DEBOUNCE_MS;
      const config = loadConfig();
      expect(config.debounceMs).toBe(100);
    });

    test("returns default retryBackoff when not set", () => {
      delete process.env.RETRY_INITIAL_MS;
      delete process.env.RETRY_MAX_MS;
      const config = loadConfig();
      expect(config.retryBackoff.initialMs).toBe(2000);
      expect(config.retryBackoff.maxMs).toBe(300000);
    });

    test("returns default ignorePatterns", () => {
      const config = loadConfig();
      expect(config.ignorePatterns).toEqual([
        ".git",
        "*.swp",
        "*.tmp",
        "*~",
        ".DS_Store"
      ]);
    });
  });

  describe("environment variable overrides", () => {
    test("reads DEVSFACTORY_DIR from environment", () => {
      process.env.DEVSFACTORY_DIR = ".custom-devsfactory";
      const config = loadConfig();
      expect(config.devsfactoryDir).toBe(".custom-devsfactory");
    });

    test("reads WORKTREES_DIR from environment", () => {
      process.env.WORKTREES_DIR = ".custom-worktrees";
      const config = loadConfig();
      expect(config.worktreesDir).toBe(".custom-worktrees");
    });

    test("reads MAX_CONCURRENT_AGENTS from environment", () => {
      process.env.MAX_CONCURRENT_AGENTS = "5";
      const config = loadConfig();
      expect(config.maxConcurrentAgents).toBe(5);
    });

    test("reads DEBOUNCE_MS from environment", () => {
      process.env.DEBOUNCE_MS = "200";
      const config = loadConfig();
      expect(config.debounceMs).toBe(200);
    });

    test("reads RETRY_INITIAL_MS from environment", () => {
      process.env.RETRY_INITIAL_MS = "5000";
      const config = loadConfig();
      expect(config.retryBackoff.initialMs).toBe(5000);
    });

    test("reads RETRY_MAX_MS from environment", () => {
      process.env.RETRY_MAX_MS = "600000";
      const config = loadConfig();
      expect(config.retryBackoff.maxMs).toBe(600000);
    });

    test("reads all environment variables together", () => {
      process.env.DEVSFACTORY_DIR = ".tasks";
      process.env.WORKTREES_DIR = ".trees";
      process.env.MAX_CONCURRENT_AGENTS = "10";
      process.env.DEBOUNCE_MS = "50";
      process.env.RETRY_INITIAL_MS = "1000";
      process.env.RETRY_MAX_MS = "120000";

      const config = loadConfig();

      expect(config.devsfactoryDir).toBe(".tasks");
      expect(config.worktreesDir).toBe(".trees");
      expect(config.maxConcurrentAgents).toBe(10);
      expect(config.debounceMs).toBe(50);
      expect(config.retryBackoff.initialMs).toBe(1000);
      expect(config.retryBackoff.maxMs).toBe(120000);
    });
  });

  describe("partial overrides", () => {
    test("uses default for retryBackoff.maxMs when only initialMs is set", () => {
      process.env.RETRY_INITIAL_MS = "3000";
      delete process.env.RETRY_MAX_MS;
      const config = loadConfig();
      expect(config.retryBackoff.initialMs).toBe(3000);
      expect(config.retryBackoff.maxMs).toBe(300000);
    });

    test("uses default for retryBackoff.initialMs when only maxMs is set", () => {
      delete process.env.RETRY_INITIAL_MS;
      process.env.RETRY_MAX_MS = "500000";
      const config = loadConfig();
      expect(config.retryBackoff.initialMs).toBe(2000);
      expect(config.retryBackoff.maxMs).toBe(500000);
    });
  });

  describe("type coercion", () => {
    test("coerces string numbers to integers", () => {
      process.env.MAX_CONCURRENT_AGENTS = "7";
      process.env.DEBOUNCE_MS = "150";
      const config = loadConfig();
      expect(typeof config.maxConcurrentAgents).toBe("number");
      expect(typeof config.debounceMs).toBe("number");
    });
  });
});
