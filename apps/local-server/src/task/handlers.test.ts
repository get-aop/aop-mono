import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitManager } from "@aop/git-manager";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import {
  applyTask,
  blockTask,
  getTaskById,
  markTaskReady,
  removeTask,
  resolveTaskByIdentifier,
  resumeTask,
} from "./handlers.ts";

const TEST_REPO_ID = "repo-1";

describe("task/handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
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
    const changePath = "changes/feat";

    const createPromptFile = () => {
      const dir = join(aopPaths.repoDir(TEST_REPO_ID), changePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tasks.md"), "# Tasks\n- [ ] Task 1");
    };

    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await markTaskReady(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { identifier: string }).identifier).toBe("non-existent");
      }
    });

    test("marks task as ready when task.md exists", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe("READY");
      }
    });

    test("marks DRAFT task as ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      createPromptFile();

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe("READY");
        expect(result.task.ready_at).not.toBeNull();
      }
    });

    test("marks BLOCKED task as ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "BLOCKED");
      createPromptFile();

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.status).toBe("READY");
      }
    });

    test("returns ALREADY_READY when task is already ready", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "READY");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("ALREADY_READY");
        expect((result.error as { taskId: string }).taskId).toBe("task-1");
      }
    });

    test("returns INVALID_STATUS for WORKING task", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "WORKING");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("WORKING");
      }
    });

    test("returns INVALID_STATUS for DONE task", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DONE");

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("DONE");
      }
    });

    test("sets preferred_workflow when provided", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      createPromptFile();

      const result = await markTaskReady(ctx, "task-1", {
        workflow: "custom-flow",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.preferred_workflow).toBe("custom-flow");
      }
    });

    test("sets base_branch when provided", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      createPromptFile();

      const result = await markTaskReady(ctx, "task-1", {
        baseBranch: "feature/foo",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.base_branch).toBe("feature/foo");
      }
    });

    test("sets base_branch to null when not provided", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      createPromptFile();

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.base_branch).toBeNull();
      }
    });

    test("returns UPDATE_FAILED when repository update fails", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "DRAFT");
      createPromptFile();

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

  describe("markTaskReady with retryFromStep", () => {
    const changePath = "changes/feat-retry";

    const createPromptFile = () => {
      const dir = join(aopPaths.repoDir(TEST_REPO_ID), changePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tasks.md"), "# Tasks");
    };

    test("stores retryFromStep on the task", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "BLOCKED");
      createPromptFile();

      const result = await markTaskReady(ctx, "task-1", { retryFromStep: "full-review" });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.retry_from_step).toBe("full-review");
      }
    });

    test("clears retryFromStep when not provided", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, changePath, "BLOCKED");
      createPromptFile();

      const result = await markTaskReady(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.retry_from_step).toBeNull();
      }
    });
  });

  describe("resumeTask", () => {
    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await resumeTask(ctx, "non-existent", "some input");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    test("returns NOT_PAUSED when task is not in PAUSED status", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, "changes/feat", "WORKING");

      const result = await resumeTask(ctx, "task-1", "some input");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_PAUSED");
      }
    });

    test("enqueues task with RESUMING status and stores resume_input", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, "changes/feat", "PAUSED");

      // Create execution + step so getLatestStepExecution works
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        step_type: "iterate",
        status: "running",
        started_at: new Date().toISOString(),
      });

      const result = await resumeTask(ctx, "task-1", "Approved, proceed");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.taskId).toBe("task-1");
      }

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("RESUMING");
      expect(task?.resume_input).toBe("Approved, proceed");
    });

    test("returns NO_STEP_EXECUTION when no step execution exists", async () => {
      await createTestRepo(db, TEST_REPO_ID, "/test/repo");
      await createTestTask(db, "task-1", TEST_REPO_ID, "changes/feat", "PAUSED");

      const result = await resumeTask(ctx, "task-1", "some input");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NO_STEP_EXECUTION");
      }
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

  describe("blockTask", () => {
    test("returns NOT_FOUND when task does not exist", async () => {
      const result = await blockTask(ctx, "non-existent");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { identifier: string }).identifier).toBe("non-existent");
      }
    });

    test("blocks WORKING task and sets status to BLOCKED", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");

      const result = await blockTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.taskId).toBe("task-1");
        expect(result.agentKilled).toBe(false);
      }

      const task = await getTaskById(ctx, "task-1");
      expect(task?.status).toBe("BLOCKED");
    });

    test("returns INVALID_STATUS for DRAFT task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DRAFT");

      const result = await blockTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("DRAFT");
      }
    });

    test("returns INVALID_STATUS for DONE task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");

      const result = await blockTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("DONE");
      }
    });

    test("returns INVALID_STATUS for BLOCKED task", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "BLOCKED");

      const result = await blockTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_STATUS");
        expect((result.error as { status: string }).status).toBe("BLOCKED");
      }
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

    const commitRepoState = async (message: string): Promise<void> => {
      const addProc = Bun.spawn(["git", "add", "."], { cwd: testRepoPath });
      await addProc.exited;

      const commitProc = Bun.spawn(["git", "commit", "-m", message], {
        cwd: testRepoPath,
      });
      await commitProc.exited;
    };

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

    test("returns NOT_FOUND when repo is removed before apply", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");
      await commitRepoState("Add task docs");

      await ctx.repoRepository.remove("repo-1");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { identifier: string }).identifier).toBe("task-1");
      }
    });

    test("returns WORKTREE_NOT_FOUND when worktree does not exist", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");
      await commitRepoState("Add task docs");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("WORKTREE_NOT_FOUND");
      }
    });

    test("returns NO_CHANGES when worktree has no changes", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");
      await commitRepoState("Add task docs");

      const gitManager = new GitManager({ repoPath: testRepoPath, repoId: TEST_REPO_ID });
      await gitManager.init();
      await gitManager.createWorktree("task-1", "main");

      const result = await applyTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NO_CHANGES");
      }
    });

    test("successfully applies worktree changes", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");
      await commitRepoState("Add task docs");

      const gitManager = new GitManager({ repoPath: testRepoPath, repoId: TEST_REPO_ID });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

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
      await commitRepoState("Add task docs");

      const gitManager = new GitManager({ repoPath: testRepoPath, repoId: TEST_REPO_ID });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

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
      await commitRepoState("Add task docs");

      const gitManager = new GitManager({ repoPath: testRepoPath, repoId: TEST_REPO_ID });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

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

    test("applies with conflicts and returns conflicting files", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat", "DONE");
      await commitRepoState("Add task docs");

      const gitManager = new GitManager({ repoPath: testRepoPath, repoId: TEST_REPO_ID });
      await gitManager.init();
      const worktreeInfo = await gitManager.createWorktree("task-1", "main");

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

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.affectedFiles).toContain("README.md");
        expect(result.conflictingFiles).toContain("README.md");
      }
    });
  });
});
