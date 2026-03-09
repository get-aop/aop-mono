import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Client, Database } from "../db/schema.ts";
import {
  cleanupTestDb,
  createAopDefaultWorkflow,
  createPausedWorkflow,
  createRalphLoopWorkflow,
  createReviewWorkflow,
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
    await createAopDefaultWorkflow(db);
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
      expect(result.execution?.workflowId).toBe("workflow_aop_default");
      expect(result.step).toBeDefined();
      expect(result.step?.type).toBe("iterate");
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

    test("uses specified workflow name when provided", async () => {
      const testClient = await setupTestData();
      await createRalphLoopWorkflow(db);
      await createTestRepo(testClient.id, "repo-1");

      const result = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "ralph-loop",
      );

      expect(result.status).toBe("WORKING");
      expect(result.execution).toBeDefined();
      expect(result.execution?.workflowId).toBe("workflow_ralph_loop");
      expect(result.step).toBeDefined();
      expect(result.step?.type).toBe("iterate");
      expect(result.step?.signals).toContainEqual(
        expect.objectContaining({ name: "TASK_COMPLETE" }),
      );
      expect(result.step?.signals).toContainEqual(
        expect.objectContaining({ name: "NEEDS_REVIEW" }),
      );
    });

    test("throws error for non-existent workflow name", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      await expect(
        executionService.startWorkflow(testClient, "task-1", "repo-1", "non-existent"),
      ).rejects.toThrow('Workflow "non-existent" not found');
    });

    test("cancels existing active execution when starting new workflow for same task", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const firstResult = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const firstExecutionId = firstResult.execution?.id;
      const firstStepId = firstResult.step?.id;

      expect(firstExecutionId).toBeDefined();
      expect(firstStepId).toBeDefined();

      const secondResult = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const secondExecutionId = secondResult.execution?.id;

      expect(secondExecutionId).toBeDefined();
      expect(secondExecutionId).not.toBe(firstExecutionId);

      const firstExecution = await db
        .selectFrom("executions")
        .selectAll()
        .where("id", "=", firstExecutionId ?? "")
        .executeTakeFirst();
      expect(firstExecution?.status).toBe("cancelled");
      expect(firstExecution?.completed_at).not.toBeNull();

      const firstStep = await db
        .selectFrom("step_executions")
        .selectAll()
        .where("id", "=", firstStepId ?? "")
        .executeTakeFirst();
      expect(firstStep?.status).toBe("cancelled");
      expect(firstStep?.ended_at).not.toBeNull();

      const secondExecution = await db
        .selectFrom("executions")
        .selectAll()
        .where("id", "=", secondExecutionId ?? "")
        .executeTakeFirst();
      expect(secondExecution?.status).toBe("running");
    });
  });

  describe("startWorkflow with retryFromStep", () => {
    test("starts from specified step and preserves visited_steps from previous execution", async () => {
      const testClient = await setupTestData();
      await createReviewWorkflow(db);
      await createTestRepo(testClient.id, "repo-1");

      // First run: start from beginning, advance to implement step, then block
      const firstStart = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "review-test",
      );
      const executionId = firstStart.execution?.id ?? "";

      // Complete plan step with PLAN_APPROVED -> transitions to implement
      const advanceResult = await executionService.processStepResult(testClient, {
        stepId: firstStart.step?.id ?? "",
        executionId,
        attempt: 1,
        status: "success",
        signal: "PLAN_APPROVED",
        durationMs: 1000,
      });
      expect(advanceResult.step?.type).toBe("implement");

      // Implement fails -> BLOCKED
      await executionService.processStepResult(testClient, {
        stepId: advanceResult.step?.id ?? "",
        executionId,
        attempt: 1,
        status: "failure",
        durationMs: 1000,
      });

      // Retry from implement step
      const retryResult = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "review-test",
        "implement",
      );

      expect(retryResult.status).toBe("WORKING");
      expect(retryResult.step?.type).toBe("implement");

      const execution = await db
        .selectFrom("executions")
        .selectAll()
        .where("id", "=", retryResult.execution?.id ?? "")
        .executeTakeFirst();
      const visitedSteps = JSON.parse(execution?.visited_steps ?? "[]");
      expect(visitedSteps).toEqual(["plan", "implement"]);
    });

    test("starts from step with no previous execution", async () => {
      const testClient = await setupTestData();
      await createReviewWorkflow(db);
      await createTestRepo(testClient.id, "repo-1");

      const result = await executionService.startWorkflow(
        testClient,
        "task-new",
        "repo-1",
        "review-test",
        "implement",
      );

      expect(result.status).toBe("WORKING");
      expect(result.step?.type).toBe("implement");

      const execution = await db
        .selectFrom("executions")
        .selectAll()
        .where("id", "=", result.execution?.id ?? "")
        .executeTakeFirst();
      const visitedSteps = JSON.parse(execution?.visited_steps ?? "[]");
      expect(visitedSteps).toEqual(["implement"]);
      expect(execution?.iteration).toBe(0);
    });

    test("throws error for non-existent step in workflow", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      await expect(
        executionService.startWorkflow(
          testClient,
          "task-1",
          "repo-1",
          undefined,
          "nonexistent-step",
        ),
      ).rejects.toThrow('Step "nonexistent-step" not found in workflow');
    });

    test("preserves iteration from previous execution", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      // Start with aop-default workflow
      const firstStart = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const executionId = firstStart.execution?.id ?? "";

      // iterate -> ALL_TASKS_DONE -> full-review
      const reviewResult = await executionService.processStepResult(testClient, {
        stepId: firstStart.step?.id ?? "",
        executionId,
        attempt: 1,
        status: "success",
        signal: "ALL_TASKS_DONE",
        durationMs: 1000,
      });

      // full-review -> REVIEW_FAILED -> fix-issues
      const fixResult = await executionService.processStepResult(testClient, {
        stepId: reviewResult.step?.id ?? "",
        executionId,
        attempt: 1,
        status: "success",
        signal: "REVIEW_FAILED",
        durationMs: 1000,
      });

      // fix-issues -> FIX_COMPLETE -> quick-review
      const quickReviewResult = await executionService.processStepResult(testClient, {
        stepId: fixResult.step?.id ?? "",
        executionId,
        attempt: 1,
        status: "success",
        signal: "FIX_COMPLETE",
        durationMs: 1000,
      });

      // quick-review -> REVIEW_FAILED -> fix-issues (loops back, iteration increments)
      const fix2Result = await executionService.processStepResult(testClient, {
        stepId: quickReviewResult.step?.id ?? "",
        executionId,
        attempt: 1,
        status: "success",
        signal: "REVIEW_FAILED",
        durationMs: 1000,
      });

      // fix-issues fails -> BLOCKED
      await executionService.processStepResult(testClient, {
        stepId: fix2Result.step?.id ?? "",
        executionId,
        attempt: 1,
        status: "failure",
        durationMs: 1000,
      });

      // Verify the old execution has iteration > 0
      const oldExecution = await db
        .selectFrom("executions")
        .selectAll()
        .where("id", "=", executionId)
        .executeTakeFirst();
      expect(oldExecution?.iteration).toBeGreaterThan(0);

      // Retry from fix-issues — should preserve iteration
      const retryResult = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        undefined,
        "fix-issues",
      );

      const newExecution = await db
        .selectFrom("executions")
        .selectAll()
        .where("id", "=", retryResult.execution?.id ?? "")
        .executeTakeFirst();
      expect(newExecution?.iteration).toBe(oldExecution?.iteration);
    });
  });

  describe("stepId in step commands", () => {
    test("step command includes stepId matching the workflow step id", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const result = await executionService.startWorkflow(testClient, "task-1", "repo-1");

      expect(result.step?.stepId).toBe("iterate");
    });

    test("step command has correct stepId after transition", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const startResult = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const executionId = startResult.execution?.id ?? "";

      const reviewResult = await executionService.processStepResult(testClient, {
        stepId: startResult.step?.id ?? "",
        executionId,
        attempt: 1,
        status: "success",
        signal: "ALL_TASKS_DONE",
        durationMs: 1000,
      });

      expect(reviewResult.step?.stepId).toBe("full-review");
    });

    test("step_execution record has step_id set", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const result = await executionService.startWorkflow(testClient, "task-1", "repo-1");
      const stepExecutionId = result.step?.id;

      const stepExecution = await db
        .selectFrom("step_executions")
        .selectAll()
        .where("id", "=", stepExecutionId ?? "")
        .executeTakeFirst();

      expect(stepExecution?.step_id).toBe("iterate");
    });
  });

  describe("processStepResult", () => {
    test("marks task as DONE on success with terminal transition", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      // Use simple workflow which has direct success -> done transition
      const startResult = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "simple",
      );
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

      // Use simple workflow which has direct failure -> blocked transition
      const startResult = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "simple",
      );
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

      // Use simple workflow which has direct success -> done transition
      const startResult = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "simple",
      );
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

    test("marks task as PAUSED when step emits REQUIRES_INPUT", async () => {
      const testClient = await setupTestData();
      await createPausedWorkflow(db);
      await createTestRepo(testClient.id, "repo-1");

      const startResult = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "paused-test",
      );
      const stepId = startResult.step?.id;
      const executionId = startResult.execution?.id;

      expect(stepId).toBeDefined();
      expect(executionId).toBeDefined();

      const result = await executionService.processStepResult(testClient, {
        stepId: stepId ?? "",
        executionId: executionId ?? "",
        attempt: 1,
        status: "success",
        signal: "REQUIRES_INPUT",
        durationMs: 1000,
        pauseContext: "Need approval for implementation plan",
      });

      expect(result.taskStatus).toBe("PAUSED");
      expect(result.step).toBeNull();

      const task = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();
      expect(task?.status).toBe("PAUSED");

      const stepExecution = await db
        .selectFrom("step_executions")
        .selectAll()
        .where("id", "=", stepId ?? "")
        .executeTakeFirst();
      expect(stepExecution?.status).toBe("awaiting_input");
      expect(stepExecution?.pause_context).toBe("Need approval for implementation plan");
    });
  });

  describe("resumeStep", () => {
    test("creates new step execution with input and transitions task to WORKING", async () => {
      const testClient = await setupTestData();
      await createPausedWorkflow(db);
      await createTestRepo(testClient.id, "repo-1");

      const startResult = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "paused-test",
      );

      // Pause the workflow
      await executionService.processStepResult(testClient, {
        stepId: startResult.step?.id ?? "",
        executionId: startResult.execution?.id ?? "",
        attempt: 1,
        status: "success",
        signal: "REQUIRES_INPUT",
        durationMs: 1000,
      });

      // Resume the workflow
      const resumeResult = await executionService.resumeStep(testClient, {
        stepId: startResult.step?.id ?? "",
        input: "Approved, proceed with the plan",
      });

      expect(resumeResult.taskStatus).toBe("WORKING");
      expect(resumeResult.step).toBeDefined();
      expect(resumeResult.step?.input).toBe("Approved, proceed with the plan");
      expect(resumeResult.step?.type).toBe("iterate");

      const task = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();
      expect(task?.status).toBe("WORKING");
    });

    test("throws error when step is not awaiting input", async () => {
      const testClient = await setupTestData();
      await createTestRepo(testClient.id, "repo-1");

      const startResult = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "simple",
      );

      await expect(
        executionService.resumeStep(testClient, {
          stepId: startResult.step?.id ?? "",
          input: "some input",
        }),
      ).rejects.toThrow("not awaiting input");
    });

    test("throws error for non-existent step", async () => {
      const testClient = await setupTestData();

      await expect(
        executionService.resumeStep(testClient, {
          stepId: "non-existent",
          input: "some input",
        }),
      ).rejects.toThrow("Step execution");
    });
  });

  describe("review workflow E2E", () => {
    test("1 request-changes round then approval advances workflow", async () => {
      const testClient = await setupTestData();
      await createReviewWorkflow(db);
      await createTestRepo(testClient.id, "repo-1");

      // 1. Start workflow → get initial step (plan step)
      const startResult = await executionService.startWorkflow(
        testClient,
        "task-1",
        "repo-1",
        "review-test",
      );
      expect(startResult.status).toBe("WORKING");
      expect(startResult.step?.type).toBe("iterate");
      const planStepId1 = startResult.step?.id ?? "";
      const executionId = startResult.execution?.id ?? "";

      // 2. Agent emits PLAN_READY → task PAUSED, step awaiting_input
      const pauseResult1 = await executionService.processStepResult(testClient, {
        stepId: planStepId1,
        executionId,
        attempt: 1,
        status: "success",
        signal: "PLAN_READY",
        durationMs: 1000,
        pauseContext: "## Plan v1\n- Step 1: Do X\n- Step 2: Do Y",
      });

      expect(pauseResult1.taskStatus).toBe("PAUSED");
      expect(pauseResult1.step).toBeNull();

      const task1 = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();
      expect(task1?.status).toBe("PAUSED");

      const step1 = await db
        .selectFrom("step_executions")
        .selectAll()
        .where("id", "=", planStepId1)
        .executeTakeFirst();
      expect(step1?.status).toBe("awaiting_input");
      expect(step1?.pause_context).toBe("## Plan v1\n- Step 1: Do X\n- Step 2: Do Y");

      // 3. Human requests changes → resume with feedback, same step re-runs
      const resumeResult1 = await executionService.resumeStep(testClient, {
        stepId: planStepId1,
        input: "Change X to use approach B instead",
      });

      expect(resumeResult1.taskStatus).toBe("WORKING");
      expect(resumeResult1.step).toBeDefined();
      expect(resumeResult1.step?.type).toBe("iterate");
      expect(resumeResult1.step?.input).toBe("Change X to use approach B instead");
      const planStepId2 = resumeResult1.step?.id ?? "";

      // 4. Agent revises plan, emits PLAN_READY again → task PAUSED again
      const pauseResult2 = await executionService.processStepResult(testClient, {
        stepId: planStepId2,
        executionId,
        attempt: 1,
        status: "success",
        signal: "PLAN_READY",
        durationMs: 1500,
        pauseContext: "## Plan v2\n- Step 1: Do B\n- Step 2: Do Y",
      });

      expect(pauseResult2.taskStatus).toBe("PAUSED");
      expect(pauseResult2.step).toBeNull();

      const task2 = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();
      expect(task2?.status).toBe("PAUSED");

      // 5. Human approves → resume, same step re-runs with approval input
      const resumeResult2 = await executionService.resumeStep(testClient, {
        stepId: planStepId2,
        input: "Approved. Proceed with the plan.",
      });

      expect(resumeResult2.taskStatus).toBe("WORKING");
      expect(resumeResult2.step).toBeDefined();
      expect(resumeResult2.step?.type).toBe("iterate");
      expect(resumeResult2.step?.input).toBe("Approved. Proceed with the plan.");
      const planStepId3 = resumeResult2.step?.id ?? "";

      // 6. Agent sees approval, emits PLAN_APPROVED → advances to implement step
      const advanceResult = await executionService.processStepResult(testClient, {
        stepId: planStepId3,
        executionId,
        attempt: 1,
        status: "success",
        signal: "PLAN_APPROVED",
        durationMs: 500,
      });

      expect(advanceResult.taskStatus).toBe("WORKING");
      expect(advanceResult.step).toBeDefined();
      expect(advanceResult.step?.type).toBe("implement");

      const task3 = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();
      expect(task3?.status).toBe("WORKING");

      // 7. Implement step completes → task DONE
      const doneResult = await executionService.processStepResult(testClient, {
        stepId: advanceResult.step?.id ?? "",
        executionId,
        attempt: 1,
        status: "success",
        durationMs: 5000,
      });

      expect(doneResult.taskStatus).toBe("DONE");
      expect(doneResult.step).toBeNull();

      const taskFinal = await db
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", "task-1")
        .executeTakeFirst();
      expect(taskFinal?.status).toBe("DONE");
    });
  });
});
