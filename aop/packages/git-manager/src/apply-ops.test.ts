import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configureLogging } from "@aop/infra";
import {
  ApplyConflictError,
  DirtyWorkingDirectoryError,
  NoChangesError,
  WorktreeNotFoundError,
} from "./errors.ts";
import { GitManager } from "./git-manager.ts";
import { cleanupTestRepos, commitPendingChanges, createTestRepo } from "./test-utils.ts";

beforeAll(async () => {
  await configureLogging({ level: "fatal" });
});

afterAll(async () => {
  await cleanupTestRepos();
});

describe("applyWorktree", () => {
  let repoPath: string;
  let manager: GitManager;

  beforeEach(async () => {
    repoPath = await createTestRepo();
    manager = new GitManager({ repoPath });
    await manager.init();
  });

  test("applies worktree changes to main repo", async () => {
    await manager.createWorktree("feat-test", "main");
    await commitPendingChanges(repoPath);
    const worktreePath = `${repoPath}/.worktrees/feat-test`;

    await Bun.$`echo "new content" > test.txt`.cwd(worktreePath).quiet();
    await Bun.$`git add test.txt`.cwd(worktreePath).quiet();
    await Bun.$`git commit -m "Add test file"`.cwd(worktreePath).quiet();

    const result = await manager.applyWorktree("feat-test");

    expect(result.affectedFiles).toContain("test.txt");
    const status = await Bun.$`git status --porcelain`.cwd(repoPath).quiet();
    expect(status.stdout.toString()).toContain("test.txt");
  });

  test("throws WorktreeNotFoundError for non-existent worktree", async () => {
    expect(manager.applyWorktree("non-existent")).rejects.toThrow(WorktreeNotFoundError);
  });

  test("throws DirtyWorkingDirectoryError when main has uncommitted changes", async () => {
    await manager.createWorktree("feat-dirty", "main");
    const worktreePath = `${repoPath}/.worktrees/feat-dirty`;

    await Bun.$`echo "worktree change" > worktree.txt`.cwd(worktreePath).quiet();
    await Bun.$`git add worktree.txt`.cwd(worktreePath).quiet();
    await Bun.$`git commit -m "Add file"`.cwd(worktreePath).quiet();

    await Bun.$`echo "dirty" > dirty.txt`.cwd(repoPath).quiet();

    expect(manager.applyWorktree("feat-dirty")).rejects.toThrow(DirtyWorkingDirectoryError);
  });

  test("throws NoChangesError when worktree has no changes", async () => {
    await manager.createWorktree("feat-empty", "main");
    await commitPendingChanges(repoPath);

    expect(manager.applyWorktree("feat-empty")).rejects.toThrow(NoChangesError);
  });

  test("throws ApplyConflictError when changes conflict", async () => {
    await manager.createWorktree("feat-conflict", "main");
    await commitPendingChanges(repoPath);
    const worktreePath = `${repoPath}/.worktrees/feat-conflict`;

    await Bun.$`echo "worktree version" > conflict.txt`.cwd(worktreePath).quiet();
    await Bun.$`git add conflict.txt`.cwd(worktreePath).quiet();
    await Bun.$`git commit -m "Add conflict file"`.cwd(worktreePath).quiet();

    await Bun.$`echo "main version" > conflict.txt`.cwd(repoPath).quiet();
    await Bun.$`git add conflict.txt`.cwd(repoPath).quiet();
    await Bun.$`git commit -m "Add same file in main"`.cwd(repoPath).quiet();

    expect(manager.applyWorktree("feat-conflict")).rejects.toThrow(ApplyConflictError);
  });

  test("does not remove worktree after apply", async () => {
    await manager.createWorktree("feat-persist", "main");
    await commitPendingChanges(repoPath);
    const worktreePath = `${repoPath}/.worktrees/feat-persist`;

    await Bun.$`echo "content" > persist.txt`.cwd(worktreePath).quiet();
    await Bun.$`git add persist.txt`.cwd(worktreePath).quiet();
    await Bun.$`git commit -m "Add file"`.cwd(worktreePath).quiet();

    await manager.applyWorktree("feat-persist");

    const exists = await Bun.$`test -d ${worktreePath}`.quiet().nothrow();
    expect(exists.exitCode).toBe(0);
  });
});
