import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { aopPaths, useTestAopHome } from "@aop/infra";
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

const TEST_REPO_ID = "repo_test123";

describe("GitManager", () => {
  let repoPath: string;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    repoPath = await createTestRepo();
  });

  afterEach(async () => {
    await cleanupTestRepos();
    cleanupAopHome();
  });

  describe("init", () => {
    test("initializes successfully for valid git repository", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await expect(manager.init()).resolves.toBeUndefined();
    });

    test("throws NotAGitRepositoryError for non-git directory", async () => {
      const nonGitPath = `${TEST_BASE_DIR}/not-a-repo`;
      await Bun.$`mkdir -p ${nonGitPath}`.quiet();
      const manager = new GitManager({ repoPath: nonGitPath, repoId: TEST_REPO_ID });
      await expect(manager.init()).rejects.toThrow(NotAGitRepositoryError);
    });
  });

  describe("createWorktree", () => {
    test("creates worktree at global path", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const result = await manager.createWorktree("feat-auth", "main");

      expect(result.path).toBe(aopPaths.worktree(TEST_REPO_ID, "feat-auth"));
      expect(result.branch).toBe("feat-auth");
      expect(result.baseCommit).toMatch(/^[a-f0-9]{40}$/);

      const dirExists = await Bun.file(`${result.path}/README.md`).exists();
      expect(dirExists).toBe(true);
    });

    test("auto-initializes worktrees directory if missing", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");

      const worktreesDir = aopPaths.worktrees(TEST_REPO_ID);
      const result = await Bun.$`test -d ${worktreesDir}`.quiet().nothrow();
      expect(result.exitCode).toBe(0);
    });

    test("does not create .gitignore in repo", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");

      const gitignoreExists = await Bun.file(`${repoPath}/.gitignore`).exists();
      expect(gitignoreExists).toBe(false);
    });

    test("throws WorktreeExistsError if worktree already exists", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");
      await expect(manager.createWorktree("feat-auth", "main")).rejects.toThrow(
        WorktreeExistsError,
      );
    });

    test("throws BranchNotFoundError if base branch does not exist", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await expect(manager.createWorktree("feat-auth", "nonexistent")).rejects.toThrow(
        BranchNotFoundError,
      );
    });

    test("rejects invalid taskId with path traversal", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await expect(manager.createWorktree("../../../etc", "main")).rejects.toThrow(
        "Invalid taskId",
      );
      await expect(manager.createWorktree("foo/../bar", "main")).rejects.toThrow("Invalid taskId");
    });

    test("rejects empty taskId", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await expect(manager.createWorktree("", "main")).rejects.toThrow("cannot be empty");
    });

    test("uses the provided branch name instead of the task id", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const result = await manager.createWorktree("task_auth_001", "main", "feat-auth");

      expect(result.path).toBe(aopPaths.worktree(TEST_REPO_ID, "task_auth_001"));
      expect(result.branch).toBe("feat-auth");

      const branchResult = await Bun.$`git branch --list feat-auth`.cwd(repoPath).text();
      expect(branchResult.trim()).toContain("feat-auth");
    });
  });

  describe("squashMerge", () => {
    test("squash merges work branch into new PR branch", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");
      await Bun.$`echo "new content" > feature.txt`.cwd(worktree.path).quiet();
      await Bun.$`git add .`.cwd(worktree.path).quiet();
      await Bun.$`git commit -m "Add feature"`.cwd(worktree.path).quiet();

      const result = await manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth");

      expect(result.targetBranch).toBe("pr/feat-auth");
      expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);

      const log = await Bun.$`git log --oneline pr/feat-auth`.cwd(repoPath).text();
      expect(log).toContain("feat: add auth");
    });

    test("throws NoCommitsError when no commits beyond base", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await manager.createWorktree("feat-auth", "main");

      await expect(
        manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth"),
      ).rejects.toThrow(NoCommitsError);
    });

    test("throws BranchExistsError when target branch already exists", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");
      await Bun.$`echo "content" > feature.txt`.cwd(worktree.path).quiet();
      await Bun.$`git add .`.cwd(worktree.path).quiet();
      await Bun.$`git commit -m "Add feature"`.cwd(worktree.path).quiet();

      await Bun.$`git branch pr/feat-auth`.cwd(repoPath).quiet();

      await expect(
        manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth"),
      ).rejects.toThrow(BranchExistsError);
    });

    test("throws GitConflictError on merge conflict", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");
      await Bun.$`echo "worktree change" > README.md`.cwd(worktree.path).quiet();
      await Bun.$`git add .`.cwd(worktree.path).quiet();
      await Bun.$`git commit -m "Modify README in worktree"`.cwd(worktree.path).quiet();

      await Bun.$`echo "main change" > README.md`.cwd(repoPath).quiet();
      await Bun.$`git add .`.cwd(repoPath).quiet();
      await Bun.$`git commit -m "Modify README on main"`.cwd(repoPath).quiet();

      await expect(
        manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth"),
      ).rejects.toThrow(GitConflictError);

      const status = await Bun.$`git status --porcelain`.cwd(repoPath).text();
      expect(status.trim()).toBe("");
    });
  });

  describe("forceRemoveWorktree", () => {
    test("force-removes worktree with uncommitted changes", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-dirty", "main");
      await Bun.$`echo "uncommitted" > dirty.txt`.cwd(worktree.path).quiet();

      await manager.forceRemoveWorktree("feat-dirty");

      const dirResult = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
      expect(dirResult.exitCode).not.toBe(0);
    });

    test("silently skips if worktree does not exist", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await expect(manager.forceRemoveWorktree("nonexistent")).resolves.toBeUndefined();
    });

    test("removes clean worktree", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-clean", "main");
      await manager.forceRemoveWorktree("feat-clean");

      const dirResult = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
      expect(dirResult.exitCode).not.toBe(0);
    });
  });

  describe("removeWorktree", () => {
    test("removes clean worktree and its branch", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");

      expect(
        await Bun.$`test -d ${worktree.path}`
          .quiet()
          .nothrow()
          .then((r) => r.exitCode),
      ).toBe(0);

      await manager.removeWorktree("feat-auth");

      const dirResult = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
      expect(dirResult.exitCode).not.toBe(0);

      const branchResult = await Bun.$`git branch --list feat-auth`.cwd(repoPath).text();
      expect(branchResult.trim()).toBe("");
    });

    test("throws DirtyWorktreeError when worktree has uncommitted changes", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");

      await Bun.$`echo "uncommitted" > dirty.txt`.cwd(worktree.path).quiet();

      await expect(manager.removeWorktree("feat-auth")).rejects.toThrow(DirtyWorktreeError);

      const dirResult = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
      expect(dirResult.exitCode).toBe(0);
    });

    test("throws WorktreeNotFoundError when worktree does not exist", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      await expect(manager.removeWorktree("nonexistent")).rejects.toThrow(WorktreeNotFoundError);
    });

    test("does not delete PR branch when removing worktree", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("feat-auth", "main");
      await Bun.$`echo "feature" > feature.txt`.cwd(worktree.path).quiet();
      await Bun.$`git add .`.cwd(worktree.path).quiet();
      await Bun.$`git commit -m "Add feature"`.cwd(worktree.path).quiet();

      await manager.squashMerge("feat-auth", "pr/feat-auth", "feat: add auth");

      await manager.removeWorktree("feat-auth");

      const branchResult = await Bun.$`git branch --list pr/feat-auth`.cwd(repoPath).text();
      expect(branchResult.trim()).toContain("pr/feat-auth");
    });
  });

  describe("handoffWorktree", () => {
    test("preserves the branch and removes the worktree", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("task_auth_002", "main", "feat-auth");
      const result = await manager.handoffWorktree("task_auth_002", "Complete feat-auth");

      expect(result.branch).toBe("feat-auth");

      const dirResult = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
      expect(dirResult.exitCode).not.toBe(0);

      const branchResult = await Bun.$`git branch --list feat-auth`.cwd(repoPath).text();
      expect(branchResult.trim()).toContain("feat-auth");
    });

    test("commits pending worktree changes before preserving the branch", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree = await manager.createWorktree("task_auth_003", "main", "feat-auth");
      await Bun.$`echo "feature" > feature.txt`.cwd(worktree.path).quiet();

      const result = await manager.handoffWorktree("task_auth_003", "Complete feat-auth");

      expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);

      const show = await Bun.$`git show --stat --oneline feat-auth`.cwd(repoPath).text();
      expect(show).toContain("Complete feat-auth");
      expect(show).toContain("feature.txt");

      const currentBranch = await Bun.$`git branch --show-current`.cwd(repoPath).text();
      expect(currentBranch.trim()).toBe("feat-auth");

      const featureFile = await Bun.file(`${repoPath}/feature.txt`).text();
      expect(featureFile.trim()).toBe("feature");
    });

    test("keeps sibling worktrees valid after handing off one worktree", async () => {
      const manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
      await manager.init();

      const worktree1 = await manager.createWorktree("task_auth_004", "main", "feat-auth-1");
      const worktree2 = await manager.createWorktree("task_auth_005", "main", "feat-auth-2");

      await Bun.$`echo "feature one" > feature-one.txt`.cwd(worktree1.path).quiet();
      await Bun.$`echo "feature two" > feature-two.txt`.cwd(worktree2.path).quiet();

      await manager.handoffWorktree("task_auth_004", "Complete feat-auth-1");

      expect(await Bun.file(`${repoPath}/.git/HEAD`).exists()).toBe(true);
      expect(await Bun.file(`${repoPath}/README.md`).exists()).toBe(true);

      const siblingStatus = await Bun.$`git status --short`
        .cwd(worktree2.path)
        .quiet()
        .nothrow();

      expect(siblingStatus.exitCode).toBe(0);
      expect(siblingStatus.stdout.toString()).toContain("feature-two.txt");
    });
  });
});
