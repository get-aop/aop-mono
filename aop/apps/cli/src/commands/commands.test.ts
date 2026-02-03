import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import type { Database } from "../db/index.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus, StepExecutionStatus } from "../executions/types.ts";
import { isValidSettingKey } from "../settings/types.ts";

describe("Setting Key Validation", () => {
  test("accepts valid setting keys", () => {
    expect(isValidSettingKey("max_concurrent_tasks")).toBe(true);
    expect(isValidSettingKey("watcher_poll_interval_secs")).toBe(true);
  });

  test("rejects invalid setting keys", () => {
    expect(isValidSettingKey("invalid_key")).toBe(false);
    expect(isValidSettingKey("")).toBe(false);
  });
});

describe("Abort Task Integration", () => {
  let db: Kysely<Database>;
  let ctx: CommandContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/test/repo");
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("execution status on abort", () => {
    test("updates execution status to ABORTED", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");

      const now = new Date().toISOString();
      const execId = "exec_abort_test";

      await ctx.executionRepository.createExecution({
        id: execId,
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: now,
      });

      await ctx.executionRepository.updateExecution(execId, {
        status: ExecutionStatus.ABORTED,
        completed_at: now,
      });

      const exec = await ctx.executionRepository.getExecution(execId);
      expect(exec?.status).toBe(ExecutionStatus.ABORTED);
    });

    test("step execution marked as failure on abort", async () => {
      await createTestTask(db, "task-1", "repo-1", "changes/feature-a", "WORKING");

      const now = new Date().toISOString();
      const execId = "exec_step_abort";
      const stepId = "step_abort_test";

      await ctx.executionRepository.createExecution({
        id: execId,
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: now,
      });

      await ctx.executionRepository.createStepExecution({
        id: stepId,
        execution_id: execId,
        status: StepExecutionStatus.RUNNING,
        started_at: now,
      });

      await ctx.executionRepository.updateStepExecution(stepId, {
        status: StepExecutionStatus.FAILURE,
        error: "Aborted",
        ended_at: now,
      });

      const step = await ctx.executionRepository.getStepExecution(stepId);
      expect(step?.status).toBe(StepExecutionStatus.FAILURE);
      expect(step?.error).toBe("Aborted");
    });
  });
});
