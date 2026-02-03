import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/index.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";

const mockAbortTask = mock(() => Promise.resolve({ taskId: "", agentKilled: false }));

mock.module("../executor/index.ts", () => ({
  abortTask: mockAbortTask,
}));

const { initRepo, removeRepo } = await import("./handlers.ts");

describe("repos/handlers", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    mockAbortTask.mockClear();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("initRepo", () => {
    test("returns error for non-git directory", async () => {
      const result = await initRepo(ctx, "/tmp/not-a-git-repo");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_A_GIT_REPO");
        expect(result.error.path).toBe("/tmp/not-a-git-repo");
      }
    });

    test("returns alreadyExists=true for registered repo", async () => {
      await createTestRepo(db, "repo-1", process.cwd());

      const result = await initRepo(ctx, process.cwd());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyExists).toBe(true);
        expect(result.repoId).toBe("repo-1");
      }
    });

    test("registers new git repository", async () => {
      const result = await initRepo(ctx, process.cwd());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyExists).toBe(false);
        expect(result.repoId).toMatch(/^repo_/);
      }

      const repo = await ctx.repoRepository.getByPath(process.cwd());
      expect(repo).toBeDefined();
      expect(repo?.name).toBe("aop");
    });
  });

  describe("removeRepo", () => {
    test("returns error for unregistered repo", async () => {
      const result = await removeRepo(ctx, "/home/user/not-registered");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        if (result.error.code === "NOT_FOUND") {
          expect(result.error.path).toBe("/home/user/not-registered");
        }
      }
    });

    test("removes repo without tasks", async () => {
      await createTestRepo(db, "repo-1", "/home/user/project");

      const result = await removeRepo(ctx, "/home/user/project");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repoId).toBe("repo-1");
        expect(result.abortedTasks).toBe(0);
      }

      const repo = await ctx.repoRepository.getById("repo-1");
      expect(repo).toBeNull();
    });

    test("removes repo with non-working tasks", async () => {
      await createTestRepo(db, "repo-1", "/home/user/project");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DONE");
      await createTestTask(db, "task-2", "repo-1", "changes/feature-b", "BLOCKED");

      const result = await removeRepo(ctx, "/home/user/project");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.abortedTasks).toBe(0);
      }
    });

    test("returns error for repo with working tasks without force", async () => {
      await createTestRepo(db, "repo-1", "/home/user/project");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feature-b", "WORKING");

      const result = await removeRepo(ctx, "/home/user/project");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("HAS_WORKING_TASKS");
        if (result.error.code === "HAS_WORKING_TASKS") {
          expect(result.error.count).toBe(2);
        }
      }
    });

    test("force removes repo with working tasks and aborts them", async () => {
      await createTestRepo(db, "repo-1", "/home/user/project");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feature-b", "WORKING");

      const result = await removeRepo(ctx, "/home/user/project", { force: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repoId).toBe("repo-1");
        expect(result.abortedTasks).toBe(2);
      }
      expect(mockAbortTask).toHaveBeenCalledTimes(2);
    });

    test("continues aborting tasks when one fails", async () => {
      await createTestRepo(db, "repo-1", "/home/user/project");
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feature-b", "WORKING");
      await createTestTask(db, "task-3", "repo-1", "changes/feature-c", "WORKING");

      let callCount = 0;
      mockAbortTask.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error("Abort failed"));
        }
        return Promise.resolve({ taskId: "", agentKilled: false });
      });

      const result = await removeRepo(ctx, "/home/user/project", { force: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.abortedTasks).toBe(2); // 2 succeeded, 1 failed
      }
      expect(mockAbortTask).toHaveBeenCalledTimes(3);
    });

    test("returns error when repo removal fails", async () => {
      await createTestRepo(db, "repo-1", "/home/user/project");

      const removeSpy = spyOn(ctx.repoRepository, "remove").mockResolvedValue(false);

      const result = await removeRepo(ctx, "/home/user/project");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("REMOVE_FAILED");
      }

      removeSpy.mockRestore();
    });
  });
});
