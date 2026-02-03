import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createRepoRepository } from "../repos/repository.ts";
import { createTaskRepository } from "../tasks/repository.ts";
import { reconcileRepo } from "./reconcile.ts";
import type { WatcherEvent } from "./types.ts";
import { createWatcherManager } from "./watcher.ts";

describe("Watcher → Task Detection Integration", () => {
  let db: Kysely<Database>;
  let testDir: string;
  let changesDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    testDir = join(
      tmpdir(),
      `watcher-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    changesDir = join(testDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(testDir, { recursive: true, force: true });
  });

  test("watcher event triggers task creation via reconcile", async () => {
    await createTestRepo(db, "repo-1", testDir);

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await repoRepository.getById("repo-1");
    if (!repo) throw new Error("Repo not found");

    const processedEvents: WatcherEvent[] = [];

    const handleWatcherEvent = async (event: WatcherEvent) => {
      processedEvents.push(event);
      if (event.type === "create" || event.type === "delete") {
        await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });
      }
    };

    const manager = createWatcherManager(handleWatcherEvent, { debounceMs: 20 });
    manager.addRepo("repo-1", testDir);

    mkdirSync(join(changesDir, "new-feature"));

    await new Promise((r) => setTimeout(r, 150));

    manager.stop();

    expect(processedEvents.length).toBeGreaterThanOrEqual(1);
    expect(processedEvents[0]?.changeName).toBe("new-feature");
    expect(processedEvents[0]?.type).toBe("create");

    const tasks = await taskRepository.list({ repo_id: "repo-1" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("DRAFT");
    expect(tasks[0]?.change_path).toBe("openspec/changes/new-feature");
  });

  test("watcher event triggers task removal via reconcile when directory deleted", async () => {
    await createTestRepo(db, "repo-1", testDir);

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await repoRepository.getById("repo-1");
    if (!repo) throw new Error("Repo not found");

    const featureDir = join(changesDir, "temp-feature");

    const processedEvents: WatcherEvent[] = [];

    const handleWatcherEvent = async (event: WatcherEvent) => {
      processedEvents.push(event);
      await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });
    };

    const manager = createWatcherManager(handleWatcherEvent, { debounceMs: 20 });
    manager.addRepo("repo-1", testDir);

    mkdirSync(featureDir);
    await new Promise((r) => setTimeout(r, 200));

    const tasksBefore = await taskRepository.list({ repo_id: "repo-1" });
    expect(tasksBefore).toHaveLength(1);
    expect(tasksBefore[0]?.status).toBe("DRAFT");

    rmSync(featureDir, { recursive: true });
    await new Promise((r) => setTimeout(r, 150));

    manager.stop();

    const deleteEvents = processedEvents.filter((e) => e.type === "delete");
    expect(deleteEvents.length).toBeGreaterThanOrEqual(1);

    const tasksAfter = await taskRepository.list({ repo_id: "repo-1" });
    expect(tasksAfter).toHaveLength(1);
    expect(tasksAfter[0]?.status).toBe("REMOVED");
  });

  test("multiple changes detected and processed correctly", async () => {
    await createTestRepo(db, "repo-1", testDir);

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await repoRepository.getById("repo-1");
    if (!repo) throw new Error("Repo not found");

    const handleWatcherEvent = async () => {
      await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });
    };

    const manager = createWatcherManager(handleWatcherEvent, { debounceMs: 20 });
    manager.addRepo("repo-1", testDir);

    mkdirSync(join(changesDir, "feature-a"));
    await new Promise((r) => setTimeout(r, 50));
    mkdirSync(join(changesDir, "feature-b"));
    await new Promise((r) => setTimeout(r, 50));
    mkdirSync(join(changesDir, "feature-c"));

    await new Promise((r) => setTimeout(r, 150));

    manager.stop();

    const tasks = await taskRepository.list({ repo_id: "repo-1" });
    expect(tasks).toHaveLength(3);

    const changePaths = tasks.map((t) => t.change_path);
    expect(changePaths).toContain("openspec/changes/feature-a");
    expect(changePaths).toContain("openspec/changes/feature-b");
    expect(changePaths).toContain("openspec/changes/feature-c");

    for (const task of tasks) {
      expect(task.status).toBe("DRAFT");
    }
  });

  test("WORKING task not marked as removed when directory deleted", async () => {
    await createTestRepo(db, "repo-1", testDir);
    const featurePath = join(changesDir, "working-feature");
    await createTestTask(db, "task-1", "repo-1", "openspec/changes/working-feature", "WORKING");

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await repoRepository.getById("repo-1");
    if (!repo) throw new Error("Repo not found");

    const handleWatcherEvent = async () => {
      await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });
    };

    const manager = createWatcherManager(handleWatcherEvent, { debounceMs: 20 });
    manager.addRepo("repo-1", testDir);

    mkdirSync(featurePath);
    await new Promise((r) => setTimeout(r, 50));
    rmSync(featurePath, { recursive: true });

    await new Promise((r) => setTimeout(r, 150));

    manager.stop();

    const task = await taskRepository.get("task-1");
    expect(task?.status).toBe("WORKING");
  });

  test("idempotent task creation - rapid events for same change", async () => {
    await createTestRepo(db, "repo-1", testDir);

    const repoRepository = createRepoRepository(db);
    const taskRepository = createTaskRepository(db);
    const repo = await repoRepository.getById("repo-1");
    if (!repo) throw new Error("Repo not found");

    const handleWatcherEvent = async () => {
      await reconcileRepo(repo, { repoRepository: repoRepository, taskRepository });
    };

    const manager = createWatcherManager(handleWatcherEvent, { debounceMs: 100 });
    manager.addRepo("repo-1", testDir);

    mkdirSync(join(changesDir, "my-feature"));

    await new Promise((r) => setTimeout(r, 250));

    manager.stop();

    const tasks = await taskRepository.list({ repo_id: "repo-1" });
    expect(tasks).toHaveLength(1);
  });
});
