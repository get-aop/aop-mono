import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { resolveTask, resolveTaskByChangePath } from "./resolve.ts";

describe("task/resolve", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("resolveTask", () => {
    test("resolves task by ID", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const task = await resolveTask(ctx.taskRepository, ctx.repoRepository, "task-1");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns null when task not found", async () => {
      const task = await resolveTask(ctx.taskRepository, ctx.repoRepository, "non-existent");

      expect(task).toBeNull();
    });
  });

  describe("resolveTaskByChangePath", () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = join(tmpdir(), `aop-test-repo-resolve-${Date.now()}`);
      mkdirSync(join(testRepoPath, "changes/feat-1"), { recursive: true });
      const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
      await proc.exited;
    });

    afterEach(() => {
      if (existsSync(testRepoPath)) {
        rmSync(testRepoPath, { recursive: true });
      }
    });

    test("resolves task by absolute change path", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const absolutePath = join(testRepoPath, "changes/feat-1");
      const task = await resolveTaskByChangePath(
        ctx.taskRepository,
        ctx.repoRepository,
        absolutePath,
      );

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns null when path does not exist", async () => {
      const task = await resolveTaskByChangePath(
        ctx.taskRepository,
        ctx.repoRepository,
        "/non/existent/path",
      );

      expect(task).toBeNull();
    });

    test("returns null when path is not in a git repo", async () => {
      const nonGitPath = join(tmpdir(), `aop-test-non-git-${Date.now()}`);
      mkdirSync(nonGitPath, { recursive: true });

      const task = await resolveTaskByChangePath(
        ctx.taskRepository,
        ctx.repoRepository,
        nonGitPath,
      );

      expect(task).toBeNull();

      rmSync(nonGitPath, { recursive: true });
    });

    test("returns null when repo is not registered", async () => {
      const absolutePath = join(testRepoPath, "changes/feat-1");
      const task = await resolveTaskByChangePath(
        ctx.taskRepository,
        ctx.repoRepository,
        absolutePath,
      );

      expect(task).toBeNull();
    });

    test("returns null when task does not exist for change path", async () => {
      await createTestRepo(db, "repo-1", testRepoPath);

      const absolutePath = join(testRepoPath, "changes/feat-1");
      const task = await resolveTaskByChangePath(
        ctx.taskRepository,
        ctx.repoRepository,
        absolutePath,
      );

      expect(task).toBeNull();
    });
  });
});
