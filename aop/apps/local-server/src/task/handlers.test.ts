import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitManager } from "@aop/git-manager";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import {
  applyTask,
  getTaskById,
  markTaskReady,
  removeTask,
  resolveTaskByIdentifier,
} from "./handlers.ts";

describe("task/handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("getTaskById", () => {
    test("returns task when found", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const task = await getTaskById(ctx, "task-1");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns null when task not found", async () => {
      const task = await getTaskById(ctx, "non-existent");

      expect(task).toBeNull();
    });
  });

  describe("resolveTaskByIdentifier", () => {
    test("resolves task by id", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const task = await resolveTaskByIdentifier(ctx, "task-1");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns null when task not found", async () => {
      const task = await resolveTaskByIdentifier(ctx, "non-existent");

      expect(task).toBeNull();
    });
  });

  describe("markTaskReady", () => {
    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await markTaskReady(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { identifier: string }).identifier).toBe("non-existent");
      }
    });

    test("marks DRAFT task as ready", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe("READY");
        expect(result.task.ready_at).not.toBeNull();
      }
    });

    test("marks BLOCKED task as ready", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "BLOCKED");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe("READY");
      }
    });

    test("returns ALREADY_READY when task is already ready", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "READY");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("ALREADY_READY");
        expect((result.error as { taskId: string }).taskId).toBe("task-1");
      }
    });

    test("returns INVALID_STATUS for WORKING task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("WORKING");
      }
    });

    test("returns INVALID_STATUS for DONE task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("DONE");
      }
    });

    test("sets preferred_workflow when provided", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const result = await markTaskReady(ctx, "task-1", {
        workflow: "custom-flow",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.preferred_workflow).toBe("custom-flow");
      }
    });

    test("returns UPDATE_FAILED when repository update fails", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const originalUpdate = ctx.taskRepository.update;
      ctx.taskRepository.update = mock(() => Promise.resolve(null));

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("UPDATE_FAILED");
      }

      ctx.taskRepository.update = originalUpdate;
    });
  });

  describe("removeTask", () => {
    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await removeTask(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { identifier: string }).identifier).toBe("non-existent");
      }
    });

    test("removes DRAFT task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.taskId).toBe("task-1");
        expect(result.aborted).toBe(false);
      }
    });

    test("removes READY task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "READY");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(true);
    });

    test("returns ALREADY_REMOVED when task is already removed", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "REMOVED");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("ALREADY_REMOVED");
        expect((result.error as { taskId: string }).taskId).toBe("task-1");
      }
    });

    test("returns TASK_WORKING when task is working without force", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("TASK_WORKING");
        expect((result.error as { taskId: string }).taskId).toBe("task-1");
      }
    });

    test("aborts and returns success when task is working with force", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const result = await removeTask(ctx, "task-1", { force: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.taskId).toBe("task-1");
        expect(result.aborted).toBe(true);
      }
    });

    test("returns REMOVE_FAILED when repository markRemoved fails", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const originalMarkRemoved = ctx.taskRepository.markRemoved;
      ctx.taskRepository.markRemoved = mock(() => Promise.resolve(false));

      const result = await removeTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("REMOVE_FAILED");
      }

      ctx.taskRepository.markRemoved = originalMarkRemoved;
    });
  });

  describe("applyTask", () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = join(tmpdir(), `aop-test-apply-${Date.now()}`);
      mkdirSync(testRepoPath, { recursive: true });

      const initProc = Bun.spawn(["git", "init", "-b", "main"], {
        cwd: testRepoPath,
      });
      await initProc.exited;

      const configName = Bun.spawn(["git", "config", "user.name", "Test"], {
        cwd: testRepoPath,
      });
      await configName.exited;

      const configEmail = Bun.spawn(["git", "config", "user.email", "test@test.com"], {
        cwd: testRepoPath,
      });
      await configEmail.exited;

      writeFileSync(join(testRepoPath, "README.md"), "# Test");
      const addProc = Bun.spawn(["git", "add", "."], { cwd: testRepoPath });
      await addProc.exited;

      const commitProc = Bun.spawn(["git", "commit", "-m", "Initial commit"], {
        cwd: testRepoPath,
      });
      await commitProc.exited;
    });

    afterEach(() => {
      if (existsSync(testRepoPath)) {
        rmSync(testRepoPath, { recursive: true });
      }
    });

    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await applyTask(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { identifier: string }).identifier).toBe("non-existent");
      }
    });

    test("returns INVALID_STATUS for DRAFT task", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("DRAFT");
      }
    });

    test("returns INVALID_STATUS for READY task", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "READY");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("READY");
      }
    });

    test("returns INVALID_STATUS for WORKING task", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("WORKING");
      }
    });

    test("returns REPO_NOT_FOUND when repo does not exist", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      await ctx.repoRepository.remove("repo-1");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("REPO_NOT_FOUND");
        expect((result.error as { taskId: string }).taskId).toBe("task-1");
      }
    });

    test("returns WORKTREE_NOT_FOUND when worktree does not exist", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("WORKTREE_NOT_FOUND");
      }
    });

    test("returns NO_CHANGES when worktree has no changes", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const gitManager = new GitManager({ repoPath: testRepoPath });
      await gitManager.init();
      await gitManager.createWorktree("task-1", "main");

      // Commit the .gitignore changes created by worktree setup
      const addIgnore = Bun.spawn(["git", "add", ".gitignore"], {
        cwd: testRepoPath,
      });
      await addIgnore.exited;
      const commitIgnore = Bun.spawn(["git", "commit", "-m", "Add gitignore"], {
        cwd: testRepoPath,
      });
      await commitIgnore.exited;

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NO_CHANGES");
      }
    });

    test("successfully applies worktree changes", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const gitManager = new GitManager({ repoPath: testRepoPath });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

      // Commit the .gitignore changes created by worktree setup
      const addIgnore = Bun.spawn(["git", "add", ".gitignore"], {
        cwd: testRepoPath,
      });
      await addIgnore.exited;
      const commitIgnore = Bun.spawn(["git", "commit", "-m", "Add gitignore"], {
        cwd: testRepoPath,
      });
      await commitIgnore.exited;

      writeFileSync(join(worktreeInfo.path, "new-file.txt"), "New content");

      const addProc = Bun.spawn(["git", "add", "."], {
        cwd: worktreeInfo.path,
      });
      await addProc.exited;

      const commitProc = Bun.spawn(["git", "commit", "-m", "Add new file"], {
        cwd: worktreeInfo.path,
      });
      await commitProc.exited;

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.affectedFiles).toContain("new-file.txt");
      }
    });

    test("applies BLOCKED task", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "BLOCKED");

      const gitManager = new GitManager({ repoPath: testRepoPath });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

      // Commit the .gitignore changes created by worktree setup
      const addIgnore = Bun.spawn(["git", "add", ".gitignore"], {
        cwd: testRepoPath,
      });
      await addIgnore.exited;
      const commitIgnore = Bun.spawn(["git", "commit", "-m", "Add gitignore"], {
        cwd: testRepoPath,
      });
      await commitIgnore.exited;

      writeFileSync(join(worktreeInfo.path, "blocked-file.txt"), "Blocked content");

      const addProc = Bun.spawn(["git", "add", "."], {
        cwd: worktreeInfo.path,
      });
      await addProc.exited;

      const commitProc = Bun.spawn(["git", "commit", "-m", "Add blocked file"], {
        cwd: worktreeInfo.path,
      });
      await commitProc.exited;

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.affectedFiles).toContain("blocked-file.txt");
      }
    });

    test("returns DIRTY_WORKING_DIRECTORY when main repo has uncommitted changes", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const gitManager = new GitManager({ repoPath: testRepoPath });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

      // Commit the .gitignore changes created by worktree setup
      const addIgnore = Bun.spawn(["git", "add", ".gitignore"], {
        cwd: testRepoPath,
      });
      await addIgnore.exited;
      const commitIgnore = Bun.spawn(["git", "commit", "-m", "Add gitignore"], {
        cwd: testRepoPath,
      });
      await commitIgnore.exited;

      writeFileSync(join(worktreeInfo.path, "new-file.txt"), "New content");

      const addProc = Bun.spawn(["git", "add", "."], {
        cwd: worktreeInfo.path,
      });
      await addProc.exited;

      const commitProc = Bun.spawn(["git", "commit", "-m", "Add new file"], {
        cwd: worktreeInfo.path,
      });
      await commitProc.exited;

      writeFileSync(join(testRepoPath, "dirty-file.txt"), "Uncommitted");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("DIRTY_WORKING_DIRECTORY");
      }
    });

    test("returns CONFLICT when merge has conflicts", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const gitManager = new GitManager({ repoPath: testRepoPath });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

      // Commit the .gitignore changes in main before creating worktree changes
      const addIgnore = Bun.spawn(["git", "add", ".gitignore"], {
        cwd: testRepoPath,
      });
      await addIgnore.exited;
      const commitIgnore = Bun.spawn(["git", "commit", "-m", "Add gitignore"], {
        cwd: testRepoPath,
      });
      await commitIgnore.exited;

      writeFileSync(join(worktreeInfo.path, "README.md"), "# Modified in worktree");

      const addProc = Bun.spawn(["git", "add", "."], {
        cwd: worktreeInfo.path,
      });
      await addProc.exited;

      const commitProc = Bun.spawn(["git", "commit", "-m", "Modify README"], {
        cwd: worktreeInfo.path,
      });
      await commitProc.exited;

      writeFileSync(join(testRepoPath, "README.md"), "# Modified in main");
      const addMainProc = Bun.spawn(["git", "add", "."], { cwd: testRepoPath });
      await addMainProc.exited;

      const commitMainProc = Bun.spawn(["git", "commit", "-m", "Modify README in main"], {
        cwd: testRepoPath,
      });
      await commitMainProc.exited;

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("CONFLICT");
        expect((result.error as { conflictingFiles: string[] }).conflictingFiles).toContain(
          "README.md",
        );
      }
    });
  });
});
