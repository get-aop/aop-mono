import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { cleanupTestDb, createTestClient, createTestDb } from "../db/test-utils.ts";
import { createExecutionRepository } from "../executions/execution-repository.ts";
import { createRepoRepository } from "../repos/repo-repository.ts";
import { createTaskRepository } from "./task-repository.ts";
import { createTaskService, type TaskService } from "./task-service.ts";

describe("TaskService", () => {
  let db: Kysely<Database>;
  let taskService: TaskService;

  beforeAll(async () => {
    db = await createTestDb();
    const taskRepo = createTaskRepository(db);
    const executionRepo = createExecutionRepository(db);
    const repoRepo = createRepoRepository(db);
    taskService = createTaskService(taskRepo, executionRepo, repoRepo);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const createTestRepo = async (clientId: string, repoId: string) => {
    const repoRepo = createRepoRepository(db);
    await repoRepo.upsert({
      id: repoId,
      client_id: clientId,
      synced_at: new Date(),
    });
  };

  describe("syncTask", () => {
    test("creates a new task when it does not exist", async () => {
      const { id: clientId } = await createTestClient(db);
      const repoId = "repo-123";
      const taskId = "task-123";
      const syncedAt = new Date("2026-02-02T10:00:00Z");
      await createTestRepo(clientId, repoId);

      await taskService.syncTask(clientId, taskId, repoId, "DRAFT", syncedAt);

      const task = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", taskId)
        .executeTakeFirst();

      expect(task).toBeDefined();
      expect(task?.id).toBe(taskId);
      expect(task?.client_id).toBe(clientId);
      expect(task?.repo_id).toBe(repoId);
      expect(task?.status).toBe("DRAFT");
      expect(task?.synced_at?.toISOString()).toBe(syncedAt.toISOString());
    });

    test("updates status and synced_at when task already exists", async () => {
      const { id: clientId } = await createTestClient(db);
      const repoId = "repo-123";
      const taskId = "task-123";
      await createTestRepo(clientId, repoId);

      await taskService.syncTask(
        clientId,
        taskId,
        repoId,
        "DRAFT",
        new Date("2026-02-01T10:00:00Z"),
      );
      await taskService.syncTask(
        clientId,
        taskId,
        repoId,
        "READY",
        new Date("2026-02-02T15:00:00Z"),
      );

      const task = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", taskId)
        .executeTakeFirst();

      expect(task).toBeDefined();
      expect(task?.status).toBe("READY");
      expect(task?.synced_at?.toISOString()).toBe(new Date("2026-02-02T15:00:00Z").toISOString());
    });
  });

  describe("getTaskStatus", () => {
    test("returns task_not_found for non-existent task", async () => {
      const { id: clientId } = await createTestClient(db);

      const result = await taskService.getTaskStatus(clientId, "non-existent-task");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("task_not_found");
      }
    });

    test("returns task_not_found when task belongs to different client", async () => {
      const { id: clientId1 } = await createTestClient(db, { id: "client-1" });
      const { id: clientId2 } = await createTestClient(db, { id: "client-2" });
      const repoId = "repo-123";
      const taskId = "task-123";
      await createTestRepo(clientId1, repoId);
      await taskService.syncTask(clientId1, taskId, repoId, "DRAFT", new Date());

      const result = await taskService.getTaskStatus(clientId2, taskId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("task_not_found");
      }
    });

    test("returns task status without execution when no active execution exists", async () => {
      const { id: clientId } = await createTestClient(db);
      const repoId = "repo-123";
      const taskId = "task-123";
      await createTestRepo(clientId, repoId);
      await taskService.syncTask(clientId, taskId, repoId, "READY", new Date());

      const result = await taskService.getTaskStatus(clientId, taskId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.status).toBe("READY");
        expect(result.response.execution).toBeUndefined();
      }
    });

    test("returns task status with active execution info", async () => {
      const { id: clientId } = await createTestClient(db);
      const repoId = "repo-123";
      const taskId = "task-123";
      const executionId = "exec-123";
      await createTestRepo(clientId, repoId);
      await taskService.syncTask(clientId, taskId, repoId, "WORKING", new Date());

      await db
        .insertInto("workflows")
        .values({
          id: "workflow-1",
          name: "test-workflow",
          definition: "{}",
        })
        .execute();

      await db
        .insertInto("executions")
        .values({
          id: executionId,
          client_id: clientId,
          task_id: taskId,
          workflow_id: "workflow-1",
          status: "running",
        })
        .execute();

      const result = await taskService.getTaskStatus(clientId, taskId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.status).toBe("WORKING");
        expect(result.response.execution).toBeDefined();
        expect(result.response.execution?.id).toBe(executionId);
        expect(result.response.execution?.awaitingResult).toBe(true);
      }
    });
  });
});
