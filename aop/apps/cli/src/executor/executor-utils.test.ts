import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task } from "../db/schema.ts";
import { buildPromptForExecution, ensureDir } from "./executor.ts";

describe("buildPromptForExecution", () => {
  test("resolves template with step command context", async () => {
    const executorCtx = {
      task: { id: "task_123" } as Task,
      repoPath: "/test/repo",
      changePath: "/test/repo/changes/my-change",
      worktreePath: "/test/repo/.worktrees/task_123",
      logsDir: "/test/logs",
      timeoutSecs: 1800,
    };

    const worktreeInfo = {
      path: "/test/repo/.worktrees/task_123",
      branch: "task_123",
      baseBranch: "main",
      baseCommit: "abc123",
    };

    const stepCommand = {
      id: "step_456",
      type: "implement",
      promptTemplate: "Worktree: {{ worktree.path }}\nTask: {{ task.id }}",
      attempt: 1,
    };

    const prompt = await buildPromptForExecution({
      executorCtx,
      worktreeInfo,
      stepCommand,
      executionId: "exec_789",
    });

    expect(prompt).toContain("/test/repo/.worktrees/task_123");
    expect(prompt).toContain("task_123");
  });

  test("handles missing executionId by using empty string", async () => {
    const executorCtx = {
      task: { id: "task_no_exec" } as Task,
      repoPath: "/test/repo",
      changePath: "/test/repo/changes/my-change",
      worktreePath: "/test/repo/.worktrees/task_no_exec",
      logsDir: "/test/logs",
      timeoutSecs: 1800,
    };

    const worktreeInfo = {
      path: "/test/repo/.worktrees/task_no_exec",
      branch: "task_no_exec",
      baseBranch: "main",
      baseCommit: "abc123",
    };

    const stepCommand = {
      id: "step_123",
      type: "implement",
      promptTemplate: "Exec: {{ execution.id }}",
      attempt: 1,
    };

    const prompt = await buildPromptForExecution({
      executorCtx,
      worktreeInfo,
      stepCommand,
    });

    expect(prompt).toContain("Exec:");
  });
});

describe("ensureDir", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "executor-dir-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates directory if it does not exist", () => {
    const newDir = join(tempDir, "new-dir");
    expect(existsSync(newDir)).toBe(false);

    ensureDir(newDir);

    expect(existsSync(newDir)).toBe(true);
  });

  test("does not throw if directory already exists", () => {
    const existingDir = join(tempDir, "existing");
    mkdirSync(existingDir);

    expect(() => ensureDir(existingDir)).not.toThrow();
  });

  test("creates nested directories recursively", () => {
    const nestedDir = join(tempDir, "a", "b", "c");
    expect(existsSync(nestedDir)).toBe(false);

    ensureDir(nestedDir);

    expect(existsSync(nestedDir)).toBe(true);
  });
});
