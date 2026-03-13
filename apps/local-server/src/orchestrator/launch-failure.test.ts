import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../db/test-utils.ts";
import { createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createExecutionRepository } from "../executor/execution-repository.ts";
import { finalizeLaunchFailure } from "./launch-failure.ts";

describe("finalizeLaunchFailure", () => {
  test("marks the step and execution as failed before reverting the task", async () => {
    const db = await createTestDb();
    const repoPath = join(tmpdir(), `aop-launch-failure-${Date.now()}`);
    await createTestRepo(db, "repo-1", repoPath);
    await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

    const executionRepository = createExecutionRepository(db);

    await executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      workflow_id: "aop-default",
      status: "running",
      visited_steps: JSON.stringify(["iterate"]),
      iteration: 0,
      started_at: "2026-03-13T18:00:00.000Z",
      completed_at: null,
    });
    await executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      step_id: "iterate",
      step_type: "iterate",
      status: "running",
      started_at: "2026-03-13T18:00:00.000Z",
      ended_at: null,
      error: null,
      agent_pid: null,
      session_id: null,
      exit_code: null,
      signal: null,
      pause_context: null,
      attempt: 1,
      iteration: 0,
      signals_json: null,
    });

    const revertedStatuses: Array<{ taskId: string; status: "READY" | "BLOCKED" }> = [];

    await finalizeLaunchFailure({
      executionRepository,
      taskRepository: {
        update: async (taskId, updates) => {
          revertedStatuses.push({
            taskId,
            status: updates.status as "READY" | "BLOCKED",
          });
          return null;
        },
      },
      taskId: "task-1",
      stepExecutionId: "step-1",
      executionId: "exec-1",
      revertStatus: "READY",
      error: new Error("spawn failed"),
    });

    expect(revertedStatuses).toEqual([{ taskId: "task-1", status: "READY" }]);

    const execution = await executionRepository.getExecution("exec-1");
    expect(execution?.status).toBe("failed");
    expect(execution?.completed_at).not.toBeNull();

    const step = await executionRepository.getStepExecution("step-1");
    expect(step?.status).toBe("failure");
    expect(step?.error).toContain("spawn failed");
    expect(step?.ended_at).not.toBeNull();

    await db.destroy();
  });
});
