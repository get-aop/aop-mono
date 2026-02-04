import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createExecutionRepository } from "./execution-repository.ts";

describe("ExecutionRepository", () => {
  let db: Kysely<Database>;
  let repo: ReturnType<typeof createExecutionRepository>;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createExecutionRepository(db);
    await createTestRepo(db, "repo-1", "/path/to/repo");
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("createExecution", () => {
    test("creates an execution", async () => {
      const execution = await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      expect(execution.id).toBe("exec-1");
      expect(execution.task_id).toBe("task-1");
      expect(execution.status).toBe("running");
      expect(execution.started_at).toBe("2024-01-01T00:00:00Z");
      expect(execution.completed_at).toBeNull();
    });
  });

  describe("getExecution", () => {
    test("returns execution by ID", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      const execution = await repo.getExecution("exec-1");

      expect(execution).not.toBeNull();
      expect(execution?.id).toBe("exec-1");
    });

    test("returns null when execution not found", async () => {
      const execution = await repo.getExecution("non-existent");

      expect(execution).toBeNull();
    });
  });

  describe("updateExecution", () => {
    test("updates execution fields", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      const updated = await repo.updateExecution("exec-1", {
        status: "completed",
        completed_at: "2024-01-01T01:00:00Z",
      });

      expect(updated?.status).toBe("completed");
      expect(updated?.completed_at).toBe("2024-01-01T01:00:00Z");
    });

    test("returns null when execution not found", async () => {
      const updated = await repo.updateExecution("non-existent", {
        status: "completed",
      });

      expect(updated).toBeNull();
    });
  });

  describe("getExecutionsByTaskId", () => {
    test("returns executions for task ordered by started_at desc", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "completed",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createExecution({
        id: "exec-2",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-02T00:00:00Z",
      });

      const executions = await repo.getExecutionsByTaskId("task-1");

      expect(executions).toHaveLength(2);
      expect(executions[0]?.id).toBe("exec-2");
      expect(executions[1]?.id).toBe("exec-1");
    });

    test("returns empty array when no executions", async () => {
      const executions = await repo.getExecutionsByTaskId("task-1");

      expect(executions).toEqual([]);
    });
  });

  describe("createStepExecution", () => {
    test("creates a step execution", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      const step = await repo.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
        agent_pid: 12345,
        session_id: "session-1",
      });

      expect(step.id).toBe("step-1");
      expect(step.execution_id).toBe("exec-1");
      expect(step.status).toBe("running");
      expect(step.agent_pid).toBe(12345);
      expect(step.session_id).toBe("session-1");
    });
  });

  describe("getStepExecution", () => {
    test("returns step execution by ID", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      const step = await repo.getStepExecution("step-1");

      expect(step).not.toBeNull();
      expect(step?.id).toBe("step-1");
    });

    test("returns null when step not found", async () => {
      const step = await repo.getStepExecution("non-existent");

      expect(step).toBeNull();
    });
  });

  describe("updateStepExecution", () => {
    test("updates step execution fields", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      const updated = await repo.updateStepExecution("step-1", {
        status: "success",
        ended_at: "2024-01-01T01:00:00Z",
        exit_code: 0,
      });

      expect(updated?.status).toBe("success");
      expect(updated?.ended_at).toBe("2024-01-01T01:00:00Z");
      expect(updated?.exit_code).toBe(0);
    });

    test("returns null when step not found", async () => {
      const updated = await repo.updateStepExecution("non-existent", {
        status: "success",
      });

      expect(updated).toBeNull();
    });
  });

  describe("getStepExecutionsByExecutionId", () => {
    test("returns steps ordered by started_at asc", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "success",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-2",
        execution_id: "exec-1",
        status: "running",
        started_at: "2024-01-01T01:00:00Z",
      });

      const steps = await repo.getStepExecutionsByExecutionId("exec-1");

      expect(steps).toHaveLength(2);
      expect(steps[0]?.id).toBe("step-1");
      expect(steps[1]?.id).toBe("step-2");
    });

    test("returns empty array when no steps", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      const steps = await repo.getStepExecutionsByExecutionId("exec-1");

      expect(steps).toEqual([]);
    });
  });

  describe("getLatestStepExecution", () => {
    test("returns latest step for task across all executions", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "completed",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "success",
        started_at: "2024-01-01T00:00:00Z",
      });

      await repo.createExecution({
        id: "exec-2",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-02T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-2",
        execution_id: "exec-2",
        status: "running",
        started_at: "2024-01-02T00:00:00Z",
        agent_pid: 99999,
      });

      const latest = await repo.getLatestStepExecution("task-1");

      expect(latest).not.toBeNull();
      expect(latest?.id).toBe("step-2");
      expect(latest?.agent_pid).toBe(99999);
    });

    test("returns null when no steps for task", async () => {
      const latest = await repo.getLatestStepExecution("task-1");

      expect(latest).toBeNull();
    });
  });

  describe("cancelRunningExecutions", () => {
    test("cancels all running executions", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createExecution({
        id: "exec-2",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-02T00:00:00Z",
      });

      const count = await repo.cancelRunningExecutions();

      expect(count).toBe(2);

      const exec1 = await repo.getExecution("exec-1");
      const exec2 = await repo.getExecution("exec-2");
      expect(exec1?.status).toBe("cancelled");
      expect(exec1?.completed_at).not.toBeNull();
      expect(exec2?.status).toBe("cancelled");
      expect(exec2?.completed_at).not.toBeNull();
    });

    test("only cancels running executions, not completed ones", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "completed",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createExecution({
        id: "exec-2",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-02T00:00:00Z",
      });

      const count = await repo.cancelRunningExecutions();

      expect(count).toBe(1);

      const exec1 = await repo.getExecution("exec-1");
      const exec2 = await repo.getExecution("exec-2");
      expect(exec1?.status).toBe("completed");
      expect(exec2?.status).toBe("cancelled");
    });

    test("returns 0 when no running executions", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "completed",
        started_at: "2024-01-01T00:00:00Z",
      });

      const count = await repo.cancelRunningExecutions();

      expect(count).toBe(0);
    });
  });

  describe("cancelRunningStepExecutions", () => {
    test("cancels all running step executions", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-2",
        execution_id: "exec-1",
        status: "running",
        started_at: "2024-01-01T01:00:00Z",
      });

      const count = await repo.cancelRunningStepExecutions();

      expect(count).toBe(2);

      const step1 = await repo.getStepExecution("step-1");
      const step2 = await repo.getStepExecution("step-2");
      expect(step1?.status).toBe("cancelled");
      expect(step1?.ended_at).not.toBeNull();
      expect(step2?.status).toBe("cancelled");
      expect(step2?.ended_at).not.toBeNull();
    });

    test("only cancels running steps, not completed ones", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "success",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-2",
        execution_id: "exec-1",
        status: "running",
        started_at: "2024-01-01T01:00:00Z",
      });

      const count = await repo.cancelRunningStepExecutions();

      expect(count).toBe(1);

      const step1 = await repo.getStepExecution("step-1");
      const step2 = await repo.getStepExecution("step-2");
      expect(step1?.status).toBe("success");
      expect(step2?.status).toBe("cancelled");
    });

    test("returns 0 when no running steps", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: "success",
        started_at: "2024-01-01T00:00:00Z",
      });

      const count = await repo.cancelRunningStepExecutions();

      expect(count).toBe(0);
    });
  });

  describe("saveExecutionLogs", () => {
    test("saves execution logs to database", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      await repo.saveExecutionLogs([
        {
          execution_id: "exec-1",
          stream: "stdout",
          content: "line 1",
          timestamp: "2024-01-01T00:00:01Z",
        },
        {
          execution_id: "exec-1",
          stream: "stderr",
          content: "error 1",
          timestamp: "2024-01-01T00:00:02Z",
        },
        {
          execution_id: "exec-1",
          stream: "stdout",
          content: "line 2",
          timestamp: "2024-01-01T00:00:03Z",
        },
      ]);

      const logs = await repo.getExecutionLogs("exec-1");
      expect(logs).toHaveLength(3);
      expect(logs[0]?.content).toBe("line 1");
      expect(logs[0]?.stream).toBe("stdout");
      expect(logs[1]?.content).toBe("error 1");
      expect(logs[1]?.stream).toBe("stderr");
      expect(logs[2]?.content).toBe("line 2");
    });

    test("does nothing when logs array is empty", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      await repo.saveExecutionLogs([]);

      const logs = await repo.getExecutionLogs("exec-1");
      expect(logs).toEqual([]);
    });
  });

  describe("getExecutionLogs", () => {
    test("returns logs in order by id", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: "2024-01-01T00:00:00Z",
      });

      await repo.saveExecutionLogs([
        {
          execution_id: "exec-1",
          stream: "stdout",
          content: "first",
          timestamp: "2024-01-01T00:00:01Z",
        },
        {
          execution_id: "exec-1",
          stream: "stdout",
          content: "second",
          timestamp: "2024-01-01T00:00:02Z",
        },
      ]);

      const logs = await repo.getExecutionLogs("exec-1");
      expect(logs[0]?.content).toBe("first");
      expect(logs[1]?.content).toBe("second");
    });

    test("returns empty array for unknown execution", async () => {
      const logs = await repo.getExecutionLogs("non-existent");
      expect(logs).toEqual([]);
    });

    test("only returns logs for specified execution", async () => {
      await repo.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "completed",
        started_at: "2024-01-01T00:00:00Z",
      });
      await repo.createExecution({
        id: "exec-2",
        task_id: "task-1",
        status: "completed",
        started_at: "2024-01-02T00:00:00Z",
      });

      await repo.saveExecutionLogs([
        {
          execution_id: "exec-1",
          stream: "stdout",
          content: "exec1-log",
          timestamp: "2024-01-01T00:00:01Z",
        },
        {
          execution_id: "exec-2",
          stream: "stdout",
          content: "exec2-log",
          timestamp: "2024-01-02T00:00:01Z",
        },
      ]);

      const logs1 = await repo.getExecutionLogs("exec-1");
      const logs2 = await repo.getExecutionLogs("exec-2");

      expect(logs1).toHaveLength(1);
      expect(logs1[0]?.content).toBe("exec1-log");
      expect(logs2).toHaveLength(1);
      expect(logs2[0]?.content).toBe("exec2-log");
    });
  });
});
