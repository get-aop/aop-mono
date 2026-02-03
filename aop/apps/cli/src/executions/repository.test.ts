import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createExecutionRepository, type ExecutionRepository } from "./repository.ts";
import { ExecutionStatus, StepExecutionStatus } from "./types.ts";

describe("ExecutionRepository", () => {
  let db: Kysely<Database>;
  let repository: ExecutionRepository;
  const repoId = "repo_test123";
  const taskId = "task_abc123";

  beforeEach(async () => {
    db = await createTestDb();
    repository = createExecutionRepository(db);
    await createTestRepo(db, repoId, "/test/repo");
    await createTestTask(db, taskId, repoId, "test-change");
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("createExecution", () => {
    test("creates execution with running status", async () => {
      const execId = "exec_test001";
      const startedAt = new Date().toISOString();

      const execution = await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      expect(execution.id).toBe(execId);
      expect(execution.task_id).toBe(taskId);
      expect(execution.status).toBe(ExecutionStatus.RUNNING);
      expect(execution.started_at).toBe(startedAt);
      expect(execution.completed_at).toBeNull();
    });
  });

  describe("getExecution", () => {
    test("returns execution by id", async () => {
      const execId = "exec_test002";
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      const execution = await repository.getExecution(execId);

      expect(execution).not.toBeNull();
      expect(execution?.id).toBe(execId);
    });

    test("returns null for non-existent execution", async () => {
      const execution = await repository.getExecution("exec_nonexistent");
      expect(execution).toBeNull();
    });
  });

  describe("updateExecution", () => {
    test("updates execution status to completed", async () => {
      const execId = "exec_test003";
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      const completedAt = new Date().toISOString();
      const updated = await repository.updateExecution(execId, {
        status: ExecutionStatus.COMPLETED,
        completed_at: completedAt,
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe(ExecutionStatus.COMPLETED);
      expect(updated?.completed_at).toBe(completedAt);
    });

    test("returns null for non-existent execution", async () => {
      const updated = await repository.updateExecution("exec_nonexistent", {
        status: ExecutionStatus.FAILED,
      });
      expect(updated).toBeNull();
    });
  });

  describe("getExecutionsByTaskId", () => {
    test("returns all executions for a task", async () => {
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: "exec_first",
        task_id: taskId,
        status: ExecutionStatus.FAILED,
        started_at: startedAt,
        completed_at: startedAt,
      });

      await repository.createExecution({
        id: "exec_second",
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      const executions = await repository.getExecutionsByTaskId(taskId);

      expect(executions).toHaveLength(2);
    });

    test("returns empty array for task with no executions", async () => {
      const executions = await repository.getExecutionsByTaskId("task_noexec");
      expect(executions).toHaveLength(0);
    });
  });

  describe("createStepExecution", () => {
    test("creates step execution with running status", async () => {
      const execId = "exec_step001";
      const stepId = "step_test001";
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      const step = await repository.createStepExecution({
        id: stepId,
        execution_id: execId,
        status: StepExecutionStatus.RUNNING,
        started_at: startedAt,
        agent_pid: null,
        session_id: null,
        exit_code: null,
        error: null,
        ended_at: null,
      });

      expect(step.id).toBe(stepId);
      expect(step.execution_id).toBe(execId);
      expect(step.status).toBe(StepExecutionStatus.RUNNING);
    });
  });

  describe("getStepExecution", () => {
    test("returns step execution by id", async () => {
      const execId = "exec_step002";
      const stepId = "step_test002";
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      await repository.createStepExecution({
        id: stepId,
        execution_id: execId,
        status: StepExecutionStatus.RUNNING,
        started_at: startedAt,
        agent_pid: null,
        session_id: null,
        exit_code: null,
        error: null,
        ended_at: null,
      });

      const step = await repository.getStepExecution(stepId);

      expect(step).not.toBeNull();
      expect(step?.id).toBe(stepId);
    });
  });

  describe("updateStepExecution", () => {
    test("updates step with agent_pid and session_id", async () => {
      const execId = "exec_step003";
      const stepId = "step_test003";
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      await repository.createStepExecution({
        id: stepId,
        execution_id: execId,
        status: StepExecutionStatus.RUNNING,
        started_at: startedAt,
        agent_pid: null,
        session_id: null,
        exit_code: null,
        error: null,
        ended_at: null,
      });

      const updated = await repository.updateStepExecution(stepId, {
        agent_pid: 12345,
        session_id: "session_abc",
      });

      expect(updated).not.toBeNull();
      expect(updated?.agent_pid).toBe(12345);
      expect(updated?.session_id).toBe("session_abc");
    });

    test("updates step with exit_code and status on completion", async () => {
      const execId = "exec_step004";
      const stepId = "step_test004";
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      await repository.createStepExecution({
        id: stepId,
        execution_id: execId,
        status: StepExecutionStatus.RUNNING,
        started_at: startedAt,
        agent_pid: 12345,
        session_id: null,
        exit_code: null,
        error: null,
        ended_at: null,
      });

      const endedAt = new Date().toISOString();
      const updated = await repository.updateStepExecution(stepId, {
        status: StepExecutionStatus.SUCCESS,
        exit_code: 0,
        ended_at: endedAt,
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe(StepExecutionStatus.SUCCESS);
      expect(updated?.exit_code).toBe(0);
      expect(updated?.ended_at).toBe(endedAt);
    });

    test("updates step with error on failure", async () => {
      const execId = "exec_step005";
      const stepId = "step_test005";
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      await repository.createStepExecution({
        id: stepId,
        execution_id: execId,
        status: StepExecutionStatus.RUNNING,
        started_at: startedAt,
        agent_pid: 12345,
        session_id: null,
        exit_code: null,
        error: null,
        ended_at: null,
      });

      const updated = await repository.updateStepExecution(stepId, {
        status: StepExecutionStatus.FAILURE,
        exit_code: 1,
        error: "Agent crashed",
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe(StepExecutionStatus.FAILURE);
      expect(updated?.exit_code).toBe(1);
      expect(updated?.error).toBe("Agent crashed");
    });
  });

  describe("getLatestStepExecution", () => {
    test("returns latest step execution for a task", async () => {
      const execId = "exec_latest001";
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      await repository.createStepExecution({
        id: "step_old",
        execution_id: execId,
        status: StepExecutionStatus.FAILURE,
        started_at: "2024-01-01T00:00:00.000Z",
        agent_pid: 111,
        session_id: null,
        exit_code: 1,
        error: null,
        ended_at: "2024-01-01T00:01:00.000Z",
      });

      await repository.createStepExecution({
        id: "step_new",
        execution_id: execId,
        status: StepExecutionStatus.RUNNING,
        started_at: "2024-01-02T00:00:00.000Z",
        agent_pid: 222,
        session_id: null,
        exit_code: null,
        error: null,
        ended_at: null,
      });

      const latest = await repository.getLatestStepExecution(taskId);

      expect(latest).not.toBeNull();
      expect(latest?.id).toBe("step_new");
      expect(latest?.agent_pid).toBe(222);
    });

    test("returns null for task with no executions", async () => {
      const latest = await repository.getLatestStepExecution("task_nosteps");
      expect(latest).toBeNull();
    });
  });

  describe("getStepExecutionsByExecutionId", () => {
    test("returns all steps for an execution", async () => {
      const execId = "exec_steps001";
      const startedAt = new Date().toISOString();

      await repository.createExecution({
        id: execId,
        task_id: taskId,
        status: ExecutionStatus.RUNNING,
        started_at: startedAt,
        completed_at: null,
      });

      await repository.createStepExecution({
        id: "step_a",
        execution_id: execId,
        status: StepExecutionStatus.SUCCESS,
        started_at: startedAt,
        agent_pid: null,
        session_id: null,
        exit_code: 0,
        error: null,
        ended_at: startedAt,
      });

      await repository.createStepExecution({
        id: "step_b",
        execution_id: execId,
        status: StepExecutionStatus.RUNNING,
        started_at: startedAt,
        agent_pid: null,
        session_id: null,
        exit_code: null,
        error: null,
        ended_at: null,
      });

      const steps = await repository.getStepExecutionsByExecutionId(execId);

      expect(steps).toHaveLength(2);
    });
  });
});
