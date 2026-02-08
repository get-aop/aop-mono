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

  test("repoDir returns <home>/repos/<repoId>", () => {
    expect(aopPaths.repoDir("repo_abc123")).toBe(join(DEFAULT_AOP_HOME, "repos", "repo_abc123"));
  });

  test("openspec returns <home>/repos/<repoId>/openspec", () => {
    expect(aopPaths.openspec("repo_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "repos", "repo_abc123", "openspec"),
    );
  });

  test("openspecChanges returns <home>/repos/<repoId>/openspec/changes", () => {
    expect(aopPaths.openspecChanges("repo_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "repos", "repo_abc123", "openspec", "changes"),
    );
  });

  test("worktrees returns <home>/repos/<repoId>/worktrees", () => {
    expect(aopPaths.worktrees("repo_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "repos", "repo_abc123", "worktrees"),
    );
  });

  test("worktree returns <home>/repos/<repoId>/worktrees/<taskId>", () => {
    expect(aopPaths.worktree("repo_abc123", "task_xyz789")).toBe(
      join(DEFAULT_AOP_HOME, "repos", "repo_abc123", "worktrees", "task_xyz789"),
    );
  });

  test("worktreeMetadata returns <home>/repos/<repoId>/worktrees/.metadata", () => {
    expect(aopPaths.worktreeMetadata("repo_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "repos", "repo_abc123", "worktrees", ".metadata"),
    );
  });

  test("all paths use AOP_HOME when set", () => {
    process.env.AOP_HOME = "/tmp/test-aop";
    expect(aopPaths.repoDir("r1")).toBe("/tmp/test-aop/repos/r1");
    expect(aopPaths.openspec("r1")).toBe("/tmp/test-aop/repos/r1/openspec");
    expect(aopPaths.worktrees("r1")).toBe("/tmp/test-aop/repos/r1/worktrees");
  });
});
