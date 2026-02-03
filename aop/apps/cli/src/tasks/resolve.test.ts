import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/index.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { resolveTask, resolveTaskByChangePath } from "./resolve.ts";

const TEST_BASE_DIR = "/tmp/resolve-test";

const createGitRepo = async (): Promise<string> => {
  const repoPath = `${TEST_BASE_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await Bun.$`mkdir -p ${repoPath}`.quiet();
  await Bun.$`git init -b main`.cwd(repoPath).quiet();
  await Bun.$`git config user.email "test@test.com"`.cwd(repoPath).quiet();
  await Bun.$`git config user.name "Test"`.cwd(repoPath).quiet();
  await Bun.$`touch README.md`.cwd(repoPath).quiet();
  await Bun.$`git add .`.cwd(repoPath).quiet();
  await Bun.$`git commit -m "Initial commit"`.cwd(repoPath).quiet();
  return repoPath;
};

describe("tasks/resolve", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;
  let gitRepoPath: string;

  beforeAll(async () => {
    await Bun.$`mkdir -p ${TEST_BASE_DIR}`.quiet();
  });

  afterAll(async () => {
    await rm(TEST_BASE_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    gitRepoPath = await createGitRepo();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("resolveTask", () => {
    test("returns task when found by ID", async () => {
      await createTestRepo(db, "repo-1", gitRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DRAFT");

      const task = await resolveTask(ctx.taskRepository, ctx.repoRepository, "task-1");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test("returns null when task ID not found", async () => {
      const task = await resolveTask(ctx.taskRepository, ctx.repoRepository, "non-existent");

      expect(task).toBeNull();
    });

    test("returns task when found by change path", async () => {
      await createTestRepo(db, "repo-1", gitRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DRAFT");

      const changePath = `${gitRepoPath}/changes/feature-a`;
      await Bun.$`mkdir -p ${changePath}`.quiet();

      const task = await resolveTask(ctx.taskRepository, ctx.repoRepository, changePath);

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });
  });

  describe("resolveTaskByChangePath", () => {
    test("returns null when path does not exist", async () => {
      const task = await resolveTaskByChangePath(
        ctx.taskRepository,
        ctx.repoRepository,
        "/non/existent/path",
      );

      expect(task).toBeNull();
    });

    test("returns null when path exists but not in a git repo", async () => {
      const nonGitDir = `${TEST_BASE_DIR}/non-git-${Date.now()}`;
      await Bun.$`mkdir -p ${nonGitDir}`.quiet();

      const task = await resolveTaskByChangePath(ctx.taskRepository, ctx.repoRepository, nonGitDir);

      expect(task).toBeNull();
    });

    test("returns null when git repo not registered in database", async () => {
      const changePath = `${gitRepoPath}/changes/feature-a`;
      await Bun.$`mkdir -p ${changePath}`.quiet();

      const task = await resolveTaskByChangePath(
        ctx.taskRepository,
        ctx.repoRepository,
        changePath,
      );

      expect(task).toBeNull();
    });

    test("returns null when task not found for registered repo", async () => {
      await createTestRepo(db, "repo-1", gitRepoPath);

      const changePath = `${gitRepoPath}/changes/feature-a`;
      await Bun.$`mkdir -p ${changePath}`.quiet();

      const task = await resolveTaskByChangePath(
        ctx.taskRepository,
        ctx.repoRepository,
        changePath,
      );

      expect(task).toBeNull();
    });

    test("returns task when found by change path", async () => {
      await createTestRepo(db, "repo-1", gitRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DRAFT");

      const changePath = `${gitRepoPath}/changes/feature-a`;
      await Bun.$`mkdir -p ${changePath}`.quiet();

      const task = await resolveTaskByChangePath(
        ctx.taskRepository,
        ctx.repoRepository,
        changePath,
      );

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
    });

    test.skipIf(process.platform === "darwin")("resolves relative path correctly", async () => {
      await createTestRepo(db, "repo-1", gitRepoPath);
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "DRAFT");

      const changePath = `${gitRepoPath}/changes/feature-a`;
      await Bun.$`mkdir -p ${changePath}`.quiet();

      const cwd = process.cwd();
      try {
        process.chdir(gitRepoPath);
        const task = await resolveTaskByChangePath(
          ctx.taskRepository,
          ctx.repoRepository,
          "changes/feature-a",
        );

        expect(task).not.toBeNull();
        expect(task?.id).toBe("task-1");
      } finally {
        process.chdir(cwd);
      }
    });
  });
});
