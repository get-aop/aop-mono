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
import {
  createStepExecutionRepository,
  type StepExecutionRepository,
} from "./step-execution-repository.ts";

describe("StepExecutionRepository", () => {
  let db: Kysely<Database>;
  let stepExecutionRepository: StepExecutionRepository;
  let executionRepository: ExecutionRepository;
  let taskRepository: TaskRepository;
  let repoRepository: RepoRepository;
  let clientId: string;
  let executionId: string;

  beforeAll(async () => {
    db = await createTestDb();
    stepExecutionRepository = createStepExecutionRepository(db);
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

    const repoId = `repo-${Date.now()}`;
    await repoRepository.upsert({
      id: repoId,
      client_id: clientId,
      synced_at: new Date(),
    });

    const taskId = `task-${Date.now()}`;
    await taskRepository.upsert({
      id: taskId,
      client_id: clientId,
      repo_id: repoId,
      status: "WORKING",
      synced_at: new Date(),
    });

    executionId = `exec-${Date.now()}`;
    await executionRepository.create({
      id: executionId,
      client_id: clientId,
      task_id: taskId,
      workflow_id: workflow.id,
      status: "running",
    });

    return { clientId, executionId };
  };

  describe("create", () => {
    test("creates a new step execution", async () => {
      await setupTestData();

      const stepExecution = await stepExecutionRepository.create({
        id: "step-1",
        client_id: clientId,
        execution_id: executionId,
        step_type: "implement",
        prompt_template: "Implement the feature",
        status: "running",
      });

      expect(stepExecution.id).toBe("step-1");
      expect(stepExecution.client_id).toBe(clientId);
      expect(stepExecution.execution_id).toBe(executionId);
      expect(stepExecution.step_type).toBe("implement");
      expect(stepExecution.prompt_template).toBe("Implement the feature");
      expect(stepExecution.status).toBe("running");
      expect(stepExecution.started_at).toBeDefined();
      expect(stepExecution.ended_at).toBeNull();
      expect(stepExecution.error_code).toBeNull();
    });
  });

  describe("findById", () => {
    test("returns step execution by ID", async () => {
      await setupTestData();
      await stepExecutionRepository.create({
        id: "step-1",
        client_id: clientId,
        execution_id: executionId,
        step_type: "implement",
        prompt_template: "Implement",
        status: "running",
      });

      const stepExecution = await stepExecutionRepository.findById("step-1");

      expect(stepExecution).not.toBeNull();
      expect(stepExecution?.step_type).toBe("implement");
    });

    test("returns null for non-existent ID", async () => {
      const stepExecution = await stepExecutionRepository.findById("non-existent");

      expect(stepExecution).toBeNull();
    });
  });

  describe("update", () => {
    test("updates step execution fields", async () => {
      await setupTestData();
      await stepExecutionRepository.create({
        id: "step-1",
        client_id: clientId,
        execution_id: executionId,
        step_type: "implement",
        prompt_template: "Implement",
        status: "running",
      });

      const endedAt = new Date();
      const updated = await stepExecutionRepository.update("step-1", {
        status: "success",
        ended_at: endedAt,
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe("success");
      expect(updated?.ended_at).toEqual(endedAt);
    });

    test("updates with error code on failure", async () => {
      await setupTestData();
      await stepExecutionRepository.create({
        id: "step-1",
        client_id: clientId,
        execution_id: executionId,
        step_type: "implement",
        prompt_template: "Implement",
        status: "running",
      });

      const updated = await stepExecutionRepository.update("step-1", {
        status: "failure",
        error_code: "agent_timeout",
        ended_at: new Date(),
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe("failure");
      expect(updated?.error_code).toBe("agent_timeout");
    });

    test("returns null for non-existent step execution", async () => {
      const updated = await stepExecutionRepository.update("non-existent", { status: "success" });

      expect(updated).toBeNull();
    });
  });

  describe("cancelRunningByExecution", () => {
    test("cancels all running step executions for an execution", async () => {
      await setupTestData();
      await stepExecutionRepository.create({
        id: "step-1",
        client_id: clientId,
        execution_id: executionId,
        step_type: "implement",
        prompt_template: "Implement",
        status: "running",
      });
      await stepExecutionRepository.create({
        id: "step-2",
        client_id: clientId,
        execution_id: executionId,
        step_type: "test",
        prompt_template: "Test",
        status: "running",
      });

      const count = await stepExecutionRepository.cancelRunningByExecution(executionId);

      expect(count).toBe(2);

      const step1 = await stepExecutionRepository.findById("step-1");
      const step2 = await stepExecutionRepository.findById("step-2");
      expect(step1?.status).toBe("cancelled");
      expect(step1?.ended_at).not.toBeNull();
      expect(step2?.status).toBe("cancelled");
      expect(step2?.ended_at).not.toBeNull();
    });

    test("only cancels running steps, not completed ones", async () => {
      await setupTestData();
      await stepExecutionRepository.create({
        id: "step-1",
        client_id: clientId,
        execution_id: executionId,
        step_type: "implement",
        prompt_template: "Implement",
        status: "success",
      });
      await stepExecutionRepository.create({
        id: "step-2",
        client_id: clientId,
        execution_id: executionId,
        step_type: "test",
        prompt_template: "Test",
        status: "running",
      });

      const count = await stepExecutionRepository.cancelRunningByExecution(executionId);

      expect(count).toBe(1);

      const step1 = await stepExecutionRepository.findById("step-1");
      const step2 = await stepExecutionRepository.findById("step-2");
      expect(step1?.status).toBe("success");
      expect(step2?.status).toBe("cancelled");
    });

    test("returns 0 when no running steps", async () => {
      await setupTestData();
      await stepExecutionRepository.create({
        id: "step-1",
        client_id: clientId,
        execution_id: executionId,
        step_type: "implement",
        prompt_template: "Implement",
        status: "success",
      });

      const count = await stepExecutionRepository.cancelRunningByExecution(executionId);

      expect(count).toBe(0);
    });

    test("returns 0 for non-existent execution", async () => {
      await setupTestData();

      const count = await stepExecutionRepository.cancelRunningByExecution("non-existent");

      expect(count).toBe(0);
    });
  });
});
