import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { executeTask } from "./executor.ts";

describe("executeTask", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let testRepoPath: string;
  let testLogsDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
    mkdirSync(testLogsDir, { recursive: true });

    // Set up a git repo
    testRepoPath = join(tmpdir(), `aop-test-repo-exec-${Date.now()}`);
    mkdirSync(testRepoPath, { recursive: true });
    const proc = Bun.spawn(["git", "init"], { cwd: testRepoPath });
    await proc.exited;
    const configName = Bun.spawn(["git", "config", "user.name", "Test"], {
      cwd: testRepoPath,
    });
    await configName.exited;
    const configEmail = Bun.spawn(["git", "config", "user.email", "test@test.com"], {
      cwd: testRepoPath,
    });
    await configEmail.exited;
    const addFile = Bun.spawn(["touch", "README.md"], { cwd: testRepoPath });
    await addFile.exited;
    const gitAdd = Bun.spawn(["git", "add", "."], { cwd: testRepoPath });
    await gitAdd.exited;
    const gitCommit = Bun.spawn(["git", "commit", "-m", "Initial commit"], {
      cwd: testRepoPath,
    });
    await gitCommit.exited;
  });

  afterEach(async () => {
    await db.destroy();
    if (existsSync(testRepoPath)) {
      rmSync(testRepoPath, { recursive: true });
    }
    if (existsSync(testLogsDir)) {
      rmSync(testLogsDir, { recursive: true });
    }
  });

  const createMockProvider = (
    runImpl: () => Promise<{
      exitCode: number;
      sessionId?: string;
      timedOut: boolean;
    }>,
  ) => ({
    run: mock(runImpl),
  });

  test("executes single step task successfully", async () => {
    await createTestRepo(db, "repo-1", testRepoPath);
    await createTestTask(db, "task-exec-1", "repo-1", "changes/feat-1", "READY");

    const task = await ctx.taskRepository.get("task-exec-1");
    if (!task) throw new Error("Task should exist");

    const stepCommand = {
      id: "step-1",
      type: "implement",
      promptTemplate: "Implement feature for {{task.id}}",
      signals: [],
      attempt: 1,
    };

    const executionInfo = {
      id: "exec-info-1",
      workflowId: "workflow-1",
    };

    const mockProvider = createMockProvider(async () => ({
      exitCode: 0,
      sessionId: "mock-session",
      timedOut: false,
    }));

    const result = await executeTask(
      ctx,
      task,
      stepCommand,
      executionInfo,
      undefined,
      mockProvider as never,
    );

    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("success");
    expect(mockProvider.run).toHaveBeenCalled();

    const updatedTask = await ctx.taskRepository.get("task-exec-1");
    expect(updatedTask?.status).toBe("DONE");
    expect(updatedTask?.worktree_path).toBe(join(testRepoPath, ".worktrees", "task-exec-1"));

    // Verify execution records were created
    const executions = await db
      .selectFrom("executions")
      .selectAll()
      .where("task_id", "=", "task-exec-1")
      .execute();
    expect(executions.length).toBe(1);
    expect(executions[0]?.status).toBe("completed");
  });

  test("marks task as BLOCKED on agent failure", async () => {
    await createTestRepo(db, "repo-1", testRepoPath);
    await createTestTask(db, "task-exec-2", "repo-1", "changes/feat-2", "READY");

    const task = await ctx.taskRepository.get("task-exec-2");
    if (!task) throw new Error("Task should exist");

    const stepCommand = {
      id: "step-1",
      type: "implement",
      promptTemplate: "Implement feature",
      signals: [],
      attempt: 1,
    };

    const executionInfo = {
      id: "exec-info-2",
      workflowId: "workflow-2",
    };

    const mockProvider = createMockProvider(async () => ({
      exitCode: 1,
      sessionId: "fail-session",
      timedOut: false,
    }));

    const result = await executeTask(
      ctx,
      task,
      stepCommand,
      executionInfo,
      undefined,
      mockProvider as never,
    );

    expect(result.exitCode).toBe(1);
    expect(result.status).toBe("failure");

    const updatedTask = await ctx.taskRepository.get("task-exec-2");
    expect(updatedTask?.status).toBe("BLOCKED");
  });

  test("marks task as BLOCKED on timeout", async () => {
    await createTestRepo(db, "repo-1", testRepoPath);
    await createTestTask(db, "task-exec-3", "repo-1", "changes/feat-3", "READY");

    const task = await ctx.taskRepository.get("task-exec-3");
    if (!task) throw new Error("Task should exist");

    const stepCommand = {
      id: "step-1",
      type: "implement",
      promptTemplate: "Implement feature",
      signals: [],
      attempt: 1,
    };

    const executionInfo = {
      id: "exec-info-3",
      workflowId: "workflow-3",
    };

    const mockProvider = createMockProvider(async () => ({
      exitCode: -1,
      sessionId: "timeout-session",
      timedOut: true,
    }));

    const result = await executeTask(
      ctx,
      task,
      stepCommand,
      executionInfo,
      undefined,
      mockProvider as never,
    );

    expect(result.status).toBe("timeout");

    const updatedTask = await ctx.taskRepository.get("task-exec-3");
    expect(updatedTask?.status).toBe("BLOCKED");
  });

  test("syncs with server when serverSync is provided", async () => {
    await createTestRepo(db, "repo-1", testRepoPath);
    await createTestTask(db, "task-exec-4", "repo-1", "changes/feat-4", "READY");

    const task = await ctx.taskRepository.get("task-exec-4");
    if (!task) throw new Error("Task should exist");

    const stepCommand = {
      id: "step-1",
      type: "implement",
      promptTemplate: "Implement feature",
      signals: [],
      attempt: 1,
    };

    const executionInfo = {
      id: "exec-info-4",
      workflowId: "workflow-4",
    };

    const mockServerSync = {
      syncTask: mock(() => Promise.resolve()),
      completeStep: mock(() =>
        Promise.resolve({
          taskStatus: "DONE",
        }),
      ),
    };

    const mockProvider = createMockProvider(async () => ({
      exitCode: 0,
      sessionId: "mock-session",
      timedOut: false,
    }));

    const result = await executeTask(
      ctx,
      task,
      stepCommand,
      executionInfo,
      mockServerSync as never,
      mockProvider as never,
    );

    expect(result.status).toBe("success");
    expect(mockServerSync.syncTask).toHaveBeenCalledWith("task-exec-4", "repo-1", "WORKING");
    expect(mockServerSync.completeStep).toHaveBeenCalled();
  });

  test("continues to next step when server returns next step", async () => {
    let callCount = 0;

    await createTestRepo(db, "repo-1", testRepoPath);
    await createTestTask(db, "task-exec-5", "repo-1", "changes/feat-5", "READY");

    const task = await ctx.taskRepository.get("task-exec-5");
    if (!task) throw new Error("Task should exist");

    const stepCommand = {
      id: "step-1",
      type: "implement",
      promptTemplate: "Implement feature",
      signals: [],
      attempt: 1,
    };

    const executionInfo = {
      id: "exec-info-5",
      workflowId: "workflow-5",
    };

    let completeStepCallCount = 0;
    const mockServerSync = {
      syncTask: mock(() => Promise.resolve()),
      completeStep: mock(() => {
        completeStepCallCount++;
        if (completeStepCallCount === 1) {
          return Promise.resolve({
            taskStatus: "WORKING",
            step: {
              id: "step-2",
              type: "review",
              promptTemplate: "Review changes",
              signals: [],
              attempt: 1,
            },
            execution: {
              id: "exec-info-5-2",
              workflowId: "workflow-5",
            },
          });
        }
        return Promise.resolve({ taskStatus: "DONE" });
      }),
    };

    const mockProvider = createMockProvider(async () => {
      callCount++;
      return {
        exitCode: 0,
        sessionId: `session-${callCount}`,
        timedOut: false,
      };
    });

    const result = await executeTask(
      ctx,
      task,
      stepCommand,
      executionInfo,
      mockServerSync as never,
      mockProvider as never,
    );

    expect(result.status).toBe("success");
    expect(callCount).toBe(2);
    expect(mockServerSync.completeStep).toHaveBeenCalledTimes(2);
  });
});
