import { describe, expect, mock, test } from "bun:test";
import type { AgentRegistry, RunningAgent } from "../interfaces/agent-registry";
import type { Job } from "../types/job";
import type { HandlerContext, JobHandler } from "./handlers";
import {
  CompletingTaskHandler,
  CompletionReviewHandler,
  ConflictSolverHandler,
  createHandlerRegistry,
  ImplementationHandler,
  MergeHandler,
  MigrateWorktreeHandler,
  ReviewHandler
} from "./handlers";

const createMockJob = (overrides: Partial<Job> = {}): Job => ({
  id: "test-job-id",
  type: "implementation",
  taskFolder: "test-task",
  status: "pending",
  priority: 0,
  createdAt: new Date(),
  ...overrides
});

const createMockRegistry = (): AgentRegistry & {
  registeredAgents: RunningAgent[];
  unregisteredJobIds: string[];
} => ({
  registeredAgents: [],
  unregisteredJobIds: [],
  register: mock(async function (
    this: { registeredAgents: RunningAgent[] },
    agent: RunningAgent
  ) {
    this.registeredAgents.push(agent);
  }),
  unregister: mock(async function (
    this: { unregisteredJobIds: string[] },
    jobId: string
  ) {
    this.unregisteredJobIds.push(jobId);
  }),
  get: mock(async () => undefined),
  getByTask: mock(async () => []),
  getBySubtask: mock(async () => undefined),
  getAll: mock(async () => []),
  count: mock(async () => 0)
});

type MockContext = HandlerContext & {
  registry: ReturnType<typeof createMockRegistry>;
};

const createMockContext = (
  overrides: Partial<HandlerContext> = {}
): MockContext => {
  const registry = createMockRegistry();
  return {
    registry,
    worktreesDir: "/test/.worktrees",
    repoRoot: "/test/repo",
    spawnAgent: mock(async () => ({ pid: 12345, exitCode: 0 })),
    mergeSubtask: mock(async () => ({ success: true, commitSha: "abc123" })),
    deleteWorktree: mock(async () => {}),
    migrateWorktree: mock(async () => ({
      success: true,
      branchName: "task/test-task"
    })),
    updateSubtaskStatus: mock(async () => {}),
    updateTaskStatus: mock(async () => {}),
    ...overrides
  } as MockContext;
};

describe("JobHandler interface", () => {
  test("handlers implement JobHandler interface", () => {
    const ctx = createMockContext();
    const handlers: JobHandler[] = [
      new ImplementationHandler(ctx),
      new ReviewHandler(ctx),
      new MergeHandler(ctx),
      new CompletingTaskHandler(ctx),
      new CompletionReviewHandler(ctx),
      new ConflictSolverHandler(ctx),
      new MigrateWorktreeHandler(ctx)
    ];

    for (const handler of handlers) {
      expect(typeof handler.execute).toBe("function");
    }
  });
});

describe("ImplementationHandler", () => {
  test("registers agent before spawning", async () => {
    const ctx = createMockContext();
    const handler = new ImplementationHandler(ctx);
    const job = createMockJob({
      type: "implementation",
      subtaskFile: "001-test.md"
    });

    await handler.execute(job);

    expect(ctx.registry.registeredAgents.length).toBe(1);
    const agent = ctx.registry.registeredAgents[0]!;
    expect(agent.jobId).toBe(job.id);
    expect(agent.type).toBe("implementation");
  });

  test("spawns agent in subtask worktree", async () => {
    const ctx = createMockContext();
    const handler = new ImplementationHandler(ctx);
    const job = createMockJob({
      type: "implementation",
      taskFolder: "my-task",
      subtaskFile: "001-feature.md"
    });

    await handler.execute(job);

    expect(ctx.spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "implementation",
        taskFolder: "my-task",
        subtaskFile: "001-feature.md"
      })
    );
  });

  test("unregisters agent after completion", async () => {
    const ctx = createMockContext();
    const handler = new ImplementationHandler(ctx);
    const job = createMockJob({
      type: "implementation",
      subtaskFile: "001-test.md"
    });

    await handler.execute(job);

    expect(ctx.registry.unregisteredJobIds).toContain(job.id);
  });

  test("returns success when agent exits with code 0", async () => {
    const ctx = createMockContext({
      spawnAgent: mock(async () => ({ pid: 123, exitCode: 0 }))
    });
    const handler = new ImplementationHandler(ctx);
    const job = createMockJob({
      type: "implementation",
      subtaskFile: "001-test.md"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(true);
    expect(result.jobId).toBe(job.id);
  });

  test("returns failure when agent exits with non-zero code", async () => {
    const ctx = createMockContext({
      spawnAgent: mock(async () => ({ pid: 123, exitCode: 1 }))
    });
    const handler = new ImplementationHandler(ctx);
    const job = createMockJob({
      type: "implementation",
      subtaskFile: "001-test.md"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("ReviewHandler", () => {
  test("registers agent before spawning", async () => {
    const ctx = createMockContext();
    const handler = new ReviewHandler(ctx);
    const job = createMockJob({
      type: "review",
      subtaskFile: "001-test.md"
    });

    await handler.execute(job);

    expect(ctx.registry.registeredAgents.length).toBe(1);
    expect(ctx.registry.registeredAgents[0]!.type).toBe("review");
  });

  test("spawns review agent in subtask worktree", async () => {
    const ctx = createMockContext();
    const handler = new ReviewHandler(ctx);
    const job = createMockJob({
      type: "review",
      taskFolder: "my-task",
      subtaskFile: "001-feature.md"
    });

    await handler.execute(job);

    expect(ctx.spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "review",
        taskFolder: "my-task",
        subtaskFile: "001-feature.md"
      })
    );
  });

  test("returns success when review completes", async () => {
    const ctx = createMockContext({
      spawnAgent: mock(async () => ({ pid: 123, exitCode: 0 }))
    });
    const handler = new ReviewHandler(ctx);
    const job = createMockJob({
      type: "review",
      subtaskFile: "001-test.md"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(true);
  });
});

describe("MergeHandler", () => {
  test("merges subtask into task branch", async () => {
    const ctx = createMockContext({
      mergeSubtask: mock(async () => ({ success: true, commitSha: "def456" }))
    });
    const handler = new MergeHandler(ctx);
    const job = createMockJob({
      type: "merge",
      taskFolder: "my-task",
      subtaskFile: "001-feature.md"
    });

    await handler.execute(job);

    expect(ctx.mergeSubtask).toHaveBeenCalledWith("my-task", "feature");
  });

  test("deletes worktree after successful merge", async () => {
    const ctx = createMockContext({
      mergeSubtask: mock(async () => ({ success: true, commitSha: "abc" }))
    });
    const handler = new MergeHandler(ctx);
    const job = createMockJob({
      type: "merge",
      taskFolder: "my-task",
      subtaskFile: "001-feature.md"
    });

    await handler.execute(job);

    expect(ctx.deleteWorktree).toHaveBeenCalledWith(
      "/test/.worktrees/my-task--feature"
    );
  });

  test("returns success on successful merge", async () => {
    const ctx = createMockContext({
      mergeSubtask: mock(async () => ({ success: true, commitSha: "abc" }))
    });
    const handler = new MergeHandler(ctx);
    const job = createMockJob({
      type: "merge",
      subtaskFile: "001-test.md"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(true);
  });

  test("updates subtask status to DONE after successful merge", async () => {
    const ctx = createMockContext({
      mergeSubtask: mock(async () => ({ success: true, commitSha: "abc" }))
    });
    const handler = new MergeHandler(ctx);
    const job = createMockJob({
      type: "merge",
      taskFolder: "my-task",
      subtaskFile: "001-feature.md"
    });

    await handler.execute(job);

    expect(ctx.updateSubtaskStatus).toHaveBeenCalledWith(
      "my-task",
      "001-feature.md",
      "DONE"
    );
  });

  test("does not update subtask status on merge failure", async () => {
    const ctx = createMockContext({
      mergeSubtask: mock(async () => ({
        success: false,
        error: "CONFLICT: merge conflict"
      }))
    });
    const handler = new MergeHandler(ctx);
    const job = createMockJob({
      type: "merge",
      taskFolder: "my-task",
      subtaskFile: "001-feature.md"
    });

    await handler.execute(job);

    expect(ctx.updateSubtaskStatus).not.toHaveBeenCalled();
  });

  test("returns failure with conflict info on merge conflict", async () => {
    const ctx = createMockContext({
      mergeSubtask: mock(async () => ({
        success: false,
        error: "CONFLICT: merge conflict in file.ts"
      }))
    });
    const handler = new MergeHandler(ctx);
    const job = createMockJob({
      type: "merge",
      subtaskFile: "001-test.md"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(false);
    expect(result.error).toContain("CONFLICT");
  });
});

describe("CompletingTaskHandler", () => {
  test("registers agent before spawning", async () => {
    const ctx = createMockContext();
    const handler = new CompletingTaskHandler(ctx);
    const job = createMockJob({
      type: "completing-task",
      taskFolder: "my-task"
    });

    await handler.execute(job);

    expect(ctx.registry.registeredAgents.length).toBe(1);
    expect(ctx.registry.registeredAgents[0]!.type).toBe("completing-task");
  });

  test("spawns completing-task agent in task worktree", async () => {
    const ctx = createMockContext();
    const handler = new CompletingTaskHandler(ctx);
    const job = createMockJob({
      type: "completing-task",
      taskFolder: "my-task"
    });

    await handler.execute(job);

    expect(ctx.spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "completing-task",
        taskFolder: "my-task"
      })
    );
  });

  test("returns success when agent completes", async () => {
    const ctx = createMockContext({
      spawnAgent: mock(async () => ({ pid: 123, exitCode: 0 }))
    });
    const handler = new CompletingTaskHandler(ctx);
    const job = createMockJob({
      type: "completing-task"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(true);
  });
});

describe("CompletionReviewHandler", () => {
  test("registers agent before spawning", async () => {
    const ctx = createMockContext();
    const handler = new CompletionReviewHandler(ctx);
    const job = createMockJob({
      type: "completion-review",
      taskFolder: "my-task"
    });

    await handler.execute(job);

    expect(ctx.registry.registeredAgents.length).toBe(1);
    expect(ctx.registry.registeredAgents[0]!.type).toBe("completion-review");
  });

  test("spawns completion-review agent in task worktree", async () => {
    const ctx = createMockContext();
    const handler = new CompletionReviewHandler(ctx);
    const job = createMockJob({
      type: "completion-review",
      taskFolder: "my-task"
    });

    await handler.execute(job);

    expect(ctx.spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "completion-review",
        taskFolder: "my-task"
      })
    );
  });

  test("returns success when agent completes", async () => {
    const ctx = createMockContext({
      spawnAgent: mock(async () => ({ pid: 123, exitCode: 0 }))
    });
    const handler = new CompletionReviewHandler(ctx);
    const job = createMockJob({
      type: "completion-review"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(true);
  });
});

describe("ConflictSolverHandler", () => {
  test("registers agent before spawning", async () => {
    const ctx = createMockContext();
    const handler = new ConflictSolverHandler(ctx);
    const job = createMockJob({
      type: "conflict-solver",
      taskFolder: "my-task",
      subtaskFile: "001-feature.md"
    });

    await handler.execute(job);

    expect(ctx.registry.registeredAgents.length).toBe(1);
    expect(ctx.registry.registeredAgents[0]!.type).toBe("conflict-solver");
  });

  test("spawns conflict-solver agent in task worktree", async () => {
    const ctx = createMockContext();
    const handler = new ConflictSolverHandler(ctx);
    const job = createMockJob({
      type: "conflict-solver",
      taskFolder: "my-task",
      subtaskFile: "001-feature.md"
    });

    await handler.execute(job);

    expect(ctx.spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "conflict-solver",
        taskFolder: "my-task",
        subtaskFile: "001-feature.md"
      })
    );
  });

  test("returns success when agent resolves conflict", async () => {
    const ctx = createMockContext({
      spawnAgent: mock(async () => ({ pid: 123, exitCode: 0 }))
    });
    const handler = new ConflictSolverHandler(ctx);
    const job = createMockJob({
      type: "conflict-solver",
      subtaskFile: "001-test.md"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(true);
  });

  test("returns failure when agent cannot resolve conflict", async () => {
    const ctx = createMockContext({
      spawnAgent: mock(async () => ({ pid: 123, exitCode: 1 }))
    });
    const handler = new ConflictSolverHandler(ctx);
    const job = createMockJob({
      type: "conflict-solver",
      subtaskFile: "001-test.md"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(false);
  });
});

describe("MigrateWorktreeHandler", () => {
  test("migrates worktree when executed", async () => {
    const ctx = createMockContext();
    const handler = new MigrateWorktreeHandler(ctx);
    const job = createMockJob({
      type: "migrate-worktree",
      taskFolder: "my-task"
    });

    await handler.execute(job);

    expect(ctx.migrateWorktree).toHaveBeenCalledWith(
      "/test/.worktrees/my-task"
    );
  });

  test("updates task status to DONE after successful migration", async () => {
    const ctx = createMockContext({
      migrateWorktree: mock(async () => ({
        success: true,
        branchName: "task/my-task"
      }))
    });
    const handler = new MigrateWorktreeHandler(ctx);
    const job = createMockJob({
      type: "migrate-worktree",
      taskFolder: "my-task"
    });

    await handler.execute(job);

    expect(ctx.updateTaskStatus).toHaveBeenCalledWith("my-task", "DONE");
  });

  test("returns success on successful migration", async () => {
    const ctx = createMockContext({
      migrateWorktree: mock(async () => ({
        success: true,
        branchName: "task/my-task"
      }))
    });
    const handler = new MigrateWorktreeHandler(ctx);
    const job = createMockJob({
      type: "migrate-worktree",
      taskFolder: "my-task"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(true);
    expect(result.jobId).toBe(job.id);
  });

  test("returns failure when migration fails", async () => {
    const ctx = createMockContext({
      migrateWorktree: mock(async () => ({
        success: false,
        branchName: "",
        error: "Failed to remove worktree"
      }))
    });
    const handler = new MigrateWorktreeHandler(ctx);
    const job = createMockJob({
      type: "migrate-worktree",
      taskFolder: "my-task"
    });

    const result = await handler.execute(job);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to remove worktree");
  });

  test("does not update task status on migration failure", async () => {
    const ctx = createMockContext({
      migrateWorktree: mock(async () => ({
        success: false,
        branchName: "",
        error: "Failed"
      }))
    });
    const handler = new MigrateWorktreeHandler(ctx);
    const job = createMockJob({
      type: "migrate-worktree",
      taskFolder: "my-task"
    });

    await handler.execute(job);

    expect(ctx.updateTaskStatus).not.toHaveBeenCalled();
  });
});

describe("createHandlerRegistry", () => {
  test("returns handlers for all job types", () => {
    const ctx = createMockContext();
    const registry = createHandlerRegistry(ctx);

    expect(registry.get("implementation")).toBeInstanceOf(
      ImplementationHandler
    );
    expect(registry.get("review")).toBeInstanceOf(ReviewHandler);
    expect(registry.get("merge")).toBeInstanceOf(MergeHandler);
    expect(registry.get("completing-task")).toBeInstanceOf(
      CompletingTaskHandler
    );
    expect(registry.get("completion-review")).toBeInstanceOf(
      CompletionReviewHandler
    );
    expect(registry.get("conflict-solver")).toBeInstanceOf(
      ConflictSolverHandler
    );
    expect(registry.get("migrate-worktree")).toBeInstanceOf(
      MigrateWorktreeHandler
    );
  });

  test("returns undefined for unknown job type", () => {
    const ctx = createMockContext();
    const registry = createHandlerRegistry(ctx);

    // @ts-expect-error: testing invalid job type
    expect(registry.get("unknown")).toBeUndefined();
  });
});
