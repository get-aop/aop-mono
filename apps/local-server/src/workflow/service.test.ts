import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import type { WorkflowDefinition } from "../workflow-engine/types.ts";

describe("LocalWorkflowService", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("syncs built-in workflows into the local database on first use", async () => {
    const workflows = await ctx.workflowService.listWorkflows();

    expect(workflows).toContain("aop-default");
    expect(workflows).toContain("simple");

    const persisted = await ctx.workflowRepository.findByName("aop-default");
    expect(persisted).not.toBeNull();

    const definition = persisted ? JSON.parse(persisted.definition) : null;
    expect(definition?.name).toBe("aop-default");
    expect(definition?.initialStep).toBe("iterate");
  });

  test("starts the preferred workflow and records a running step execution", async () => {
    const task = await createRepoTask("task-start", "simple");

    const result = await ctx.workflowService.startTask(task);

    expect(result.status).toBe("WORKING");
    expect(result.execution).toEqual({
      id: expect.any(String),
      workflowId: "simple",
    });
    expect(result.step?.stepId).toBe("implement");
    expect(result.step?.promptTemplate).toContain("You are");

    const execution = await ctx.executionRepository.getExecution(result.execution!.id);
    expect(execution?.visited_steps).toBe(JSON.stringify(["implement"]));
    expect(execution?.iteration).toBe(0);

    const steps = await ctx.executionRepository.getStepExecutionsByExecutionId(
      result.execution!.id,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual(
      expect.objectContaining({
        step_id: "implement",
        status: "running",
        attempt: 1,
        iteration: 0,
      }),
    );
  });

  test("starts from retry_from_step using the previously visited path", async () => {
    const task = await createRepoTask("task-retry", "aop-default");
    await ctx.taskRepository.update(task.id, { retry_from_step: "full-review" });
    await ctx.executionRepository.createExecution({
      id: "exec-old",
      task_id: task.id,
      workflow_id: "aop-default",
      status: "running",
      visited_steps: JSON.stringify(["iterate", "full-review", "fix-issues"]),
      iteration: 2,
      started_at: new Date("2026-03-09T00:00:00.000Z").toISOString(),
    });

    const updatedTask = await getTask(task.id);
    const result = await ctx.workflowService.startTask(updatedTask);

    expect(result.step?.stepId).toBe("full-review");
    expect(result.step?.iteration).toBe(2);

    const execution = await ctx.executionRepository.getExecution(result.execution!.id);
    expect(execution?.visited_steps).toBe(JSON.stringify(["iterate", "full-review"]));
    expect(execution?.iteration).toBe(2);
  });

  test("returns the stored task status when the step was already finalized", async () => {
    const task = await createRepoTask("task-finalized", "simple");
    await ctx.taskRepository.update(task.id, { status: "BLOCKED" });
    await ctx.executionRepository.createExecution({
      id: "exec-finalized",
      task_id: task.id,
      workflow_id: "simple",
      status: "running",
      visited_steps: JSON.stringify(["implement"]),
      iteration: 0,
      started_at: new Date().toISOString(),
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-finalized",
      execution_id: "exec-finalized",
      step_id: "implement",
      step_type: "implement",
      status: "success",
      started_at: new Date().toISOString(),
    });

    const result = await ctx.workflowService.completeStep(task, {
      executionId: "exec-finalized",
      stepId: "step-finalized",
      status: "success",
    });

    expect(result).toEqual({ taskStatus: "BLOCKED", step: null });
  });

  test("marks a simple workflow task done after a successful step", async () => {
    const task = await createRepoTask("task-done", "simple");
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
    });

    expect(result).toEqual({ taskStatus: "DONE", step: null });
    expect((await getTask(task.id)).status).toBe("DONE");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "completed",
    );
    expect((await ctx.executionRepository.getStepExecution(started.step!.id))?.status).toBe(
      "success",
    );
  });

  test("marks a simple workflow task blocked after a failed step", async () => {
    const task = await createRepoTask("task-blocked", "simple");
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "failure",
    });

    expect(result).toEqual({
      taskStatus: "BLOCKED",
      step: null,
      error: {
        code: "max_retries_exceeded",
        message: "Workflow blocked after step failure",
      },
    });
    expect((await getTask(task.id)).status).toBe("BLOCKED");
    expect((await ctx.executionRepository.getExecution(started.execution!.id))?.status).toBe(
      "failed",
    );
  });

  test("continues to the next step and updates visited steps", async () => {
    await upsertWorkflow({
      version: 1,
      name: "research-flow",
      initialStep: "codebase_research",
      steps: {
        codebase_research: {
          id: "codebase_research",
          type: "research",
          promptTemplate: "codebase-research.md.hbs",
          maxAttempts: 1,
          signals: [{ name: "RESEARCH_COMPLETE", description: "placeholder" }],
          transitions: [{ condition: "RESEARCH_COMPLETE", target: "plan_implementation" }],
        },
        plan_implementation: {
          id: "plan_implementation",
          type: "iterate",
          promptTemplate: "plan-implementation.md.hbs",
          maxAttempts: 1,
          signals: [{ name: "PLAN_READY", description: "placeholder" }],
          transitions: [{ condition: "PLAN_READY", target: "__done__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__", "__paused__"],
    });

    const task = await createRepoTask("task-step", "research-flow");
    const started = await ctx.workflowService.startTask(task);

    const result = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
      signal: "RESEARCH_COMPLETE",
    });

    expect(result.taskStatus).toBe("WORKING");
    expect(result.execution).toEqual({
      id: started.execution!.id,
      workflowId: "research-flow",
    });
    expect(result.step?.stepId).toBe("plan_implementation");

    const execution = await ctx.executionRepository.getExecution(started.execution!.id);
    expect(execution?.visited_steps).toBe(
      JSON.stringify(["codebase_research", "plan_implementation"]),
    );
    expect(execution?.iteration).toBe(0);
    expect((await getTask(task.id)).status).toBe("WORKING");
  });

  test("pauses a workflow and resumes from the awaiting-input step", async () => {
    await upsertWorkflow({
      version: 1,
      name: "pause-flow",
      initialStep: "plan_implementation",
      steps: {
        plan_implementation: {
          id: "plan_implementation",
          type: "iterate",
          promptTemplate: "plan-implementation.md.hbs",
          maxAttempts: 1,
          signals: [{ name: "REQUIRES_INPUT", description: "placeholder" }],
          transitions: [{ condition: "REQUIRES_INPUT", target: "__paused__" }],
        },
      },
      terminalStates: ["__done__", "__blocked__", "__paused__"],
    });

    const task = await createRepoTask("task-pause", "pause-flow");
    const started = await ctx.workflowService.startTask(task);

    const paused = await ctx.workflowService.completeStep(task, {
      executionId: started.execution!.id,
      stepId: started.step!.id,
      status: "success",
      signal: "REQUIRES_INPUT",
      pauseContext: "INPUT_REASON: Need clarification\nINPUT_TYPE: text",
    });

    expect(paused).toEqual({ taskStatus: "PAUSED", step: null });
    expect((await getTask(task.id)).status).toBe("PAUSED");
    expect((await ctx.executionRepository.getStepExecution(started.step!.id))?.status).toBe(
      "awaiting_input",
    );
    expect((await ctx.executionRepository.getStepExecution(started.step!.id))?.pause_context).toBe(
      "INPUT_REASON: Need clarification\nINPUT_TYPE: text",
    );

    const resumed = await ctx.workflowService.resumeTask(task, started.step!.id, "continue");

    expect(resumed.taskStatus).toBe("WORKING");
    expect(resumed.execution).toEqual({
      id: started.execution!.id,
      workflowId: "pause-flow",
    });
    expect(resumed.step?.stepId).toBe("plan_implementation");
    expect(resumed.step?.input).toBe("continue");
    expect((await getTask(task.id)).status).toBe("WORKING");
    expect((await getTask(task.id)).resume_input).toBeNull();
    expect(
      (await ctx.executionRepository.getStepExecutionsByExecutionId(started.execution!.id)).length,
    ).toBe(2);
  });

  test("throws when retry_from_step does not exist in the workflow", async () => {
    const task = await createRepoTask("task-bad-retry", "simple");
    await ctx.taskRepository.update(task.id, { retry_from_step: "missing-step" });

    const updatedTask = await getTask(task.id);

    await expect(ctx.workflowService.startTask(updatedTask)).rejects.toThrow(
      'Step "missing-step" not found in workflow "simple"',
    );
  });

  const createRepoTask = async (taskId: string, workflowName: string): Promise<Task> => {
    await createTestRepo(db, `repo-${taskId}`, `/tmp/${taskId}`);
    await createTestTask(db, taskId, `repo-${taskId}`, `changes/${taskId}`, "READY");
    await ctx.taskRepository.update(taskId, { preferred_workflow: workflowName });
    return getTask(taskId);
  };

  const getTask = async (taskId: string): Promise<Task> => {
    const task = await ctx.taskRepository.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return task;
  };

  const upsertWorkflow = async (workflow: WorkflowDefinition): Promise<void> => {
    await ctx.workflowService.listWorkflows();
    await ctx.workflowRepository.upsert({
      id: workflow.name,
      name: workflow.name,
      definition: JSON.stringify(workflow),
    });
  };
});
