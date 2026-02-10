import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SignalDefinition } from "@aop/common/protocol";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database, Task } from "../db/schema.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import {
  buildContext,
  buildPromptForExecution,
  createExecutionRecord,
  createStepRecord,
  createWorktree,
  ensureDir,
  finalizeExecutionAndGetNextStep,
  markTaskWorking,
  pollForProcessExit,
  processAgentCompletion,
  readRunResultFromLog,
  setupWorktreeOpenspecSymlink,
} from "./executor.ts";
import type { ExecutorContext } from "./types.ts";

const sig = (name: string): SignalDefinition => ({ name, description: "" });

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

describe("executor", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  describe("buildContext", () => {
    test("builds executor context for valid task and repo", async () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const task = await ctx.taskRepository.get("task-1");
      if (!task) throw new Error("Task should exist");
      const result = await buildContext(ctx, task, testLogsDir);

      expect(result.task.id).toBe("task-1");
      expect(result.repoPath).toBe("/test/repo");
      expect(result.changePath).toBe(join(aopPaths.repoDir("repo-1"), "changes/feat-1"));
      expect(result.worktreePath).toBe(aopPaths.worktree("repo-1", "task-1"));
      expect(result.logsDir).toBe(testLogsDir);
      expect(result.timeoutSecs).toBe(1800);
      expect(result.fastMode).toBe(false);

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });

    test("throws error when repo not found", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const task = await ctx.taskRepository.get("task-1");
      if (!task) throw new Error("Task should exist");
      const invalidTask = { ...task, repo_id: "nonexistent-repo" };

      await expect(buildContext(ctx, invalidTask)).rejects.toThrow(
        "Repo not found: nonexistent-repo",
      );
    });

    test("uses custom timeout from settings", async () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");
      await ctx.settingsRepository.set("agent_timeout_secs", "600");

      const task = await ctx.taskRepository.get("task-1");
      if (!task) throw new Error("Task should exist");
      const result = await buildContext(ctx, task, testLogsDir);

      expect(result.timeoutSecs).toBe(600);

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });

    test("reads fast_mode setting as boolean", async () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");
      await ctx.settingsRepository.set("fast_mode", "true");

      const task = await ctx.taskRepository.get("task-1");
      if (!task) throw new Error("Task should exist");
      const result = await buildContext(ctx, task, testLogsDir);

      expect(result.fastMode).toBe(true);

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });
  });

  describe("markTaskWorking", () => {
    test("updates task status to WORKING", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const task = await ctx.taskRepository.get("task-1");
      if (!task) throw new Error("Task should exist");
      await markTaskWorking(ctx, task, "/test/worktree/path");

      const updated = await ctx.taskRepository.get("task-1");
      expect(updated?.status).toBe("WORKING");
      expect(updated?.worktree_path).toBe("/test/worktree/path");
    });

    test("syncs task status when serverSync is provided", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
      };

      const task = await ctx.taskRepository.get("task-1");
      if (!task) throw new Error("Task should exist");
      await markTaskWorking(ctx, task, "/test/worktree/path", mockServerSync as never);

      expect(mockServerSync.syncTask).toHaveBeenCalledWith("task-1", "repo-1", "WORKING");
    });

    test("handles serverSync failure gracefully", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "READY");

      const mockServerSync = {
        syncTask: mock(() => Promise.reject(new Error("Network error"))),
      };

      const task = await ctx.taskRepository.get("task-1");
      if (!task) throw new Error("Task should exist");
      await markTaskWorking(ctx, task, "/test/worktree/path", mockServerSync as never);

      const updated = await ctx.taskRepository.get("task-1");
      expect(updated?.status).toBe("WORKING");
    });
  });

  describe("createExecutionRecord", () => {
    test("creates execution record", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const executionId = await createExecutionRecord(ctx, "task-1");

      expect(executionId).toMatch(/^exec_/);

      const execution = await ctx.executionRepository.getExecution(executionId);
      expect(execution?.task_id).toBe("task-1");
      expect(execution?.status).toBe(ExecutionStatus.RUNNING);
    });
  });

  describe("createStepRecord", () => {
    test("creates step execution record", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const executionId = await createExecutionRecord(ctx, "task-1");
      const stepId = await createStepRecord(ctx, executionId, "implement");

      expect(stepId).toMatch(/^step_/);

      const step = await ctx.executionRepository.getStepExecution(stepId);
      expect(step?.execution_id).toBe(executionId);
      expect(step?.status).toBe(StepExecutionStatus.RUNNING);
      expect(step?.step_type).toBe("implement");
    });

    test("creates step without step type", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const executionId = await createExecutionRecord(ctx, "task-1");
      const stepId = await createStepRecord(ctx, executionId);

      const step = await ctx.executionRepository.getStepExecution(stepId);
      expect(step?.step_type).toBeNull();
    });

    test("uses remote step ID when provided", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");

      const executionId = await createExecutionRecord(ctx, "task-1");
      const remoteId = "step_remote_abc123";
      const stepId = await createStepRecord(ctx, executionId, "implement", remoteId);

      expect(stepId).toBe(remoteId);

      const step = await ctx.executionRepository.getStepExecution(stepId);
      expect(step?.id).toBe(remoteId);
      expect(step?.step_type).toBe("implement");
    });
  });

  describe("createWorktree", () => {
    let testRepoPath: string;

    beforeEach(async () => {
      testRepoPath = join(tmpdir(), `aop-test-repo-${Date.now()}`);
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

    afterEach(() => {
      if (existsSync(testRepoPath)) {
        rmSync(testRepoPath, { recursive: true });
      }
    });

    test("creates worktree for task", async () => {
      const task = createMockTask({ id: "task-wt-1" });

      const executorCtx: ExecutorContext = {
        task,
        repoId: "repo-1",
        repoPath: testRepoPath,
        changePath: join(testRepoPath, "changes/feat-1"),
        worktreePath: aopPaths.worktree("repo-1", "task-wt-1"),
        logsDir: tmpdir(),
        timeoutSecs: 300,
        fastMode: false,
      };

      const result = await createWorktree(executorCtx);

      expect(result.path).toBe(aopPaths.worktree("repo-1", "task-wt-1"));
      expect(result.branch).toBe("task-wt-1");
      expect(existsSync(result.path)).toBe(true);
    });

    test("uses task base_branch when set", async () => {
      const branchName = `feature-branch-${Date.now()}`;
      const createBranch = Bun.spawn(["git", "branch", branchName], {
        cwd: testRepoPath,
      });
      await createBranch.exited;

      const task = createMockTask({ id: "task-wt-base", base_branch: branchName });

      const executorCtx: ExecutorContext = {
        task,
        repoId: "repo-1",
        repoPath: testRepoPath,
        changePath: join(testRepoPath, "changes/feat-1"),
        worktreePath: aopPaths.worktree("repo-1", "task-wt-base"),
        logsDir: tmpdir(),
        timeoutSecs: 300,
        fastMode: false,
      };

      const result = await createWorktree(executorCtx);

      expect(result.baseBranch).toBe(branchName);
      expect(result.path).toBe(aopPaths.worktree("repo-1", "task-wt-base"));
      expect(existsSync(result.path)).toBe(true);
    });

    test("handles worktree already exists error", async () => {
      const task = createMockTask({ id: "task-wt-2" });

      const executorCtx: ExecutorContext = {
        task,
        repoId: "repo-1",
        repoPath: testRepoPath,
        changePath: join(testRepoPath, "changes/feat-1"),
        worktreePath: aopPaths.worktree("repo-1", "task-wt-2"),
        logsDir: tmpdir(),
        timeoutSecs: 300,
        fastMode: false,
      };

      await createWorktree(executorCtx);

      const result = await createWorktree(executorCtx);

      expect(result.path).toBe(aopPaths.worktree("repo-1", "task-wt-2"));
      expect(result.branch).toBe("task-wt-2");
    });
  });

  describe("setupWorktreeOpenspecSymlink", () => {
    let worktreePath: string;
    let globalOpenspecPath: string;
    const repoId = "repo-symlink-test";

    beforeEach(() => {
      worktreePath = join(tmpdir(), `aop-test-wt-${Date.now()}`);
      globalOpenspecPath = aopPaths.openspec(repoId);
      mkdirSync(worktreePath, { recursive: true });
      mkdirSync(globalOpenspecPath, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true });
      if (existsSync(globalOpenspecPath)) rmSync(globalOpenspecPath, { recursive: true });
    });

    test("creates symlink from worktree/openspec to global openspec", () => {
      setupWorktreeOpenspecSymlink(worktreePath, repoId);

      const symlinkPath = join(worktreePath, "openspec");
      expect(existsSync(symlinkPath)).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(symlinkPath)).toBe(globalOpenspecPath);
    });

    test("skips if openspec already exists in worktree", () => {
      const localOpenspec = join(worktreePath, "openspec");
      mkdirSync(localOpenspec);

      setupWorktreeOpenspecSymlink(worktreePath, repoId);

      expect(lstatSync(localOpenspec).isSymbolicLink()).toBe(false);
      expect(lstatSync(localOpenspec).isDirectory()).toBe(true);
    });

    test("skips if openspec symlink already exists in worktree", () => {
      const localOpenspec = join(worktreePath, "openspec");
      symlinkSync(globalOpenspecPath, localOpenspec);

      setupWorktreeOpenspecSymlink(worktreePath, repoId);

      expect(lstatSync(localOpenspec).isSymbolicLink()).toBe(true);
      expect(readlinkSync(localOpenspec)).toBe(globalOpenspecPath);
    });

    test("is idempotent when called multiple times", () => {
      setupWorktreeOpenspecSymlink(worktreePath, repoId);
      setupWorktreeOpenspecSymlink(worktreePath, repoId);

      const symlinkPath = join(worktreePath, "openspec");
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(symlinkPath)).toBe(globalOpenspecPath);
    });
  });

  describe("buildPromptForExecution", () => {
    test("builds prompt with template variables resolved", async () => {
      const task = createMockTask({ worktree_path: "/test/worktree" });

      const executorCtx: ExecutorContext = {
        task,
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: tmpdir(),
        timeoutSecs: 300,
        fastMode: false,
      };

      const result = await buildPromptForExecution({
        executorCtx,
        worktreeInfo: {
          path: "/test/worktree",
          branch: "task-1",
          baseBranch: "main",
          baseCommit: "abc123",
        },
        stepCommand: {
          id: "step-1",
          type: "implement",
          promptTemplate: "Task: {{task.id}}, Branch: {{worktree.branch}}, Step: {{step.type}}",
          signals: [],
          attempt: 1,
          iteration: 0,
        },
        executionId: "exec-1",
      });

      expect(result).toBe("Task: task-1, Branch: task-1, Step: implement");
    });

    test("handles missing executionId", async () => {
      const task = createMockTask({ worktree_path: "/test/worktree" });

      const executorCtx: ExecutorContext = {
        task,
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: tmpdir(),
        timeoutSecs: 300,
        fastMode: false,
      };

      const result = await buildPromptForExecution({
        executorCtx,
        worktreeInfo: {
          path: "/test/worktree",
          branch: "task-1",
          baseBranch: "main",
          baseCommit: "abc123",
        },
        stepCommand: {
          id: "step-1",
          type: "implement",
          promptTemplate: "Execution: {{step.executionId}}",
          signals: [],
          attempt: 1,
          iteration: 0,
        },
      });

      expect(result).toBe("Execution: ");
    });

    test("resolves step.iteration placeholder from stepCommand", async () => {
      const task = createMockTask({ worktree_path: "/test/worktree" });

      const executorCtx: ExecutorContext = {
        task,
        repoId: "repo-1",
        repoPath: "/test/repo",
        changePath: "/test/repo/changes/feat-1",
        worktreePath: "/test/worktree",
        logsDir: tmpdir(),
        timeoutSecs: 300,
        fastMode: false,
      };

      const result = await buildPromptForExecution({
        executorCtx,
        worktreeInfo: {
          path: "/test/worktree",
          branch: "task-1",
          baseBranch: "main",
          baseCommit: "abc123",
        },
        stepCommand: {
          id: "step-1",
          type: "review",
          promptTemplate: "This is iteration {{step.iteration}} of the review",
          signals: [],
          attempt: 1,
          iteration: 2,
        },
        executionId: "exec-1",
      });

      expect(result).toBe("This is iteration 2 of the review");
    });
  });

  describe("processAgentCompletion", () => {
    test("returns success result for zero exit code", () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      mkdirSync(testLogsDir, { recursive: true });
      const logFile = join(testLogsDir, "test.jsonl");

      const result = processAgentCompletion(
        logFile,
        { exitCode: 0, sessionId: "session-123", timedOut: false },
        [],
      );

      expect(result.exitCode).toBe(0);
      expect(result.status).toBe("success");
      expect(result.sessionId).toBe("session-123");

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });

    test("returns failure result for non-zero exit code", () => {
      const result = processAgentCompletion(
        "/nonexistent/log.jsonl",
        { exitCode: 1, sessionId: "session-123", timedOut: false },
        [],
      );

      expect(result.exitCode).toBe(1);
      expect(result.status).toBe("failure");
    });

    test("returns timeout result when timedOut is true", () => {
      const result = processAgentCompletion(
        "/nonexistent/log.jsonl",
        { exitCode: -1, timedOut: true },
        [],
      );

      expect(result.status).toBe("timeout");
    });

    test("detects signals from log file content", () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      mkdirSync(testLogsDir, { recursive: true });
      const logFile = join(testLogsDir, "test.jsonl");

      const logContent = [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Processing <aop>IMPL_DONE</aop> signal" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "More output" }] },
        }),
      ].join("\n");
      Bun.write(logFile, logContent);

      const result = processAgentCompletion(
        logFile,
        { exitCode: 0, sessionId: "session-456", timedOut: false },
        [sig("IMPL_DONE")],
      );

      expect(result.exitCode).toBe(0);
      expect(result.status).toBe("success");
      expect(result.signal).toBe("IMPL_DONE");

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });

    test("extracts pauseContext when REQUIRES_INPUT signal is detected", () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      mkdirSync(testLogsDir, { recursive: true });
      const logFile = join(testLogsDir, "test.jsonl");

      const logContent = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: "I need user input.\n<aop>REQUIRES_INPUT</aop>\nINPUT_REASON: Need clarification on the database schema\nINPUT_TYPE: text",
              },
            ],
          },
        }),
      ].join("\n");
      Bun.write(logFile, logContent);

      const result = processAgentCompletion(logFile, { exitCode: 0, timedOut: false }, [
        sig("REQUIRES_INPUT"),
      ]);

      expect(result.signal).toBe("REQUIRES_INPUT");
      expect(result.pauseContext).toBe(
        "INPUT_REASON: Need clarification on the database schema\nINPUT_TYPE: text",
      );

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });

    test("returns undefined pauseContext when signal is not REQUIRES_INPUT", () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      mkdirSync(testLogsDir, { recursive: true });
      const logFile = join(testLogsDir, "test.jsonl");

      const logContent = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Done <aop>IMPL_DONE</aop>" }],
        },
      });
      Bun.write(logFile, logContent);

      const result = processAgentCompletion(logFile, { exitCode: 0, timedOut: false }, [
        sig("IMPL_DONE"),
      ]);

      expect(result.signal).toBe("IMPL_DONE");
      expect(result.pauseContext).toBeUndefined();

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });

    test("extracts pauseContext with only INPUT_REASON tag", () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      mkdirSync(testLogsDir, { recursive: true });
      const logFile = join(testLogsDir, "test.jsonl");

      const logContent = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "<aop>REQUIRES_INPUT</aop>\nINPUT_REASON: Need API key from user",
            },
          ],
        },
      });
      Bun.write(logFile, logContent);

      const result = processAgentCompletion(logFile, { exitCode: 0, timedOut: false }, [
        sig("REQUIRES_INPUT"),
      ]);

      expect(result.signal).toBe("REQUIRES_INPUT");
      expect(result.pauseContext).toBe("INPUT_REASON: Need API key from user");

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });

    test("suppresses signal when exit code is non-zero", () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      mkdirSync(testLogsDir, { recursive: true });
      const logFile = join(testLogsDir, "test.jsonl");

      const logContent = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Processing <aop>IMPL_DONE</aop> then crash" }],
        },
      });
      Bun.write(logFile, logContent);

      const result = processAgentCompletion(logFile, { exitCode: 1, timedOut: false }, [
        sig("IMPL_DONE"),
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.status).toBe("failure");
      expect(result.signal).toBeUndefined();

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });

    test("detects signal when exit code is 0", () => {
      const testLogsDir = join(tmpdir(), `aop-test-logs-${Date.now()}`);
      mkdirSync(testLogsDir, { recursive: true });
      const logFile = join(testLogsDir, "test.jsonl");

      const logContent = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Done <aop>IMPL_DONE</aop>" }],
        },
      });
      Bun.write(logFile, logContent);

      const result = processAgentCompletion(logFile, { exitCode: 0, timedOut: false }, [
        sig("IMPL_DONE"),
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.status).toBe("success");
      expect(result.signal).toBe("IMPL_DONE");

      if (existsSync(testLogsDir)) rmSync(testLogsDir, { recursive: true });
    });

    test("handles missing log file gracefully", () => {
      const result = processAgentCompletion(
        "/nonexistent/log.jsonl",
        { exitCode: 0, timedOut: false },
        [],
      );

      expect(result.exitCode).toBe(0);
      expect(result.sessionId).toBeUndefined();
    });
  });

  describe("finalizeExecutionAndGetNextStep", () => {
    test("updates local execution records on success", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const result = await finalizeExecutionAndGetNextStep(ctx, "task-1", "exec-1", "step-1", {
        exitCode: 0,
        status: "success",
      });

      expect(result).toBeNull();

      const execution = await ctx.executionRepository.getExecution("exec-1");
      expect(execution?.status).toBe(ExecutionStatus.COMPLETED);

      const step = await ctx.executionRepository.getStepExecution("step-1");
      expect(step?.status).toBe(StepExecutionStatus.SUCCESS);
      expect(step?.exit_code).toBe(0);

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("BLOCKED");
    });

    test("updates local execution records on failure", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const result = await finalizeExecutionAndGetNextStep(ctx, "task-1", "exec-1", "step-1", {
        exitCode: 1,
        status: "failure",
      });

      expect(result).toBeNull();

      const execution = await ctx.executionRepository.getExecution("exec-1");
      expect(execution?.status).toBe(ExecutionStatus.FAILED);

      const step = await ctx.executionRepository.getStepExecution("step-1");
      expect(step?.status).toBe(StepExecutionStatus.FAILURE);

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("BLOCKED");
    });

    test("updates local execution records on timeout", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const result = await finalizeExecutionAndGetNextStep(ctx, "task-1", "exec-1", "step-1", {
        exitCode: -1,
        status: "timeout",
      });

      expect(result).toBeNull();

      const step = await ctx.executionRepository.getStepExecution("step-1");
      expect(step?.error).toBe("Inactivity timeout");

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("BLOCKED");
    });

    test("returns null when task not found", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const result = await finalizeExecutionAndGetNextStep(
        ctx,
        "nonexistent-task",
        "exec-1",
        "step-1",
        {
          exitCode: 0,
          status: "success",
        },
      );

      expect(result).toBeNull();
    });

    test("syncs task status when serverSync is provided", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() => Promise.reject(new Error("Not connected"))),
      };

      await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 0,
          status: "success",
        },
        mockServerSync as never,
      );

      expect(mockServerSync.syncTask).toHaveBeenCalledWith("task-1", "repo-1", "BLOCKED");
    });

    test("returns next step from server when available", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const nextStep = {
        id: "server-step-2",
        type: "review",
        promptTemplate: "Review the changes",
        signals: [sig("REVIEW_DONE")],
        attempt: 1,
      };

      const nextExecution = {
        id: "server-exec-2",
        taskId: "task-1",
        status: "running" as const,
      };

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() =>
          Promise.resolve({
            taskStatus: "WORKING",
            step: nextStep,
            execution: nextExecution,
          }),
        ),
      };

      const result = await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 0,
          status: "success",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
          attempt: 1,
        },
      );

      expect(result).not.toBeNull();
      expect(result?.step.id).toBe("server-step-2");
      expect(result?.execution.id).toBe("server-exec-2");
    });

    test("handles server completion with task done status", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() =>
          Promise.resolve({
            taskStatus: "DONE",
          }),
        ),
      };

      const result = await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 0,
          status: "success",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
          attempt: 1,
        },
      );

      expect(result).toBeNull();

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("DONE");
    });

    test("falls back to BLOCKED when server completeStep throws error", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() => Promise.reject(new Error("Server connection failed"))),
      };

      const result = await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 0,
          status: "success",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
          attempt: 1,
        },
      );

      expect(result).toBeNull();

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("BLOCKED");
      expect(mockServerSync.syncTask).toHaveBeenCalledWith("task-1", "repo-1", "BLOCKED");
    });

    test("falls back to local status on failure when server completeStep throws error", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() => Promise.reject(new Error("Server unavailable"))),
      };

      const result = await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 1,
          status: "failure",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
          attempt: 1,
        },
      );

      expect(result).toBeNull();

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("BLOCKED");
    });

    test("uses default attempt value when not provided in serverStepInfo", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() =>
          Promise.resolve({
            taskStatus: "DONE",
          }),
        ),
      };

      await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 0,
          status: "success",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
        },
      );

      expect(mockServerSync.completeStep).toHaveBeenCalledWith(
        "server-step-1",
        expect.objectContaining({
          attempt: 1,
        }),
      );
    });

    test("sends timeout error to server", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() =>
          Promise.resolve({
            taskStatus: "BLOCKED",
          }),
        ),
      };

      await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: -1,
          status: "timeout",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
          attempt: 1,
        },
      );

      expect(mockServerSync.completeStep).toHaveBeenCalledWith(
        "server-step-1",
        expect.objectContaining({
          status: "failure",
          error: { code: "agent_timeout", message: "Agent timed out" },
        }),
      );
    });

    test("sends agent crash error to server on failure", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() =>
          Promise.resolve({
            taskStatus: "BLOCKED",
          }),
        ),
      };

      await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 127,
          status: "failure",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
          attempt: 1,
        },
      );

      expect(mockServerSync.completeStep).toHaveBeenCalledWith(
        "server-step-1",
        expect.objectContaining({
          status: "failure",
          error: { code: "agent_crash", message: "Agent exited with code 127" },
        }),
      );
    });

    test("includes pauseContext in server completion for REQUIRES_INPUT signal", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() =>
          Promise.resolve({
            taskStatus: "PAUSED",
          }),
        ),
      };

      await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 0,
          status: "success",
          signal: "REQUIRES_INPUT",
          pauseContext: "INPUT_REASON: Need database schema\nINPUT_TYPE: text",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
          attempt: 1,
        },
      );

      expect(mockServerSync.completeStep).toHaveBeenCalledWith(
        "server-step-1",
        expect.objectContaining({
          signal: "REQUIRES_INPUT",
          pauseContext: "INPUT_REASON: Need database schema\nINPUT_TYPE: text",
        }),
      );

      const task = await ctx.taskRepository.get("task-1");
      expect(task?.status).toBe("PAUSED");
    });

    test("includes signal in server completion", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() =>
          Promise.resolve({
            taskStatus: "DONE",
          }),
        ),
      };

      await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 0,
          status: "success",
          signal: "REVIEW_DONE",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
          attempt: 1,
        },
      );

      expect(mockServerSync.completeStep).toHaveBeenCalledWith(
        "server-step-1",
        expect.objectContaining({
          signal: "REVIEW_DONE",
        }),
      );
    });

    test("stores pauseContext in step execution record", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      const mockServerSync = {
        syncTask: mock(() => Promise.resolve()),
        completeStep: mock(() =>
          Promise.resolve({
            taskStatus: "PAUSED",
          }),
        ),
      };

      await finalizeExecutionAndGetNextStep(
        ctx,
        "task-1",
        "exec-1",
        "step-1",
        {
          exitCode: 0,
          status: "success",
          signal: "REQUIRES_INPUT",
          pauseContext: "INPUT_REASON: Need API key\nINPUT_TYPE: text",
        },
        mockServerSync as never,
        {
          serverStepId: "server-step-1",
          serverExecutionId: "server-exec-1",
          attempt: 1,
        },
      );

      const step = await ctx.executionRepository.getStepExecution("step-1");
      expect(step?.pause_context).toBe("INPUT_REASON: Need API key\nINPUT_TYPE: text");
    });

    test("stores signal in step execution record", async () => {
      await createTestRepo(db, "repo-1", "/test/repo");
      await createTestTask(db, "task-1", "repo-1", "changes/feat-1", "WORKING");
      await ctx.executionRepository.createExecution({
        id: "exec-1",
        task_id: "task-1",
        status: ExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });
      await ctx.executionRepository.createStepExecution({
        id: "step-1",
        execution_id: "exec-1",
        status: StepExecutionStatus.RUNNING,
        started_at: new Date().toISOString(),
      });

      await finalizeExecutionAndGetNextStep(ctx, "task-1", "exec-1", "step-1", {
        exitCode: 0,
        status: "success",
        signal: "NEEDS_REVIEW",
      });

      const step = await ctx.executionRepository.getStepExecution("step-1");
      expect(step?.signal).toBe("NEEDS_REVIEW");
    });
  });

  describe("ensureDir", () => {
    test("creates directory if it does not exist", () => {
      const testDir = join(tmpdir(), `aop-test-ensure-${Date.now()}`);

      expect(existsSync(testDir)).toBe(false);

      ensureDir(testDir);

      expect(existsSync(testDir)).toBe(true);

      rmSync(testDir, { recursive: true });
    });

    test("does nothing if directory already exists", () => {
      const testDir = join(tmpdir(), `aop-test-ensure-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      ensureDir(testDir);

      expect(existsSync(testDir)).toBe(true);

      rmSync(testDir, { recursive: true });
    });
  });

  describe("readRunResultFromLog", () => {
    test("returns exitCode 1 when log file does not exist", () => {
      const result = readRunResultFromLog("/nonexistent/path.jsonl");

      expect(result.exitCode).toBe(1);
    });

    test("returns exitCode 0 when last result is success", () => {
      const testDir = join(tmpdir(), `aop-test-readlog-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      const logFile = join(testDir, "test.jsonl");

      const content = [
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
        JSON.stringify({ type: "result", subtype: "success" }),
      ].join("\n");
      Bun.write(logFile, content);

      const result = readRunResultFromLog(logFile);

      expect(result.exitCode).toBe(0);

      rmSync(testDir, { recursive: true });
    });

    test("returns exitCode 1 when last result is failure", () => {
      const testDir = join(tmpdir(), `aop-test-readlog-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      const logFile = join(testDir, "test.jsonl");

      const content = JSON.stringify({ type: "result", subtype: "error" });
      Bun.write(logFile, content);

      const result = readRunResultFromLog(logFile);

      expect(result.exitCode).toBe(1);

      rmSync(testDir, { recursive: true });
    });

    test("returns exitCode 1 when log has no result entry", () => {
      const testDir = join(tmpdir(), `aop-test-readlog-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      const logFile = join(testDir, "test.jsonl");

      const content = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "output" }] },
      });
      Bun.write(logFile, content);

      const result = readRunResultFromLog(logFile);

      expect(result.exitCode).toBe(1);

      rmSync(testDir, { recursive: true });
    });

    test("uses last result entry when multiple exist", () => {
      const testDir = join(tmpdir(), `aop-test-readlog-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      const logFile = join(testDir, "test.jsonl");

      const content = [
        JSON.stringify({ type: "result", subtype: "error" }),
        JSON.stringify({ type: "result", subtype: "success" }),
      ].join("\n");
      Bun.write(logFile, content);

      const result = readRunResultFromLog(logFile);

      expect(result.exitCode).toBe(0);

      rmSync(testDir, { recursive: true });
    });
  });

  describe("pollForProcessExit", () => {
    test("resolves immediately for non-existent process", async () => {
      await pollForProcessExit(999999999);
    });

    test("resolves immediately for current process pid if it were dead", async () => {
      // pollForProcessExit checks isAgentRunning which returns true for alive non-zombie processes
      // For current process it will poll forever, so just test with dead PID
      const start = Date.now();
      await pollForProcessExit(999999999);
      const elapsed = Date.now() - start;

      // Should resolve almost immediately, not after a poll interval
      expect(elapsed).toBeLessThan(500);
    });
  });
});
