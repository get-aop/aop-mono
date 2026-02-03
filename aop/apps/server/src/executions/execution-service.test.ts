import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Client, Database } from "../db/schema.ts";
import {
  cleanupTestDb,
  createSimpleWorkflow,
  createTestClient,
  createTestDb,
} from "../db/test-utils.ts";
import { createRepoRepository } from "../repos/repo-repository.ts";
import { createExecutionService, type ExecutionService } from "./execution-service.ts";

describe("ExecutionService", () => {
  let db: Kysely<Database>;
  let executionService: ExecutionService;

  beforeAll(async () => {
    db = await createTestDb();
    executionService = createExecutionService(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const setupTestData = async (maxConcurrent = 5): Promise<Client> => {
    const { id } = await createTestClient(db, { maxConcurrentTasks: maxConcurrent });
    await createSimpleWorkflow(db);

    const clientRow = await db
      .selectFrom("clients")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

    return clientRow;
  };

  const createTestRepo = async (clientId: string, repoId: string) => {
    const repoRepo = createRepoRepository(db);
    await repoRepo.upsert({
      id: repoId,
      client_id: clientId,
      synced_at: new Date(),
    });
  };

  describe("checkConcurrency", () => {
    test("returns true when under limit", async () => {
      const testClient = await setupTestData(5);

      const hasCapacity = await executionService.checkConcurrency(testClient.id, 5);

      expect(hasCapacity).toBe(true);
    });

    test("returns false when at limit", async () => {
      const testClient = await setupTestData(1);
      await createTestRepo(testClient.id, "repo-1");

      await executionService.startWorkflow(testClient, "task-1", "repo-1");

      const hasCapacity = await executionService.checkConcurrency(testClient.id, 1);
      expect(hasCapacity).toBe(false);
    });
  });

  describe("startWorkflow", () => {
    test("returns queued response when at capacity", async () => {
      const testClient = await setupTestData(1);
      await createTestRepo(testClient.id, "repo-1");

      await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const result = await executionService.startWorkflow(testClient, "task-2", "repo-1");

      expect(result.status).toBe("READY");
      expect(result.queued).toBe(true);
      expect(result.step).toBeUndefined();
    });

    test("creates execution and returns first step when has capacity", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const result = await executionService.startWorkflow(testClient, "task-1", "repo-1");

      expect(result.status).toBe("WORKING");
      expect(result.execution).toBeDefined();
      expect(result.execution?.workflowId).toBe("workflow_simple");
      expect(result.step).toBeDefined();
      expect(result.step?.type).toBe("implement");
      expect(result.step?.attempt).toBe(1);
    });

    test("creates task, execution, and step_execution records", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const result = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const executionId = result.execution?.id;
      const stepId = result.step?.id;

      expect(executionId).toBeDefined();
      expect(stepId).toBeDefined();

      const task = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();
      expect(task).toBeDefined();
      expect(task?.status).toBe("WORKING");

      const execution = await db
        .selectFrom("executions")
        .selectAll()
        .where("id", "=", executionId ?? "")
        .executeTakeFirst();
      expect(execution).toBeDefined();
      expect(execution?.status).toBe("running");

      const stepExecution = await db
        .selectFrom("step_executions")
        .selectAll()
        .where("id", "=", stepId ?? "")
        .executeTakeFirst();
      expect(stepExecution).toBeDefined();
      expect(stepExecution?.status).toBe("running");
    });
  });

  describe("processStepResult", () => {
    test("marks task as DONE on success with terminal transition", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const startResult = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const stepId = startResult.step?.id;
      const executionId = startResult.execution?.id;

      expect(stepId).toBeDefined();
      expect(executionId).toBeDefined();

      const result = await executionService.processStepResult(testClient, {
        stepId: stepId ?? "",
        executionId: executionId ?? "",
        attempt: 1,
        status: "success",
        durationMs: 1000,
      });

      expect(result.taskStatus).toBe("DONE");
      expect(result.step).toBeNull();
    });

    test("marks task as BLOCKED on failure with terminal transition", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const startResult = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const stepId = startResult.step?.id;
      const executionId = startResult.execution?.id;

      expect(stepId).toBeDefined();
      expect(executionId).toBeDefined();

      const result = await executionService.processStepResult(testClient, {
        stepId: stepId ?? "",
        executionId: executionId ?? "",
        attempt: 1,
        status: "failure",
        errorCode: "agent_timeout",
        durationMs: 5000,
      });

      expect(result.taskStatus).toBe("BLOCKED");
      expect(result.step).toBeNull();
      expect(result.error?.code).toBe("max_retries_exceeded");
    });

    test("returns idempotent response for already completed step", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const startResult = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const stepId = startResult.step?.id;
      const executionId = startResult.execution?.id;

      expect(stepId).toBeDefined();
      expect(executionId).toBeDefined();

      await executionService.processStepResult(testClient, {
        stepId: stepId ?? "",
        executionId: executionId ?? "",
        attempt: 1,
        status: "success",
        durationMs: 1000,
      });

      const secondResult = await executionService.processStepResult(testClient, {
        stepId: stepId ?? "",
        executionId: executionId ?? "",
        attempt: 1,
        status: "success",
        durationMs: 1000,
      });

      expect(secondResult.taskStatus).toBe("DONE");
      expect(secondResult.step).toBeNull();
    });

    test("throws error for step not owned by client", async () => {
      const testClient = await setupTestData();
      const otherClient = await createTestClient(db, { id: "other-client" });
      await createTestRepo(testClient.id, "repo-1");

      const startResult = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const stepId = startResult.step?.id;
      const executionId = startResult.execution?.id;

      expect(stepId).toBeDefined();
      expect(executionId).toBeDefined();

      const otherClientRow = await db
        .selectFrom("clients")
        .selectAll()
        .where("id", "=", otherClient.id)
        .executeTakeFirstOrThrow();

      await expect(
        executionService.processStepResult(otherClientRow, {
          stepId: stepId ?? "",
          executionId: executionId ?? "",
          attempt: 1,
          status: "success",
          durationMs: 1000,
        }),
      ).rejects.toThrow("Step does not belong to this client");
    });

    test("throws error for non-existent step", async () => {
      const testClient = await setupTestData();

      await expect(
        executionService.processStepResult(testClient, {
          stepId: "non-existent-step",
          executionId: "some-exec",
          attempt: 1,
          status: "success",
          durationMs: 1000,
        }),
      ).rejects.toThrow("Step execution");
    });
  });
});
