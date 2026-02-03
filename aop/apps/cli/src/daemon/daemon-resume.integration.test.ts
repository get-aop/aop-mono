import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createExecutionRepository } from "../executions/repository.ts";
import { ExecutionStatus, StepExecutionStatus } from "../executions/types.ts";
import { createTaskRepository, type TaskRepository } from "../tasks/repository.ts";
import { TaskStatus } from "../tasks/types.ts";
import { isProcessAlive } from "./daemon.ts";

describe("Daemon Restart → Resume Flow Integration", () => {
  let db: Kysely<Database>;
  let taskRepository: TaskRepository;
  let testDir: string;
  let changesDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    taskRepository = createTaskRepository(db);

    testDir = join(
      tmpdir(),
      `daemon-resume-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    changesDir = join(testDir, "openspec/changes");
    mkdirSync(changesDir, { recursive: true });

    await createTestRepo(db, "repo-1", testDir);
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(testDir, { recursive: true, force: true });
  });

  test("detects WORKING tasks without running agents for resume", async () => {
    const changePath = join(changesDir, "feature-orphaned");
    mkdirSync(changePath, { recursive: true });

    await createTestTask(db, "task-orphan", "repo-1", changePath, "WORKING");

    const executionRepository = createExecutionRepository(db);
    const execId = `exec_orphan_${Date.now()}`;
    const stepId = `step_orphan_${Date.now()}`;

    await executionRepository.createExecution({
      id: execId,
      task_id: "task-orphan",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    await executionRepository.createStepExecution({
      id: stepId,
      execution_id: execId,
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: 999999999,
    });

    const workingTasks = await taskRepository.list({ status: TaskStatus.WORKING });
    expect(workingTasks).toHaveLength(1);
    expect(workingTasks[0]?.id).toBe("task-orphan");

    const latestStep = await executionRepository.getLatestStepExecution("task-orphan");
    expect(latestStep).not.toBeNull();
    expect(latestStep?.agent_pid).toBe(999999999);
  });

  test("finds WORKING tasks with null agent_pid for resume", async () => {
    const changePath = join(changesDir, "feature-no-agent");
    mkdirSync(changePath, { recursive: true });

    await createTestTask(db, "task-no-agent", "repo-1", changePath, "WORKING");

    const executionRepository = createExecutionRepository(db);
    const execId = `exec_no_agent_${Date.now()}`;
    const stepId = `step_no_agent_${Date.now()}`;

    await executionRepository.createExecution({
      id: execId,
      task_id: "task-no-agent",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    await executionRepository.createStepExecution({
      id: stepId,
      execution_id: execId,
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    const workingTasks = await taskRepository.list({ status: TaskStatus.WORKING });
    expect(workingTasks).toHaveLength(1);
    expect(workingTasks[0]?.id).toBe("task-no-agent");

    const latestStep = await executionRepository.getLatestStepExecution("task-no-agent");
    expect(latestStep?.agent_pid).toBeNull();
  });

  test("simulates daemon resume: collects tasks to re-execute", async () => {
    for (let i = 1; i <= 3; i++) {
      const changePath = join(changesDir, `feature-resume-${i}`);
      mkdirSync(changePath, { recursive: true });
      await createTestTask(db, `task-resume-${i}`, "repo-1", changePath, "WORKING");
    }

    const executionRepository = createExecutionRepository(db);
    const tasksToResume: Task[] = [];

    const workingTasks = await taskRepository.list({ status: TaskStatus.WORKING });
    expect(workingTasks).toHaveLength(3);

    for (const task of workingTasks) {
      const step = await executionRepository.getLatestStepExecution(task.id);

      const hasRunningAgent = step?.agent_pid != null && isProcessAlive(step.agent_pid);

      if (!hasRunningAgent) {
        tasksToResume.push(task);
      }
    }

    expect(tasksToResume).toHaveLength(3);
    expect(tasksToResume.map((t) => t.id).sort()).toEqual([
      "task-resume-1",
      "task-resume-2",
      "task-resume-3",
    ]);
  });

  test("does not re-execute task if agent is still alive", async () => {
    const changePath = join(changesDir, "feature-alive");
    mkdirSync(changePath, { recursive: true });

    await createTestTask(db, "task-alive", "repo-1", changePath, "WORKING");

    const executionRepository = createExecutionRepository(db);
    const execId = `exec_alive_${Date.now()}`;
    const stepId = `step_alive_${Date.now()}`;

    await executionRepository.createExecution({
      id: execId,
      task_id: "task-alive",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    await executionRepository.createStepExecution({
      id: stepId,
      execution_id: execId,
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: process.pid,
    });

    const tasksToResume: Task[] = [];

    const workingTasks = await taskRepository.list({ status: TaskStatus.WORKING });

    for (const task of workingTasks) {
      const step = await executionRepository.getLatestStepExecution(task.id);
      const hasRunningAgent = step?.agent_pid != null && isProcessAlive(step.agent_pid);

      if (!hasRunningAgent) {
        tasksToResume.push(task);
      }
    }

    expect(tasksToResume).toHaveLength(0);
  });

  test("mixed scenario: some agents alive, some dead", async () => {
    const executionRepository = createExecutionRepository(db);

    const alive = join(changesDir, "feature-alive-mixed");
    mkdirSync(alive, { recursive: true });
    await createTestTask(db, "task-mixed-alive", "repo-1", alive, "WORKING");

    const execAlive = `exec_mixed_alive_${Date.now()}`;
    await executionRepository.createExecution({
      id: execAlive,
      task_id: "task-mixed-alive",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });
    await executionRepository.createStepExecution({
      id: `step_mixed_alive_${Date.now()}`,
      execution_id: execAlive,
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: process.pid,
    });

    const dead = join(changesDir, "feature-dead-mixed");
    mkdirSync(dead, { recursive: true });
    await createTestTask(db, "task-mixed-dead", "repo-1", dead, "WORKING");

    const execDead = `exec_mixed_dead_${Date.now()}`;
    await executionRepository.createExecution({
      id: execDead,
      task_id: "task-mixed-dead",
      status: ExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });
    await executionRepository.createStepExecution({
      id: `step_mixed_dead_${Date.now()}`,
      execution_id: execDead,
      status: StepExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
      agent_pid: 999999999,
    });

    const noStep = join(changesDir, "feature-no-step");
    mkdirSync(noStep, { recursive: true });
    await createTestTask(db, "task-no-step", "repo-1", noStep, "WORKING");

    const tasksToResume: Task[] = [];
    const workingTasks = await taskRepository.list({ status: TaskStatus.WORKING });

    for (const task of workingTasks) {
      const step = await executionRepository.getLatestStepExecution(task.id);
      const hasRunningAgent = step?.agent_pid != null && isProcessAlive(step.agent_pid);

      if (!hasRunningAgent) {
        tasksToResume.push(task);
      }
    }

    expect(tasksToResume).toHaveLength(2);
    const resumeIds = tasksToResume.map((t) => t.id).sort();
    expect(resumeIds).toContain("task-mixed-dead");
    expect(resumeIds).toContain("task-no-step");
    expect(resumeIds).not.toContain("task-mixed-alive");
  });
});
