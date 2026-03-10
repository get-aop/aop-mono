import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { GitManager, WorktreeExistsError, type WorktreeInfo } from "@aop/git-manager";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { ExecutorContext } from "./types.ts";
import { createWorktree } from "./worktree-manager.ts";

describe("createWorktree", () => {
  let cleanupAopHome: () => void;

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
  });

  afterEach(() => {
    mock.restore();
    cleanupAopHome();
  });

  test("creates a worktree from the repo default branch", async () => {
    const worktree: WorktreeInfo = {
      path: "/tmp/worktree/task-1",
      branch: "restore-auth-flow",
      baseBranch: "release",
      baseCommit: "abc123",
    };
    const initSpy = spyOn(GitManager.prototype, "init").mockResolvedValue(undefined);
    const getDefaultBranchSpy = spyOn(GitManager.prototype, "getDefaultBranch").mockResolvedValue(
      "main",
    );
    const createWorktreeSpy = spyOn(GitManager.prototype, "createWorktree").mockResolvedValue(
      worktree,
    );

    const ctx = {
      repoId: "repo-1",
      repoPath: "/tmp/repo-1",
      task: {
        id: "task-1",
        change_path: "docs/tasks/restore-auth-flow",
        base_branch: "release",
      },
    } as ExecutorContext;

    await expect(createWorktree(ctx)).resolves.toEqual(worktree);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(getDefaultBranchSpy).toHaveBeenCalledTimes(1);
    expect(createWorktreeSpy).toHaveBeenCalledWith("task-1", "main", "restore-auth-flow");
  });

  test("returns the existing worktree path when the worktree already exists", async () => {
    const initSpy = spyOn(GitManager.prototype, "init").mockResolvedValue(undefined);
    const getDefaultBranchSpy = spyOn(GitManager.prototype, "getDefaultBranch").mockResolvedValue(
      "main",
    );
    const createWorktreeSpy = spyOn(GitManager.prototype, "createWorktree").mockRejectedValue(
      new WorktreeExistsError("task-2"),
    );

    const ctx = {
      repoId: "repo-2",
      repoPath: "/tmp/repo-2",
      task: {
        id: "task-2",
        change_path: "docs/tasks/ship-dashboard",
        base_branch: null,
      },
    } as ExecutorContext;

    await expect(createWorktree(ctx)).resolves.toEqual({
      path: aopPaths.worktree("repo-2", "task-2"),
      branch: "ship-dashboard",
      baseBranch: "main",
      baseCommit: "",
    });
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(getDefaultBranchSpy).toHaveBeenCalledTimes(1);
    expect(createWorktreeSpy).toHaveBeenCalledWith("task-2", "main", "ship-dashboard");
  });

  test("rethrows unexpected worktree creation errors", async () => {
    const failure = new Error("git failed");
    const initSpy = spyOn(GitManager.prototype, "init").mockResolvedValue(undefined);
    const getDefaultBranchSpy = spyOn(GitManager.prototype, "getDefaultBranch").mockResolvedValue(
      "main",
    );
    const createWorktreeSpy = spyOn(GitManager.prototype, "createWorktree").mockRejectedValue(
      failure,
    );

    const ctx = {
      repoId: "repo-3",
      repoPath: "/tmp/repo-3",
      task: {
        id: "task-3",
        change_path: "docs/tasks/ship-dashboard",
        base_branch: null,
      },
    } as ExecutorContext;

    await expect(createWorktree(ctx)).rejects.toThrow("git failed");
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(getDefaultBranchSpy).toHaveBeenCalledTimes(1);
    expect(createWorktreeSpy).toHaveBeenCalledWith("task-3", "main", "ship-dashboard");
  });
});
