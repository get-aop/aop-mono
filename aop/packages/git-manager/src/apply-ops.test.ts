import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { aopPaths, configureLogging } from "@aop/infra";
import {
  ApplyConflictError,
  DirtyWorkingDirectoryError,
  NoChangesError,
  WorktreeNotFoundError,
} from "./errors.ts";
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

  test("throws ApplyConflictError when changes conflict", async () => {
    const worktree = await manager.createWorktree("feat-conflict", "main");
    await commitPendingChanges(repoPath);

    await Bun.$`echo "worktree version" > conflict.txt`.cwd(worktree.path).quiet();
    await Bun.$`git add conflict.txt`.cwd(worktree.path).quiet();
    await Bun.$`git commit -m "Add conflict file"`.cwd(worktree.path).quiet();

    await Bun.$`echo "main version" > conflict.txt`.cwd(repoPath).quiet();
    await Bun.$`git add conflict.txt`.cwd(repoPath).quiet();
    await Bun.$`git commit -m "Add same file in main"`.cwd(repoPath).quiet();

    expect(manager.applyWorktree("feat-conflict")).rejects.toThrow(ApplyConflictError);
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
