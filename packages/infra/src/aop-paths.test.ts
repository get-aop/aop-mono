import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "./aop-paths.ts";

const DEFAULT_AOP_HOME = join(homedir(), ".aop");

describe("aopPaths", () => {
  let originalAopHome: string | undefined;

  beforeEach(() => {
    originalAopHome = process.env.AOP_HOME;
    delete process.env.AOP_HOME;
  });

  afterEach(() => {
    if (originalAopHome !== undefined) {
      process.env.AOP_HOME = originalAopHome;
    } else {
      delete process.env.AOP_HOME;
    }
  });

  test("home returns ~/.aop by default", () => {
    expect(aopPaths.home()).toBe(DEFAULT_AOP_HOME);
  });

  test("home respects AOP_HOME env var", () => {
    process.env.AOP_HOME = "/tmp/custom-aop";
    expect(aopPaths.home()).toBe("/tmp/custom-aop");
  });

  test("db returns <home>/aop.sqlite", () => {
    expect(aopPaths.db()).toBe(join(DEFAULT_AOP_HOME, "aop.sqlite"));
  });

  test("logs returns <home>/logs", () => {
    expect(aopPaths.logs()).toBe(join(DEFAULT_AOP_HOME, "logs"));
  });

  test("linearTokens returns <home>/secrets/linear-tokens.enc", () => {
    expect(aopPaths.linearTokens()).toBe(join(DEFAULT_AOP_HOME, "secrets", "linear-tokens.enc"));
  });

  test("repoDir returns <home>/repos/<repoId>", () => {
    expect(aopPaths.repoDir("repo_abc123")).toBe(join(DEFAULT_AOP_HOME, "repos", "repo_abc123"));
  });

  test("relativeTaskDocs returns docs/tasks", () => {
    expect(aopPaths.relativeTaskDocs()).toBe(join("docs", "tasks"));
  });

  test("worktrees returns <home>/worktrees/<repoId>", () => {
    expect(aopPaths.worktrees("repo_abc123")).toBe(join(DEFAULT_AOP_HOME, "worktrees", "repo_abc123"));
  });

  test("worktree returns <home>/worktrees/<repoId>/<taskId>", () => {
    expect(aopPaths.worktree("repo_abc123", "task_xyz789")).toBe(
      join(DEFAULT_AOP_HOME, "worktrees", "repo_abc123", "task_xyz789"),
    );
  });

  test("worktreeMetadata returns <home>/worktrees/<repoId>/.metadata", () => {
    expect(aopPaths.worktreeMetadata("repo_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "worktrees", "repo_abc123", ".metadata"),
    );
  });

  test("all paths use AOP_HOME when set", () => {
    process.env.AOP_HOME = "/tmp/test-aop";
    expect(aopPaths.repoDir("r1")).toBe("/tmp/test-aop/repos/r1");
    expect(aopPaths.worktrees("r1")).toBe("/tmp/test-aop/worktrees/r1");
    expect(aopPaths.linearTokens()).toBe("/tmp/test-aop/secrets/linear-tokens.enc");
  });
});
