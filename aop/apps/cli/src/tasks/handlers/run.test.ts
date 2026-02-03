import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ClaudeCodeProvider } from "@aop/llm-provider";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../../context.ts";
import type { Database } from "../../db/index.ts";
import { createTestDb, createTestRepo, createTestTask } from "../../db/test-utils.ts";
import { runTask } from "./run.ts";
import { cleanupTestDir, createChangePath, createGitRepo, getTestBaseDir } from "./test-utils.ts";

const mockAgentRun = spyOn(ClaudeCodeProvider.prototype, "run").mockImplementation(() =>
  Promise.resolve({ exitCode: 0 }),
);

afterAll(() => {
  mock.restore();
});

describe("tasks/handlers/run", () => {
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
    mockAgentRun.mockClear();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("runTask", () => {
    test("returns PATH_NOT_FOUND when change path does not exist", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/non-existent", "READY");

      const result = await runTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("PATH_NOT_FOUND");
      }
    });

    test("returns ALREADY_WORKING for task in progress", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createChangePath(repoPath, "changes/feature-a");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");

      const result = await runTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("ALREADY_WORKING");
      }
    });

    test("returns NOT_FOUND when repo is deleted", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createChangePath(repoPath, "changes/feature-a");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "READY");
      await db.deleteFrom("repos").where("id", "=", "repo-1").execute();

      const result = await runTask(ctx, "task-1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    test("runs task with exit code 0 → DONE status", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createChangePath(repoPath, "changes/feature-a");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "READY");

      mockAgentRun.mockImplementation(() => Promise.resolve({ exitCode: 0 }));

      const result = await runTask(ctx, "task-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.exitCode).toBe(0);
        expect(result.finalStatus).toBe("DONE");
      }

      expect(mockAgentRun).toHaveBeenCalled();
      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("DONE");
      expect(task?.worktree_path).toBeDefined();
    });

    test("runs task with non-zero exit code → BLOCKED status", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      await createChangePath(repoPath, "changes/feature-b");
      await createTestTask(db, "task-2", "repo-1", "changes/feature-b", "DRAFT");

      mockAgentRun.mockImplementation(() => Promise.resolve({ exitCode: 1 }));

      const result = await runTask(ctx, "task-2");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.exitCode).toBe(1);
        expect(result.finalStatus).toBe("BLOCKED");
      }

      const task = await ctx.taskRepository.get("task-2");
      expect(task?.status).toBe("BLOCKED");
    });

    test("loads specs from specs directory", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      const changePath = await createChangePath(repoPath, "changes/feature-c");
      await Bun.$`mkdir -p ${changePath}/specs`.quiet();
      await Bun.write(`${changePath}/specs/api.md`, "# API Spec\nSome content");
      await createTestTask(db, "task-3", "repo-1", "changes/feature-c", "READY");

      mockAgentRun.mockImplementation(() => Promise.resolve({ exitCode: 0 }));

      await runTask(ctx, "task-3");

      expect(mockAgentRun).toHaveBeenCalled();
      const calls = mockAgentRun.mock.calls as unknown as Array<[{ prompt: string }]>;
      expect(calls[0]?.[0]?.prompt).toContain("api");
    });
  });

  describe("runTask from change path", () => {
    test("creates task and repo when running from change path", async () => {
      const changePath = await createChangePath(repoPath, "changes/new-feature");

      mockAgentRun.mockImplementation(() => Promise.resolve({ exitCode: 0 }));

      const result = await runTask(ctx, changePath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task).toBeDefined();
        expect(result.task.change_path).toBe("changes/new-feature");
      }

      const repos = await ctx.repoRepository.getAll();
      expect(repos.length).toBeGreaterThan(0);
    });

    test("returns NO_REPO_ROOT when path is not in a git repo", async () => {
      const nonGitPath = `${getTestBaseDir()}/non-git-${Date.now()}`;
      await Bun.$`mkdir -p ${nonGitPath}`.quiet();

      const result = await runTask(ctx, nonGitPath);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NO_REPO_ROOT");
      }
    });

    test("returns PATH_NOT_FOUND for non-existent path", async () => {
      const result = await runTask(ctx, "/non/existent/path");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("PATH_NOT_FOUND");
      }
    });

    test("reuses existing task when running from same change path", async () => {
      await createTestRepo(db, "repo-1", repoPath);
      const changePath = await createChangePath(repoPath, "changes/existing");
      await createTestTask(db, "existing-task", "repo-1", "changes/existing", "READY");

      mockAgentRun.mockImplementation(() => Promise.resolve({ exitCode: 0 }));

      const result = await runTask(ctx, changePath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.task.id).toBe("existing-task");
      }
    });
  });
});
