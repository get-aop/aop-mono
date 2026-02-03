import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { Database, Repo } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createRepoRepository } from "../repos/repository.ts";
import { createTaskRepository } from "../tasks/repository.ts";
import { reconcileAllRepos, reconcileRepo } from "./reconcile.ts";

const getRepoOrFail = async (db: Kysely<Database>, repoId: string): Promise<Repo> => {
  const repoRepository = createRepoRepository(db);
  const repo = await repoRepository.getById(repoId);
  if (!repo) throw new Error(`Repo ${repoId} not found`);
  return repo;
};

describe("reconcileRepo", () => {
  let db: Kysely<Database>;
  let testDir: string;
  let changesDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    testDir = join(tmpdir(), `reconcile-test-${Date.now()}`);
    changesDir = join(testDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(testDir, { recursive: true, force: true });
  });

  test("creates DRAFT task for new change directory", async () => {
    await createTestRepo(db, "repo-1", testDir);
    mkdirSync(join(changesDir, "new-feature"));

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await getRepoOrFail(db, "repo-1");

    const result = await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });

    expect(result.created).toBe(1);
    expect(result.removed).toBe(0);

    const tasks = await taskRepository.list({ repo_id: "repo-1" });
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    if (!task) throw new Error("Expected task to exist");
    expect(task.status).toBe("DRAFT");
    expect(task.change_path).toBe("openspec/changes/new-feature");
  });

  test("marks task as REMOVED when directory is deleted", async () => {
    await createTestRepo(db, "repo-1", testDir);
    await createTestTask(db, "task-1", "repo-1", "openspec/changes/old-feature", "DRAFT");

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await getRepoOrFail(db, "repo-1");

    const result = await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });

    expect(result.created).toBe(0);
    expect(result.removed).toBe(1);

    const task = await taskRepository.get("task-1");
    expect(task?.status).toBe("REMOVED");
  });

  test("does not mark WORKING tasks as removed", async () => {
    await createTestRepo(db, "repo-1", testDir);
    await createTestTask(db, "task-1", "repo-1", "openspec/changes/working-feature", "WORKING");

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await getRepoOrFail(db, "repo-1");

    const result = await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });

    expect(result.removed).toBe(0);

    const task = await taskRepository.get("task-1");
    expect(task?.status).toBe("WORKING");
  });

  test("handles empty changes directory", async () => {
    await createTestRepo(db, "repo-1", testDir);

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await getRepoOrFail(db, "repo-1");

    const result = await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });

    expect(result.created).toBe(0);
    expect(result.removed).toBe(0);
  });

  test("ignores reserved 'archive' folder", async () => {
    await createTestRepo(db, "repo-1", testDir);
    mkdirSync(join(changesDir, "archive"));
    mkdirSync(join(changesDir, "real-feature"));

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await getRepoOrFail(db, "repo-1");

    const result = await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });

    expect(result.created).toBe(1);

    const tasks = await taskRepository.list({ repo_id: "repo-1" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.change_path).toContain("real-feature");
  });

  test("is idempotent - running twice creates only one task", async () => {
    await createTestRepo(db, "repo-1", testDir);
    mkdirSync(join(changesDir, "my-feature"));

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await getRepoOrFail(db, "repo-1");
    const deps = { repoRepository: repoRepository, taskRepository };

    await reconcileRepo(repo, deps);
    const result2 = await reconcileRepo(repo, deps);

    expect(result2.created).toBe(0);

    const tasks = await taskRepository.list({ repo_id: "repo-1" });
    expect(tasks).toHaveLength(1);
  });

  test("ignores already REMOVED tasks", async () => {
    await createTestRepo(db, "repo-1", testDir);
    await createTestTask(db, "task-1", "repo-1", "openspec/changes/removed-feature", "REMOVED");

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await getRepoOrFail(db, "repo-1");

    const result = await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });

    expect(result.removed).toBe(0);
  });
});

describe("reconcileAllRepos", () => {
  let db: Kysely<Database>;
  let testDir1: string;
  let testDir2: string;

  beforeEach(async () => {
    db = await createTestDb();
    testDir1 = join(tmpdir(), `reconcile-all-1-${Date.now()}`);
    testDir2 = join(tmpdir(), `reconcile-all-2-${Date.now()}`);
    mkdirSync(join(testDir1, "openspec/changes"), { recursive: true });
    mkdirSync(join(testDir2, "openspec/changes"), { recursive: true });
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(testDir1, { recursive: true, force: true });
    rmSync(testDir2, { recursive: true, force: true });
  });

  test("reconciles all registered repos", async () => {
    await createTestRepo(db, "repo-1", testDir1);
    await createTestRepo(db, "repo-2", testDir2);
    mkdirSync(join(testDir1, "openspec/changes/feature-a"));
    mkdirSync(join(testDir2, "openspec/changes/feature-b"));

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);

    const result = await reconcileAllRepos({ repoRepository: repoRepository, taskRepository });

    expect(result.created).toBe(2);
    expect(result.removed).toBe(0);
  });

  test("returns zero counts when no repos registered", async () => {
    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);

    const result = await reconcileAllRepos({ repoRepository: repoRepository, taskRepository });

    expect(result.created).toBe(0);
    expect(result.removed).toBe(0);
  });
});
