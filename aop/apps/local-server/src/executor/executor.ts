import { join } from "node:path";
import type { ExecutionInfo, SignalDefinition, StepCommand } from "@aop/common/protocol";
import type { WorktreeInfo } from "@aop/git-manager";
import { aopPaths, generateTypeId, getLogger } from "@aop/infra";
import type { LLMProvider } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import type { ServerSync } from "../orchestrator/sync/server-sync.ts";
import { createTemplateContext, resolveTemplate } from "../orchestrator/sync/template-resolver.ts";
import { SettingKey } from "../settings/types.ts";
import {
  cleanupLogFile,
  ensureDir,
  finalizeExecutionAndGetNextStep,
  finalizeExecutionRecord,
  populateLogBuffer,
  processAgentCompletion,
  syncTaskStatus,
  updateStepExecutionRecord,
} from "./completion-handler.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import type { SpawnAgentOptions } from "./step-launcher.ts";
import { spawnAgentWithReaper } from "./step-launcher.ts";
import type { ExecutorContext, StepWithTask } from "./types.ts";
import { createWorktree, setupWorktreeOpenspecSymlink } from "./worktree-manager.ts";

// Re-export from sub-modules for backward compatibility
export {
  cleanupLogFile,
  ensureDir,
  extractPauseContext,
  finalizeExecutionAndGetNextStep,
  finalizeExecutionRecord,
  persistStepLogs,
  populateLogBuffer,
  processAgentCompletion,
  type ServerStepInfo,
} from "./completion-handler.ts";
export {
  pollForProcessExit,
  REAPER_POLL_INTERVAL_MS,
  readRunResultFromLog,
  type SpawnAgentOptions,
} from "./step-launcher.ts";
export { createWorktree, setupWorktreeOpenspecSymlink } from "./worktree-manager.ts";

const logger = getLogger("executor");

export interface ExecuteTaskOptions {
  ctx: LocalServerContext;
  task: Task;
  stepCommand: StepCommand;
  executionInfo: ExecutionInfo;
  serverSync?: ServerSync;
  provider?: LLMProvider;
}

export const executeTask = async (
  ctx: LocalServerContext,
  task: Task,
  stepCommand: StepCommand,
  executionInfo: ExecutionInfo,
  serverSync?: ServerSync,
  provider?: LLMProvider,
): Promise<void> => {
  const log = logger.with({ taskId: task.id, changePath: task.change_path });
  log.info("Starting task execution");

  const executorCtx = await buildContext(ctx, task);
  await markTaskWorking(ctx, task, executorCtx.worktreePath, serverSync);

  const worktreeInfo = await createWorktree(executorCtx);
  setupWorktreeOpenspecSymlink(worktreeInfo.path, executorCtx.repoId);
  log.info("Worktree ready at {path}", { path: worktreeInfo.path });

  const executionId = await createExecutionRecord(ctx, task.id);
  log.info("Created execution record", { executionId });

  return launchStep({
    ctx,
    executorCtx,
    worktreeInfo,
    executionId,
    stepCommand,
    executionInfo,
    taskId: task.id,
    repoId: task.repo_id,
    serverSync,
    provider,
  });
};

export const reattachToRunningAgent = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  serverSync?: ServerSync,
  provider?: LLMProvider,
): Promise<void> => {
  const { reattachToRunningAgent: reattachFn } = await import("./step-launcher.ts");
  return reattachFn(
    ctx,
    step,
    buildContext,
    createWorktree,
    handleAgentCompletion,
    serverSync,
    provider,
  );
};

export const handleAgentCompletion = async (
  opts: SpawnAgentOptions,
  logFile: string,
  runResult: { exitCode: number; sessionId?: string; timedOut?: boolean },
  signals: SignalDefinition[],
): Promise<void> => {
  const {
    ctx,
    executorCtx,
    worktreeInfo,
    executionId,
    stepId,
    stepCommand,
    executionInfo,
    taskId,
    repoId,
    serverSync,
    provider,
  } = opts;

  const result = processAgentCompletion(logFile, runResult, signals);
  logger.info("Agent finished step {stepType}", {
    stepType: stepCommand.type,
    exitCode: result.exitCode,
    status: result.status,
    signal: result.signal,
  });

  await ctx.logFlusher.finalFlush(stepId);

  populateLogBuffer(ctx, logFile, stepId);

  const completionStatus = result.status === "success" ? "completed" : "failed";
  ctx.logBuffer.markComplete(stepId, completionStatus);

  cleanupLogFile(logFile);

  const currentTask = await ctx.taskRepository.get(taskId);
  if (currentTask && currentTask.status !== "WORKING") {
    logger.info("Task status changed to {status}, skipping next step", {
      taskId,
      status: currentTask.status,
    });
    await updateStepExecutionRecord(ctx, stepId, result);
    await finalizeExecutionRecord(ctx, executionId, result);
    return;
  }

  const nextStepInfo = await finalizeExecutionAndGetNextStep(
    ctx,
    taskId,
    executionId,
    stepId,
    result,
    serverSync,
    {
      serverStepId: stepCommand.id,
      serverExecutionId: executionInfo.id,
      attempt: stepCommand.attempt,
    },
  );

  if (!nextStepInfo) return;

  const taskAfterServer = await ctx.taskRepository.get(taskId);
  if (!taskAfterServer || taskAfterServer.status !== "WORKING") {
    logger.info("Task status changed during server call, skipping next step", {
      taskId,
      status: taskAfterServer?.status,
    });
    return;
  }

  logger.info("Continuing to next step: {stepType}", {
    stepType: nextStepInfo.step.type,
  });
  await launchStep({
    ctx,
    executorCtx,
    worktreeInfo,
    executionId,
    stepCommand: nextStepInfo.step,
    executionInfo: nextStepInfo.execution,
    taskId,
    repoId,
    serverSync,
    provider,
  });
};

export const buildContext = async (
  ctx: LocalServerContext,
  task: Task,
  logsDir = aopPaths.logs(),
): Promise<ExecutorContext> => {
  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    throw new Error(`Repo not found: ${task.repo_id}`);
  }

  const timeoutSecs = Number.parseInt(
    await ctx.settingsRepository.get(SettingKey.AGENT_TIMEOUT_SECS),
    10,
  );

  const fastMode = (await ctx.settingsRepository.get(SettingKey.FAST_MODE)) === "true";

  ensureDir(logsDir);

  const changePath = join(aopPaths.repoDir(repo.id), task.change_path);
  const worktreePath = aopPaths.worktree(repo.id, task.id);

  return {
    task,
    repoId: repo.id,
    repoPath: repo.path,
    changePath,
    worktreePath,
    logsDir,
    timeoutSecs,
    fastMode,
  };
};

export const markTaskWorking = async (
  ctx: LocalServerContext,
  task: Task,
  worktreePath: string,
  serverSync?: ServerSync,
): Promise<void> => {
  await ctx.taskRepository.update(task.id, {
    status: "WORKING",
    worktree_path: worktreePath,
  });

  if (serverSync) {
    await syncTaskStatus(serverSync, task.id, task.repo_id, "WORKING");
  }
};

export const createExecutionRecord = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<string> => {
  const executionId = generateTypeId("exec");
  const now = new Date().toISOString();

  await ctx.executionRepository.createExecution({
    id: executionId,
    task_id: taskId,
    status: ExecutionStatus.RUNNING,
    started_at: now,
  });

  return executionId;
};

export const createStepRecord = async (
  ctx: LocalServerContext,
  executionId: string,
  stepType?: string,
  remoteStepId?: string,
  workflowStepId?: string,
  remoteExecutionId?: string,
  attempt?: number,
  iteration?: number,
  signals?: SignalDefinition[],
): Promise<string> => {
  const stepId = remoteStepId ?? generateTypeId("step");
  const now = new Date().toISOString();

  await ctx.executionRepository.createStepExecution({
    id: stepId,
    execution_id: executionId,
    step_id: workflowStepId ?? null,
    step_type: stepType ?? null,
    remote_execution_id: remoteExecutionId ?? null,
    attempt: attempt ?? null,
    iteration: iteration ?? null,
    signals_json: signals?.length ? JSON.stringify(signals) : null,
    status: StepExecutionStatus.RUNNING,
    started_at: now,
  });

  return stepId;
};

export interface BuildPromptOptions {
  executorCtx: ExecutorContext;
  worktreeInfo: WorktreeInfo;
  stepCommand: StepCommand;
  executionId?: string;
}

export const buildPromptForExecution = async (opts: BuildPromptOptions): Promise<string> => {
  const { executorCtx, worktreeInfo, stepCommand, executionId } = opts;

  const templateContext = createTemplateContext({
    worktreePath: worktreeInfo.path,
    worktreeBranch: worktreeInfo.branch,
    taskId: executorCtx.task.id,
    changePath: executorCtx.changePath,
    stepType: stepCommand.type,
    executionId: executionId ?? "",
    iteration: stepCommand.iteration,
    signals: stepCommand.signals,
    input: stepCommand.input,
  });
  return resolveTemplate(stepCommand.promptTemplate, templateContext);
};

// --- Private helpers ---

interface LaunchStepOptions {
  ctx: LocalServerContext;
  executorCtx: ExecutorContext;
  worktreeInfo: WorktreeInfo;
  executionId: string;
  stepCommand: StepCommand;
  executionInfo: ExecutionInfo;
  taskId: string;
  repoId: string;
  serverSync?: ServerSync;
  provider?: LLMProvider;
}

const launchStep = async (opts: LaunchStepOptions): Promise<void> => {
  const {
    ctx,
    executorCtx,
    worktreeInfo,
    executionId,
    stepCommand,
    executionInfo,
    taskId,
    repoId,
    serverSync,
    provider,
  } = opts;

  const currentTask = await ctx.taskRepository.get(taskId);
  if (!currentTask || currentTask.status !== "WORKING") {
    logger.info("Task no longer WORKING before step launch, skipping", {
      taskId,
      status: currentTask?.status,
    });
    return;
  }

  const stepId = await createStepRecord(
    ctx,
    executionId,
    stepCommand.type,
    stepCommand.id,
    stepCommand.stepId,
    executionInfo.id,
    stepCommand.attempt,
    stepCommand.iteration,
    stepCommand.signals,
  );
  logger.info("Created step record", {
    executionId,
    stepId,
    stepType: stepCommand.type,
  });

  const prompt = await buildPromptForExecution({
    executorCtx,
    worktreeInfo,
    stepCommand,
    executionId: executionInfo.id,
  });
  logger.info("Prompt rendered for step {stepType}, spawning agent", {
    stepType: stepCommand.type,
  });

  return spawnAgentWithReaper(
    {
      ctx,
      executorCtx,
      worktreeInfo,
      prompt,
      stepId,
      executionId,
      stepCommand,
      executionInfo,
      taskId,
      repoId,
      signals: stepCommand.signals,
      serverSync,
      provider,
    },
    handleAgentCompletion,
  );
};
