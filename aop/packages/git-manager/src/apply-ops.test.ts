import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { aopPaths, configureLogging } from "@aop/infra";
import { DirtyWorkingDirectoryError, NoChangesError, WorktreeNotFoundError } from "./errors.ts";
import { GitManager } from "./git-manager.ts";
import { cleanupTestRepos, commitPendingChanges, createTestRepo } from "./test-utils.ts";

const TEST_REPO_ID = "repo_applytest";

beforeAll(async () => {
  await configureLogging({ level: "fatal" });
});

afterAll(async () => {
  await cleanupTestRepos();
  await rm(aopPaths.repoDir(TEST_REPO_ID), { recursive: true, force: true });
});

describe("applyWorktree", () => {
  let repoPath: string;
  let manager: GitManager;

  beforeEach(async () => {
    repoPath = await createTestRepo();
    manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
    await manager.init();
  });

  test("applies worktree changes to main repo", async () => {
    const worktree = await manager.createWorktree("feat-test", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "new content" > test.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add test.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add test file"`.cwd(worktree.path).quiet();

    const result = await manager.applyWorktree("feat-test");

    expect(result.affectedFiles).toContain("test.txt");
    expect(result.conflictingFiles).toEqual([]);
    const status = await Bun.$`git status --porcelain`.cwd(repoPath).quiet();
    expect(status.stdout.toString()).toContain("test.txt");
  });

  test("throws WorktreeNotFoundError for non-existent worktree", async () => {
    expect(manager.applyWorktree("non-existent")).rejects.toThrow(WorktreeNotFoundError);
  });

  test("throws DirtyWorkingDirectoryError when main has uncommitted changes", async () => {
    const worktree = await manager.createWorktree("feat-dirty", "main");

    await Bun.$`echo "worktree change" > worktree.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add worktree.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add file"`.cwd(worktree.path).quiet();

    await Bun.$`echo "dirty" > dirty.txt`.cwd(repoPath).quiet();

    expect(manager.applyWorktree("feat-dirty")).rejects.toThrow(DirtyWorkingDirectoryError);
  });

  test("throws NoChangesError when worktree has no changes", async () => {
    await manager.createWorktree("feat-empty", "main");
    await commitPendingChanges(repoPath);

    expect(manager.applyWorktree("feat-empty")).rejects.toThrow(NoChangesError);
  });

  test("applies with conflicts and returns conflicting files", async () => {
    const worktree = await manager.createWorktree("feat-conflict", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "worktree version" > conflict.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add conflict.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add conflict file"`.cwd(worktree.path).quiet();

    await Bun.$`echo "main version" > conflict.txt`.cwd(repoPath).quiet();
    await Bun.$`git add conflict.txt`.cwd(repoPath).quiet();
    await Bun.$`git commit -m "Add same file in main"`.cwd(repoPath).quiet();

    const result = await manager.applyWorktree("feat-conflict");

    expect(result.affectedFiles).toContain("conflict.txt");
    expect(result.conflictingFiles).toContain("conflict.txt");
  });

  test("does not remove worktree after apply", async () => {
    const worktree = await manager.createWorktree("feat-persist", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "content" > persist.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add persist.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add file"`.cwd(worktree.path).quiet();

    await manager.applyWorktree("feat-persist");

    const exists = await Bun.$`test -d ${worktree.path}`.quiet().nothrow();
    expect(exists.exitCode).toBe(0);
  });
});

describe("applyWorktree with targetBranch", () => {
  let repoPath: string;
  let manager: GitManager;

  beforeEach(async () => {
    repoPath = await createTestRepo();
    manager = new GitManager({ repoPath, repoId: TEST_REPO_ID });
    await manager.init();
  });

  test("applies to target branch checked out in main repo", async () => {
    await Bun.$`git checkout -b develop`.cwd(repoPath).quiet();
    await Bun.$`git checkout main`.cwd(repoPath).quiet();

    const worktree = await manager.createWorktree("feat-target", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "new feature" > feature.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add feature.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add feature"`.cwd(worktree.path).quiet();

    await Bun.$`git checkout develop`.cwd(repoPath).quiet();

    const result = await manager.applyWorktree("feat-target", "develop");

    expect(result.affectedFiles).toContain("feature.txt");
    const status = await Bun.$`git status --porcelain`.cwd(repoPath).quiet();
    expect(status.stdout.toString()).toContain("feature.txt");
  });

  test("applies to target branch checked out in another worktree", async () => {
    await Bun.$`git checkout -b develop`.cwd(repoPath).quiet();
    await Bun.$`git checkout main`.cwd(repoPath).quiet();

    const developWtPath = `${repoPath}/.worktrees/develop-wt`;
    await Bun.$`git worktree add ${developWtPath} develop`.cwd(repoPath).quiet();

    const worktree = await manager.createWorktree("feat-cross", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "cross content" > cross.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add cross.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add cross file"`.cwd(worktree.path).quiet();

    const result = await manager.applyWorktree("feat-cross", "develop");

    expect(result.affectedFiles).toContain("cross.txt");
    const developStatus = await Bun.$`git status --porcelain`.cwd(developWtPath).quiet();
    expect(developStatus.stdout.toString()).toContain("cross.txt");
  });

  test("auto-checks out target branch when not checked out anywhere", async () => {
    await Bun.$`git checkout -b develop`.cwd(repoPath).quiet();
    await Bun.$`git checkout main`.cwd(repoPath).quiet();

    const worktree = await manager.createWorktree("feat-auto", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "auto content" > auto.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add auto.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add auto file"`.cwd(worktree.path).quiet();

    const result = await manager.applyWorktree("feat-auto", "develop");

    expect(result.affectedFiles).toContain("auto.txt");
    const branch = await Bun.$`git branch --show-current`.cwd(repoPath).quiet();
    expect(branch.stdout.toString().trim()).toBe("develop");
  });

  test("creates new branch and applies when target branch doesn't exist", async () => {
    const worktree = await manager.createWorktree("feat-noexist", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "content" > file.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add file.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add file"`.cwd(worktree.path).quiet();

    const result = await manager.applyWorktree("feat-noexist", "brand-new-branch");

    expect(result.affectedFiles).toContain("file.txt");
    const branch = await Bun.$`git branch --show-current`.cwd(repoPath).quiet();
    expect(branch.stdout.toString().trim()).toBe("brand-new-branch");
    const status = await Bun.$`git status --porcelain`.cwd(repoPath).quiet();
    expect(status.stdout.toString()).toContain("file.txt");
  });

  test("throws DirtyWorkingDirectoryError when creating new branch but main is dirty", async () => {
    const worktree = await manager.createWorktree("feat-dirty-new", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "content" > file.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add file.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add file"`.cwd(worktree.path).quiet();

    await Bun.$`echo "dirty" > dirty.txt`.cwd(repoPath).quiet();

    expect(manager.applyWorktree("feat-dirty-new", "brand-new-branch")).rejects.toThrow(
      DirtyWorkingDirectoryError,
    );
  });

  test("throws DirtyWorkingDirectoryError when checkout needed but dirty", async () => {
    await Bun.$`git checkout -b develop`.cwd(repoPath).quiet();
    await Bun.$`git checkout main`.cwd(repoPath).quiet();

    const worktree = await manager.createWorktree("feat-dirty-target", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "content" > file.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add file.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add file"`.cwd(worktree.path).quiet();

    await Bun.$`echo "dirty" > dirty.txt`.cwd(repoPath).quiet();

    expect(manager.applyWorktree("feat-dirty-target", "develop")).rejects.toThrow(
      DirtyWorkingDirectoryError,
    );
  });

  test("throws NoChangesError when diff is empty", async () => {
    await Bun.$`git checkout -b develop`.cwd(repoPath).quiet();
    await Bun.$`git checkout main`.cwd(repoPath).quiet();

    await manager.createWorktree("feat-nochange", "main");
    await commitPendingChanges(repoPath);

    expect(manager.applyWorktree("feat-nochange", "develop")).rejects.toThrow(NoChangesError);
  });

  test("applies with conflicts to target branch and returns conflicting files", async () => {
    await Bun.$`git checkout -b develop`.cwd(repoPath).quiet();
    await Bun.$`echo "develop version" > conflict.txt`.cwd(repoPath).quiet();
    await Bun.$`git add conflict.txt`.cwd(repoPath).quiet();
    await Bun.$`git commit -m "Add conflict file on develop"`.cwd(repoPath).quiet();
    await Bun.$`git checkout main`.cwd(repoPath).quiet();

    const worktree = await manager.createWorktree("feat-conflict-target", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "worktree version" > conflict.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add conflict.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add conflict file in worktree"`.cwd(worktree.path).quiet();

    await Bun.$`git checkout develop`.cwd(repoPath).quiet();

    const result = await manager.applyWorktree("feat-conflict-target", "develop");

    expect(result.affectedFiles).toContain("conflict.txt");
    expect(result.conflictingFiles).toContain("conflict.txt");
  });
});
