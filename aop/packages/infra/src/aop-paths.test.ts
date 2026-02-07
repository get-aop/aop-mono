import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "./aop-paths.ts";

const AOP_HOME = join(homedir(), ".aop");

describe("aopPaths", () => {
  test("home returns ~/.aop", () => {
    expect(aopPaths.home()).toBe(AOP_HOME);
  });

  test("db returns ~/.aop/aop.sqlite", () => {
    expect(aopPaths.db()).toBe(join(AOP_HOME, "aop.sqlite"));
  });

  test("logs returns ~/.aop/logs", () => {
    expect(aopPaths.logs()).toBe(join(AOP_HOME, "logs"));
  });

  test("repoDir returns ~/.aop/repos/<repoId>", () => {
    expect(aopPaths.repoDir("repo_abc123")).toBe(join(AOP_HOME, "repos", "repo_abc123"));
  });

  test("openspec returns ~/.aop/repos/<repoId>/openspec", () => {
    expect(aopPaths.openspec("repo_abc123")).toBe(
      join(AOP_HOME, "repos", "repo_abc123", "openspec"),
    );
  });

  test("openspecChanges returns ~/.aop/repos/<repoId>/openspec/changes", () => {
    expect(aopPaths.openspecChanges("repo_abc123")).toBe(
      join(AOP_HOME, "repos", "repo_abc123", "openspec", "changes"),
    );
  });

  test("worktrees returns ~/.aop/repos/<repoId>/worktrees", () => {
    expect(aopPaths.worktrees("repo_abc123")).toBe(
      join(AOP_HOME, "repos", "repo_abc123", "worktrees"),
    );
  });

  test("worktree returns ~/.aop/repos/<repoId>/worktrees/<taskId>", () => {
    expect(aopPaths.worktree("repo_abc123", "task_xyz789")).toBe(
      join(AOP_HOME, "repos", "repo_abc123", "worktrees", "task_xyz789"),
    );
  });

  test("worktreeMetadata returns ~/.aop/repos/<repoId>/worktrees/.metadata", () => {
    expect(aopPaths.worktreeMetadata("repo_abc123")).toBe(
      join(AOP_HOME, "repos", "repo_abc123", "worktrees", ".metadata"),
    );
  });
});
