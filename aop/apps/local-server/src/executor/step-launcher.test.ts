import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useTestAopHome } from "@aop/infra";
import type { LLMProvider, RunOptions, RunResult } from "@aop/llm-provider";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { StepExecutionStatus } from "./execution-types.ts";
import {
  getProvider,
  type HandleAgentCompletionFn,
  pollForProcessExit,
  REAPER_POLL_INTERVAL_MS,
  readRunResultFromLog,
  reattachToRunningAgent,
  spawnAgentWithReaper,
} from "./step-launcher.ts";
import type { ExecutorContext, StepWithTask } from "./types.ts";

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  repo_id: "repo-1",
  change_path: "changes/feat-1",
  status: "WORKING",
  worktree_path: null,
  ready_at: null,
  remote_id: null,
  synced_at: null,
  preferred_workflow: null,
  base_branch: null,
  preferred_provider: null,
  retry_from_step: null,
  resume_input: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const createMockProvider = (
  result: RunResult = { exitCode: 0 },
  onRunCalled?: (opts: RunOptions) => void,
): LLMProvider => ({
  name: "mock-provider",
  run: async (opts: RunOptions) => {
    onRunCalled?.(opts);
    return result;
  },
});

describe("step-launcher", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;
  let testLogsDir: string;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    testLogsDir = join(tmpdir(), `aop-test-launcher-${Date.now()}`);
    mkdirSync(testLogsDir, { recursive: true });
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
    if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
  });

  describe("getProvider", () => {
    test("returns provider from task preferred_provider when set", async () => {
      const task = createMockTask({ preferred_provider: "claude-code" });
      const provider = await getProvider(ctx, task);
      expect(provider.name).toBe("claude-code");
    });

    test("returns provider from settings when task has no preferred_provider", async () => {
      await ctx.settingsRepository.set("agent_provider", "claude-code");
      const task = createMockTask();
      const provider = await getProvider(ctx, task);
      expect(provider.name).toBe("claude-code");
    });

    test("returns ClaudeCodeProvider as default when no setting or preference", async () => {
      const task = createMockTask();
      const provider = await getProvider(ctx, task);
      expect(provider.name).toBe("claude-code");
    });
  });

  describe("spawnAgentWithReaper", () => {
    test("throws when task not found", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      // Don't create the task — it should throw

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      };

      const mockProvider = createMockProvider();

      await expect(
        spawnAgentWithReaper(
          {
            ctx,
            executorCtx,
            worktreeInfo: {
              path: "/test/worktree",
              branch: "task-1",
              baseBranch: "main",
              baseCommit: "abc",
            },
            prompt: "test prompt",
            stepId: "step-1",
            executionId: "exec-1",
            stepCommand: {
              id: "step-1",
              type: "implement",
              promptTemplate: "",
              signals: [],
              attempt: 1,
              iteration: 1,
            },
            executionInfo: { id: "exec-1", workflowId: "wf-1" },
            taskId: "task-nonexistent",
            repoId: "repo-1",
            provider: mockProvider,
          },
          mock(() => Promise.resolve()),
        ),
      ).rejects.toThrow("Task task-nonexistent not found");
    });

    test("calls provider.run and onCompletion with correct args", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      // Create execution + step records for updateStepExecution in onSpawn
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: "running",
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      let capturedOpts: RunOptions | undefined;
      const mockProvider = createMockProvider({ exitCode: 0, sessionId: "sess-1" }, (opts) => {
        capturedOpts = opts;
      });

      const onCompletion = mock(() => Promise.resolve());

      const executorCtx: ExecutorContext = {
        task: createMockTask(),
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: true,
      };

      await spawnAgentWithReaper(
        {
          ctx,
          executorCtx,
          worktreeInfo: {
            path: "/test/worktree",
            branch: "task-1",
            baseBranch: "main",
            baseCommit: "abc",
          },
          prompt: "implement the feature",
          stepId: "step-1",
          executionId: "exec-1",
          stepCommand: {
            id: "step-1",
            type: "implement",
            promptTemplate: "",
            signals: [{ name: "DONE", description: "done" }],
            attempt: 1,
            iteration: 1,
          },
          executionInfo: { id: "exec-1", workflowId: "wf-1" },
          taskId: "task-1",
          repoId: "repo-1",
          signals: [{ name: "DONE", description: "done" }],
          provider: mockProvider,
        },
        onCompletion,
      );

      expect(capturedOpts?.prompt).toBe("implement the feature");
      expect(capturedOpts?.fastMode).toBe(true);
      expect(capturedOpts?.env).toEqual({ AOP_TASK_ID: "task-1", AOP_STEP_ID: "step-1" });
      expect(onCompletion).toHaveBeenCalledTimes(1);
    });
  });

  describe("reattachToRunningAgent", () => {
    test("reattaches and calls onCompletion for completed process", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      // Write a success log file
      const logFile = join(testLogsDir, "step-1.jsonl");
      writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success" }));

      const step: StepWithTask = {
        id: "step-1",
        execution_id: "exec-1",
        step_id: "wf-step-1",
        step_type: "implement",
        remote_execution_id: "remote-exec-1",
        agent_pid: null,
        session_id: null,
        status: "running",
        exit_code: null,
        signal: null,
        pause_context: null,
        error: null,
        attempt: 1,
        iteration: 2,
        signals_json: JSON.stringify([{ name: "DONE", description: "done" }]),
        started_at: new Date().toISOString(),
        ended_at: null,
        task_id: "task-1",
      };

      const buildContextFn = mock(async (_ctx: LocalServerContext, task: Task) => ({
        task,
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: testLogsDir,
        timeoutSecs: 300,
        fastMode: false,
      }));

      const createWorktreeFn = mock(async () => ({
        path: "/test/worktree",
        branch: "task-1",
        baseBranch: "main",
        baseCommit: "abc",
      }));

      const onCompletion: HandleAgentCompletionFn = mock(() => Promise.resolve());

      await reattachToRunningAgent(ctx, step, buildContextFn, createWorktreeFn, onCompletion);

      expect(buildContextFn).toHaveBeenCalledTimes(1);
      expect(createWorktreeFn).toHaveBeenCalledTimes(1);
      expect(onCompletion).toHaveBeenCalledTimes(1);

      // biome-ignore lint/suspicious/noExplicitAny: test assertion on mock call args
      const [opts, logFilePath, runResult, signals] = (onCompletion as any).mock.calls[0];
      expect(opts.taskId).toBe("task-1");
      expect(opts.stepId).toBe("step-1");
      expect(opts.executionId).toBe("exec-1");
      expect(opts.stepCommand.type).toBe("implement");
      expect(opts.stepCommand.stepId).toBe("wf-step-1");
      expect(opts.stepCommand.attempt).toBe(1);
      expect(opts.stepCommand.iteration).toBe(2);
      expect(opts.executionInfo.id).toBe("remote-exec-1");
      expect(logFilePath).toBe(logFile);
      expect(runResult.exitCode).toBe(0);
      expect(signals).toEqual([{ name: "DONE", description: "done" }]);
    });

    test("throws when task not found", async () => {
      const step: StepWithTask = {
        id: "step-1",
        execution_id: "exec-1",
        step_id: null,
        step_type: null,
        remote_execution_id: null,
        agent_pid: null,
        session_id: null,
        status: "running",
        exit_code: null,
        signal: null,
        pause_context: null,
        error: null,
        attempt: null,
        iteration: null,
        signals_json: null,
        started_at: new Date().toISOString(),
        ended_at: null,
        task_id: "task-nonexistent",
      };

      await expect(
        reattachToRunningAgent(
          ctx,
          step,
          mock(() => Promise.resolve({} as ExecutorContext)),
          mock(() => Promise.resolve({ path: "", branch: "", baseBranch: "", baseCommit: "" })),
          mock(() => Promise.resolve()),
        ),
      ).rejects.toThrow("Task not found: task-nonexistent");
    });

    test("handles step with null signals_json", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const logFile = join(testLogsDir, "step-2.jsonl");
      writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success" }));

      const step: StepWithTask = {
        id: "step-2",
        execution_id: "exec-1",
        step_id: null,
        step_type: null,
        remote_execution_id: null,
        agent_pid: null,
        session_id: null,
        status: "running",
        exit_code: null,
        signal: null,
        pause_context: null,
        error: null,
        attempt: null,
        iteration: null,
        signals_json: null,
        started_at: new Date().toISOString(),
        ended_at: null,
        task_id: "task-1",
      };

      const onCompletion: HandleAgentCompletionFn = mock(() => Promise.resolve());

      await reattachToRunningAgent(
        ctx,
        step,
        mock(async (_ctx: LocalServerContext, task: Task) => ({
          task,
          repoId: "repo-1",
          repoPath: "/test/repo",
          changePath: "/test/repo/changes/feat-1",
          worktreePath: "/test/worktree",
          logsDir: testLogsDir,
          timeoutSecs: 300,
          fastMode: false,
        })),
        mock(async () => ({
          path: "/test/worktree",
          branch: "task-1",
          baseBranch: "main",
          baseCommit: "abc",
        })),
        onCompletion,
      );

      // biome-ignore lint/suspicious/noExplicitAny: test assertion on mock call args
      const [opts, , , signals] = (onCompletion as any).mock.calls[0];
      expect(opts.stepCommand.type).toBe("unknown");
      expect(opts.stepCommand.attempt).toBe(1);
      expect(opts.stepCommand.iteration).toBe(1);
      expect(signals).toEqual([]);
    });
  });

  describe("pollForProcessExit", () => {
    test("resolves immediately for non-existent PID", async () => {
      const start = Date.now();
      await pollForProcessExit(999999999);
      expect(Date.now() - start).toBeLessThan(REAPER_POLL_INTERVAL_MS);
    });
  });

  describe("readRunResultFromLog", () => {
    test("returns exitCode 1 when log file does not exist", () => {
      const result = readRunResultFromLog("/nonexistent/path.jsonl");
      expect(result.exitCode).toBe(1);
    });

    test("returns exitCode 0 when last result is success", () => {
      const logFile = join(testLogsDir, "success.jsonl");
      writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success" }));
      const result = readRunResultFromLog(logFile);
      expect(result.exitCode).toBe(0);
    });

    test("returns exitCode 1 when last result is failure", () => {
      const logFile = join(testLogsDir, "failure.jsonl");
      writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "error" }));
      const result = readRunResultFromLog(logFile);
      expect(result.exitCode).toBe(1);
    });
  });
});
