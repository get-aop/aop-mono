import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  BranchExistsError,
  BranchNotFoundError,
  DirtyWorktreeError,
  GitConflictError,
  NoCommitsError,
  NotAGitRepositoryError,
  WorktreeExistsError,
  WorktreeNotFoundError,
} from "./errors.ts";
import { GitManager } from "./git-manager.ts";
import { cleanupTestRepos, createTestRepo, TEST_BASE_DIR } from "./test-utils.ts";

describe("GitManager", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await createTestRepo();
  });

  afterEach(async () => {
    await cleanupTestRepos();
  });

  describe("init", () => {
    test("initializes successfully for valid git repository", async () => {
      const manager = new GitManager({ repoPath });
      await expect(manager.init()).resolves.toBeUndefined();
    });

    test("throws NotAGitRepositoryError for non-git directory", async () => {
      const nonGitPath = `${TEST_BASE_DIR}/not-a-repo`;
      await Bun.$`mkdir -p ${nonGitPath}`.quiet();
      const manager = new GitManager({ repoPath: nonGitPath });
      await expect(manager.init()).rejects.toThrow(NotAGitRepositoryError);
    });
  });

  describe("createWorktree", () => {
    test("creates worktree from base branch", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      const result = await manager.createWorktree("feat-auth", "main");

      expect(result.path).toBe(`${repoPath}/.worktrees/feat-auth`);
      expect(result.branch).toBe("feat-auth");
      expect(result.baseCommit).toMatch(/^[a-f0-9]{40}$/);

      // Verify directory was created
      const dirExists = await Bun.file(`${result.path}/README.md`).exists();
      expect(dirExists).toBe(true);
    });

    test("auto-initializes .worktrees directory if missing", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");

      const result = await Bun.$`test -d ${repoPath}/.worktrees`.quiet().nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("adds .worktrees to .gitignore", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");

      const gitignore = await Bun.file(`${repoPath}/.gitignore`).text();
      expect(gitignore).toContain(".worktrees/");
    });

    test("throws WorktreeExistsError if worktree already exists", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");
      await expect(manager.createWorktree("feat-auth", "main")).rejects.toThrow(
        WorktreeExistsError,
      );
    });

    test("throws BranchNotFoundError if base branch does not exist", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      await expect(manager.createWorktree("feat-auth", "nonexistent")).rejects.toThrow(
        BranchNotFoundError,
      );
    });

    test("rejects invalid taskId with path traversal", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      await expect(manager.createWorktree("../../../etc", "main")).rejects.toThrow(
        "Invalid taskId",
      );
      await expect(manager.createWorktree("foo/../bar", "main")).rejects.toThrow("Invalid taskId");
    });

    test("rejects empty taskId", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      await expect(manager.createWorktree("", "main")).rejects.toThrow("cannot be empty");
    });
  });

  describe("squashMerge", () => {
    test("squash merges work branch into new PR branch", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      // Create worktree and make a commit
      const worktree = await manager.createWorktree("feat-auth", "main");
      await Bun.$`echo "new content" > feature.txt`.cwd(worktree.path).quiet();
      await Bun.$`git add .`.cwd(worktree.path).quiet();
      await Bun.$`git commit -m "Add feature"`.cwd(worktree.path).quiet();

      // Squash merge
      const result = await manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth");

      expect(result.targetBranch).toBe("pr/feat-auth");
      expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);

      // Verify PR branch exists with single commit
      const log = await Bun.$`git log --oneline pr/feat-auth`.cwd(repoPath).text();
      expect(log).toContain("feat: add auth");
    });

    test("throws NoCommitsError when no commits beyond base", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");

      await expect(
        manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth"),
      ).rejects.toThrow(NoCommitsError);
    });

    test("throws BranchExistsError when target branch already exists", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      // Create worktree and make a commit
      const worktree = await manager.createWorktree("feat-auth", "main");
      await Bun.$`echo "content" > feature.txt`.cwd(worktree.path).quiet();
      await Bun.$`git add .`.cwd(worktree.path).quiet();
      await Bun.$`git commit -m "Add feature"`.cwd(worktree.path).quiet();

      // Create the target branch first
      await Bun.$`git branch pr/feat-auth`.cwd(repoPath).quiet();

      await expect(
        manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth"),
      ).rejects.toThrow(BranchExistsError);
    });

    test("throws GitConflictError on merge conflict", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      // Create worktree and modify README.md
      const worktree = await manager.createWorktree("feat-auth", "main");
      await Bun.$`echo "worktree change" > README.md`.cwd(worktree.path).quiet();
      await Bun.$`git add .`.cwd(worktree.path).quiet();
      await Bun.$`git commit -m "Modify README in worktree"`.cwd(worktree.path).quiet();

      // Make conflicting change on main
      await Bun.$`echo "main change" > README.md`.cwd(repoPath).quiet();
      await Bun.$`git add .`.cwd(repoPath).quiet();
      await Bun.$`git commit -m "Modify README on main"`.cwd(repoPath).quiet();

      await expect(
        manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth"),
      ).rejects.toThrow(GitConflictError);

      // Verify no partial merge state left
      const status = await Bun.$`git status --porcelain`.cwd(repoPath).text();
      expect(status.trim()).toBe("");
    });
  });

  describe("removeWorktree", () => {
    test("removes clean worktree and its branch", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");

      // Verify worktree exists
      expect(
        await Bun.$`test -d ${worktree.path}`
          .quiet()
          .nothrow()
          .then((r) => r.exitCode),
      ).toBe(0);

      await manager.removeWorktree("feat-auth");

      // Verify worktree directory is removed
      const dirResult = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
      expect(dirResult.exitCode).not.toBe(0);

      // Verify branch is deleted
      const branchResult = await Bun.$`git branch --list feat-auth`.cwd(repoPath).text();
      expect(branchResult.trim()).toBe("");
    });

    test("throws DirtyWorktreeError when worktree has uncommitted changes", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");

      // Make uncommitted change
      await Bun.$`echo "uncommitted" > dirty.txt`.cwd(worktree.path).quiet();

      await expect(manager.removeWorktree("feat-auth")).rejects.toThrow(DirtyWorktreeError);

      // Verify worktree still exists
      const dirResult = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
      expect(dirResult.exitCode).toBe(0);
    });

    test("throws WorktreeNotFoundError when worktree does not exist", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      await expect(manager.removeWorktree("nonexistent")).rejects.toThrow(WorktreeNotFoundError);
    });

    test("does not delete PR branch when removing worktree", async () => {
      const manager = new GitManager({ repoPath });
      await manager.init();

      // Create worktree, make commit, squash merge
      const worktree = await manager.createWorktree("feat-auth", "main");
      await Bun.$`echo "feature" > feature.txt`.cwd(worktree.path).quiet();
      await Bun.$`git add .`.cwd(worktree.path).quiet();
      await Bun.$`git commit -m "Add feature"`.cwd(worktree.path).quiet();

      await manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth");

      // Remove worktree
      await manager.removeWorktree("feat-auth");

      // PR branch should still exist
      const branchResult = await Bun.$`git branch --list pr/feat-auth`.cwd(repoPath).text();
      expect(branchResult.trim()).toContain("pr/feat-auth");
    });
  });
});
