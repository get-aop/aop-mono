import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { cleanupTestDb, createTestClient, createTestDb } from "../db/test-utils.ts";
import { createRepoRepository, type RepoRepository } from "../repos/repo-repository.ts";
import { createTaskRepository, type TaskRepository } from "./task-repository.ts";

describe("TaskRepository", () => {
  let db: Kysely<Database>;
  let taskRepository: TaskRepository;
  let repoRepository: RepoRepository;
  let clientId: string;
  let repoId: string;

  beforeAll(async () => {
    db = await createTestDb();
    taskRepository = createTaskRepository(db);
    repoRepository = createRepoRepository(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const setupClientAndRepo = async () => {
    const client = await createTestClient(db);
    clientId = client.id;
    repoId = `repo-${Date.now()}`;
    await repoRepository.upsert({
      id: repoId,
      client_id: clientId,
      synced_at: new Date(),
    });
    return { clientId, repoId };
  };

  describe("upsert", () => {
    test("creates a new task", async () => {
      await setupClientAndRepo();
      const now = new Date();

      const task = await taskRepository.upsert({
        id: "task-1",
        client_id: clientId,
        repo_id: repoId,
        status: "READY",
        synced_at: now,
      });

      expect(task.id).toBe("task-1");
      expect(task.client_id).toBe(clientId);
      expect(task.repo_id).toBe(repoId);
      expect(task.status).toBe("READY");
      expect(task.synced_at).toEqual(now);
    });

    test("updates existing task on conflict", async () => {
      await setupClientAndRepo();
      const firstSync = new Date("2026-01-01");
      const secondSync = new Date("2026-02-01");

      await taskRepository.upsert({
        id: "task-1",
        client_id: clientId,
        repo_id: repoId,
        status: "READY",
        synced_at: firstSync,
      });

      const updated = await taskRepository.upsert({
        id: "task-1",
        client_id: clientId,
        repo_id: repoId,
        status: "WORKING",
        synced_at: secondSync,
      });

      expect(updated.status).toBe("WORKING");
      expect(updated.synced_at).toEqual(secondSync);
    });
  });

  describe("findById", () => {
    test("returns task by ID", async () => {
      await setupClientAndRepo();
      await taskRepository.upsert({
        id: "task-1",
        client_id: clientId,
        repo_id: repoId,
        status: "READY",
        synced_at: new Date(),
      });

      const task = await taskRepository.findById("task-1");

      expect(task).not.toBeNull();
      expect(task?.status).toBe("READY");
    });

    test("returns null for non-existent ID", async () => {
      const task = await taskRepository.findById("non-existent");

      expect(task).toBeNull();
    });
  });

  describe("update", () => {
    test("updates task fields", async () => {
      await setupClientAndRepo();
      await taskRepository.upsert({
        id: "task-1",
        client_id: clientId,
        repo_id: repoId,
        status: "READY",
        synced_at: new Date(),
      });

      const updated = await taskRepository.update("task-1", { status: "WORKING" });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe("WORKING");
    });

    test("returns null for non-existent task", async () => {
      const updated = await taskRepository.update("non-existent", { status: "WORKING" });

      expect(updated).toBeNull();
    });
  });

  describe("countWorkingByClient", () => {
    test("counts only WORKING tasks for client", async () => {
      await setupClientAndRepo();
      const now = new Date();

      await taskRepository.upsert({
        id: "task-1",
        client_id: clientId,
        repo_id: repoId,
        status: "WORKING",
        synced_at: now,
      });
      await taskRepository.upsert({
        id: "task-2",
        client_id: clientId,
        repo_id: repoId,
        status: "WORKING",
        synced_at: now,
      });
      await taskRepository.upsert({
        id: "task-3",
        client_id: clientId,
        repo_id: repoId,
        status: "READY",
        synced_at: now,
      });
      await taskRepository.upsert({
        id: "task-4",
        client_id: clientId,
        repo_id: repoId,
        status: "DONE",
        synced_at: now,
      });

      const count = await taskRepository.countWorkingByClient(clientId);

      expect(count).toBe(2);
    });

    test("returns zero when no WORKING tasks", async () => {
      await setupClientAndRepo();

      const count = await taskRepository.countWorkingByClient(clientId);

      expect(count).toBe(0);
    });

    test("does not count tasks from other clients", async () => {
      await setupClientAndRepo();
      const otherClient = await createTestClient(db, { id: "other-client" });

      await taskRepository.upsert({
        id: "task-1",
        client_id: clientId,
        repo_id: repoId,
        status: "WORKING",
        synced_at: new Date(),
      });
      await taskRepository.upsert({
        id: "task-2",
        client_id: otherClient.id,
        repo_id: repoId,
        status: "WORKING",
        synced_at: new Date(),
      });

      const count = await taskRepository.countWorkingByClient(clientId);

      expect(count).toBe(1);
    });
  });
});
