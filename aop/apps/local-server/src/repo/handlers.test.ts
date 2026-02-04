import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { getRepoById, getRepoTasks, initRepo, removeRepo } from "./handlers.ts";

describe("repo/handlers", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("initRepo", () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = join(tmpdir(), `aop-test-repo-${Date.now()}`);
      mkdirSync(testRepoPath, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testRepoPath)) {
        rmSync(testRepoPath, { recursive: true });
      }
    });

    test("returns error when path is not a git repo", async () => {
      const result = await initRepo(ctx, testRepoPath);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_A_GIT_REPO");
        expect(result.error.path).toBe(testRepoPath);
      }
    });

    test("creates new repo for valid git repository", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const result = await initRepo(ctx, testRepoPath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repoId).toMatch(/^repo_/);
        expect(result.alreadyExists).toBe(false);
      }

      const repo = await ctx.repoRepository.getByPath(testRepoPath);
      expect(repo).not.toBeNull();
      expect(repo?.path).toBe(testRepoPath);
    });

    test("returns existing repo when already registered", async () => {
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;

      const firstResult = await initRepo(ctx, testRepoPath);
      expect(firstResult.success).toBe(true);

      const secondResult = await initRepo(ctx, testRepoPath);

      expect(secondResult.success).toBe(true);
      if (secondResult.success && firstResult.success) {
        expect(secondResult.repoId).toBe(firstResult.repoId);
        expect(secondResult.alreadyExists).toBe(true);
      }
    });

    test("extracts repo name from path", async () => {
      const namedPath = join(tmpdir(), `aop-test-repo-name-${Date.now()}`, "my-project");
      mkdirSync(namedPath, { recursive: true });
      const proc = Bun.spawn(["git", "init"], { cwd: namedPath });
      await proc.exited;

      await initRepo(ctx, namedPath);

      const repo = await ctx.repoRepository.getByPath(namedPath);
      expect(repo?.name).toBe("my-project");

      rmSync(join(tmpdir(), `aop-test-repo-name-${Date.now().toString().slice(0, -3)}`), {
        recursive: true,
        force: true,
      });
    });

    test("handles non-existent path", async () => {
      const nonExistentPath = join(tmpdir(), `does-not-exist-${Date.now()}`);

      const result = await initRepo(ctx, nonExistentPath);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_A_GIT_REPO");
      }
    });
  });

  describe("removeRepo", () => {
    test("returns error when repo not found", async () => {
      const result = await removeRepo(ctx, "/non/existent/path");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect((result.error as { path: string }).path).toBe("/non/existent/path");
      }
    });

    test("removes repo without tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");

      const result = await removeRepo(ctx, "/test/repo");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repoId).toBe("repo-1");
        expect(result.abortedTasks).toBe(0);
      }

      const repo = await ctx.repoRepository.getByPath("/test/repo");
      expect(repo).toBeNull();
    });

    test("returns error when repo has working tasks without force", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const result = await removeRepo(ctx, "/test/repo");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("HAS_WORKING_TASKS");
        expect((result.error as { count: number }).count).toBe(1);
      }
    });

    test("aborts working tasks when force is true", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "WORKING");

      const result = await removeRepo(ctx, "/test/repo", { force: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.abortedTasks).toBe(2);
      }
    });

    test("removes repo with non-working tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const result = await removeRepo(ctx, "/test/repo");

      expect(result.success).toBe(true);
    });
  });

  describe("getRepoById", () => {
    test("returns repo when found", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");

      const repo = await getRepoById(ctx, "repo-1");

      expect(repo).not.toBeNull();
      expect(repo?.id).toBe("repo-1");
      expect(repo?.path).toBe("/test/repo");
    });

    test("returns null when repo not found", async () => {
      const repo = await getRepoById(ctx, "non-existent");

      expect(repo).toBeNull();
    });
  });

  describe("getRepoTasks", () => {
    test("returns tasks for repo", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "READY");

      const tasks = await getRepoTasks(ctx, "repo-1");

      expect(tasks).toHaveLength(2);
    });

    test("excludes REMOVED tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "DRAFT");
      await createTestTask(db, "task-2", "repo-1", "changes/feat-2", "REMOVED");

      const tasks = await getRepoTasks(ctx, "repo-1");

      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.id).toBe("task-1");
    });

    test("returns empty array for repo with no tasks", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");

      const tasks = await getRepoTasks(ctx, "repo-1");

      expect(tasks).toEqual([]);
    });
  });
});
