import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestRepos, createTestRepo as createGitTestRepo } from "@aop/git-manager/test-utils";
import type { Task } from "../db/schema.ts";
import { createWorktree } from "./executor.ts";

describe("createWorktree", () => {
  afterEach(async () => {
    await cleanupTestRepos();
  });

  test("creates worktree for task", async () => {
    const repoPath = await createGitTestRepo({ withInitialCommit: true });
    const taskId = "task_worktree_test";

    const executorCtx = {
      task: { id: taskId } as Task,
      repoPath,
      changePath: join(repoPath, "changes", taskId),
      worktreePath: join(repoPath, ".worktrees", taskId),
      logsDir: join(repoPath, "logs"),
      timeoutSecs: 1800,
    };

    const result = await createWorktree(executorCtx);

    expect(result.path).toContain(taskId);
    expect(result.branch).toBe(taskId);
    expect(existsSync(result.path)).toBe(true);
  });

  test("returns fallback when worktree already exists", async () => {
    const repoPath = await createGitTestRepo({ withInitialCommit: true });
    const taskId = "task_existing_worktree";

    const executorCtx = {
      task: { id: taskId } as Task,
      repoPath,
      changePath: join(repoPath, "changes", taskId),
      worktreePath: join(repoPath, ".worktrees", taskId),
      logsDir: join(repoPath, "logs"),
      timeoutSecs: 1800,
    };

    await createWorktree(executorCtx);
    expect(existsSync(join(repoPath, ".worktrees", taskId))).toBe(true);

    const result = await createWorktree(executorCtx);

    expect(result.path).toBe(join(repoPath, ".worktrees", taskId));
    expect(result.branch).toBe(taskId);
    expect(result.baseBranch).toBe("main");
    expect(result.baseCommit).toBe("");
  });
});
