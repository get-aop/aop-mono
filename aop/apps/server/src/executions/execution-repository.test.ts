import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import {
  cleanupTestDb,
  createTestClient,
  createTestDb,
  createTestWorkflow,
} from "../db/test-utils.ts";
import { createRepoRepository, type RepoRepository } from "../repos/repo-repository.ts";
import { createTaskRepository, type TaskRepository } from "../tasks/task-repository.ts";
import { createExecutionRepository, type ExecutionRepository } from "./execution-repository.ts";

describe("ExecutionRepository", () => {
  let db: Kysely<Database>;
  let executionRepository: ExecutionRepository;
  let taskRepository: TaskRepository;
  let repoRepository: RepoRepository;
  let clientId: string;
  let repoId: string;
  let taskId: string;
  let workflowId: string;

  beforeAll(async () => {
    db = await createTestDb();
    executionRepository = createExecutionRepository(db);
    taskRepository = createTaskRepository(db);
    repoRepository = createRepoRepository(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const setupTestData = async () => {
    const client = await createTestClient(db);
    clientId = client.id;

    const workflow = await createTestWorkflow(db);
    workflowId = workflow.id;

    repoId = `repo-${Date.now()}`;
    await repoRepository.upsert({
      id: repoId,
      client_id: clientId,
      synced_at: new Date(),
    });

    taskId = `task-${Date.now()}`;
    await taskRepository.upsert({
      id: taskId,
      client_id: clientId,
      repo_id: repoId,
      status: "WORKING",
      synced_at: new Date(),
    });

    return { clientId, workflowId, repoId, taskId };
  };

  describe("create", () => {
    test("creates a new execution", async () => {
      await setupTestData();

      const execution = await executionRepository.create({
        id: "exec-1",
        client_id: clientId,
        task_id: taskId,
        workflow_id: workflowId,
        status: "running",
      });

      expect(execution.id).toBe("exec-1");
      expect(execution.client_id).toBe(clientId);
      expect(execution.task_id).toBe(taskId);
      expect(execution.workflow_id).toBe(workflowId);
      expect(execution.status).toBe("running");
      expect(execution.started_at).toBeDefined();
      expect(execution.completed_at).toBeNull();
    });
  });

  describe("findById", () => {
    test("returns execution by ID", async () => {
      await setupTestData();
      await executionRepository.create({
        id: "exec-1",
        client_id: clientId,
        task_id: taskId,
        workflow_id: workflowId,
        status: "running",
      });

      const execution = await executionRepository.findById("exec-1");

      expect(execution).not.toBeNull();
      expect(execution?.status).toBe("running");
    });

    test("returns null for non-existent ID", async () => {
      const execution = await executionRepository.findById("non-existent");

      expect(execution).toBeNull();
    });
  });

  describe("update", () => {
    test("updates execution fields", async () => {
      await setupTestData();
      await executionRepository.create({
        id: "exec-1",
        client_id: clientId,
        task_id: taskId,
        workflow_id: workflowId,
        status: "running",
      });

      const completedAt = new Date();
      const updated = await executionRepository.update("exec-1", {
        status: "completed",
        completed_at: completedAt,
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe("completed");
      expect(updated?.completed_at).toEqual(completedAt);
    });

    test("returns null for non-existent execution", async () => {
      const updated = await executionRepository.update("non-existent", { status: "completed" });

      expect(updated).toBeNull();
    });
  });

  describe("findActiveByTask", () => {
    test("returns running execution for task", async () => {
      await setupTestData();
      await executionRepository.create({
        id: "exec-1",
        client_id: clientId,
        task_id: taskId,
        workflow_id: workflowId,
        status: "running",
      });

      const execution = await executionRepository.findActiveByTask(taskId);

      expect(execution).not.toBeNull();
      expect(execution?.id).toBe("exec-1");
    });

    test("returns null when no active execution", async () => {
      await setupTestData();
      await executionRepository.create({
        id: "exec-1",
        client_id: clientId,
        task_id: taskId,
        workflow_id: workflowId,
        status: "completed",
      });

      const execution = await executionRepository.findActiveByTask(taskId);

      expect(execution).toBeNull();
    });

    test("returns null for task with no executions", async () => {
      await setupTestData();

      const execution = await executionRepository.findActiveByTask(taskId);

      expect(execution).toBeNull();
    });
  });

  describe("cancelActiveByTask", () => {
    test("cancels running execution and returns it", async () => {
      await setupTestData();
      await executionRepository.create({
        id: "exec-1",
        client_id: clientId,
        task_id: taskId,
        workflow_id: workflowId,
        status: "running",
      });

      const cancelled = await executionRepository.cancelActiveByTask(taskId);

      expect(cancelled).not.toBeNull();
      expect(cancelled?.id).toBe("exec-1");
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.completed_at).not.toBeNull();

      const fetched = await executionRepository.findById("exec-1");
      expect(fetched?.status).toBe("cancelled");
    });

    test("returns null when no active execution", async () => {
      await setupTestData();
      await executionRepository.create({
        id: "exec-1",
        client_id: clientId,
        task_id: taskId,
        workflow_id: workflowId,
        status: "completed",
      });

      const cancelled = await executionRepository.cancelActiveByTask(taskId);

      expect(cancelled).toBeNull();
    });

    test("returns null for task with no executions", async () => {
      await setupTestData();

      const cancelled = await executionRepository.cancelActiveByTask(taskId);

      expect(cancelled).toBeNull();
    });
  });
});
