import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GitManager } from "@aop/git-manager";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../../context.ts";
import type { Database } from "../../db/index.ts";
import { createTestDb, createTestRepo, createTestTask } from "../../db/test-utils.ts";
import { applyTask } from "./apply.ts";
import { cleanupTestDir, commitPendingChanges, createGitRepo } from "./test-utils.ts";

describe("tasks/handlers/apply", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let repoPath: string;

  afterAll(async () => {
    await cleanupTestDir();
  });

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    repoPath = await createGitRepo();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("applyTask", () => {
    test("returns NOT_FOUND for non-existent task", async () => {
      const result = await applyTask(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    test("returns INVALID_STATUS for non-terminal states", async () => {
      await createTestRepo(db, "repo-1", repoPath);

      for (const status of ["DRAFT", "READY", "WORKING", "REMOVED"] as const) {
        await createTestTask(db, `task-${status}`, "repo-1", `changes/${status}`, status);
        const result = await applyTask(ctx, `task-${status}`);

        expect(result.success).toBe(false);
        if (!result.success && result.error.code === "INVALID_STATUS") {
          expect(result.error.status).toBe(status);
        }
      }
    });

    test("returns REPO_NOT_FOUND when repo is deleted", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DONE");
      await db.deleteFrom("repos").where("id", "=", "repo-1").execute();

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("REPO_NOT_FOUND");
      }
    });

    test("returns WORKTREE_NOT_FOUND when worktree does not exist", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DONE");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("WORKTREE_NOT_FOUND");
      }
    });

    test("returns NO_CHANGES when worktree has no changes", async () => {
      await createTestRepo(db, "repo-1", repoPath);

      const gitManager = new GitManager({ repoPath });
      await gitManager.init();
      await gitManager.createWorktree("task-1", "main");
      await commitPendingChanges(repoPath);

      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DONE");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NO_CHANGES");
      }
    });

    test("returns success with affected files", async () => {
      await createTestRepo(db, "repo-1", repoPath);

      const gitManager = new GitManager({ repoPath });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");
      await commitPendingChanges(repoPath);

      await Bun.$`echo "new content" > test.txt`.cwd(worktreeInfo.path).quiet();
      await Bun.$`git add .`.cwd(worktreeInfo.path).quiet();
      await Bun.$`git commit -m "Add test file"`.cwd(worktreeInfo.path).quiet();

      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DONE");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.affectedFiles).toContain("test.txt");
      }
    });

    test("returns DIRTY_WORKING_DIRECTORY when main has uncommitted changes", async () => {
      await createTestRepo(db, "repo-1", repoPath);

      const gitManager = new GitManager({ repoPath });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");
      await commitPendingChanges(repoPath);

      await Bun.$`echo "worktree change" > worktree-file.txt`.cwd(worktreeInfo.path).quiet();
      await Bun.$`git add .`.cwd(worktreeInfo.path).quiet();
      await Bun.$`git commit -m "Add worktree file"`.cwd(worktreeInfo.path).quiet();

      await Bun.$`echo "dirty change" > dirty.txt`.cwd(repoPath).quiet();

      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DONE");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("DIRTY_WORKING_DIRECTORY");
      }
    });

    test("returns CONFLICT when merge has conflicts", async () => {
      await createTestRepo(db, "repo-1", repoPath);

      const gitManager = new GitManager({ repoPath });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");
      await commitPendingChanges(repoPath);

      await Bun.$`echo "worktree version" > conflict.txt`.cwd(worktreeInfo.path).quiet();
      await Bun.$`git add .`.cwd(worktreeInfo.path).quiet();
      await Bun.$`git commit -m "Add conflict file in worktree"`.cwd(worktreeInfo.path).quiet();

      await Bun.$`echo "main version" > conflict.txt`.cwd(repoPath).quiet();
      await Bun.$`git add .`.cwd(repoPath).quiet();
      await Bun.$`git commit -m "Add conflict file in main"`.cwd(repoPath).quiet();

      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DONE");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("CONFLICT");
        if (result.error.code === "CONFLICT") {
          expect(result.error.conflictingFiles.length).toBeGreaterThan(0);
        }
      }
    });

    test("allows applyTask for BLOCKED status", async () => {
      await createTestRepo(db, "repo-1", repoPath);

      const gitManager = new GitManager({ repoPath });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");
      await commitPendingChanges(repoPath);

      await Bun.$`echo "blocked task change" > blocked.txt`.cwd(worktreeInfo.path).quiet();
      await Bun.$`git add .`.cwd(worktreeInfo.path).quiet();
      await Bun.$`git commit -m "Add file from blocked task"`.cwd(worktreeInfo.path).quiet();

      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "BLOCKED");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.affectedFiles).toContain("blocked.txt");
      }
    });
  });
});
