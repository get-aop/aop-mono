import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  ExecutionInfo,
  StepCommand,
  StepCompleteResponse,
  TaskStatus,
} from "@aop/common/protocol";
import { GitManager, WorktreeExistsError, type WorktreeInfo } from "@aop/git-manager";
import { aopPaths, generateTypeId, getLogger } from "@aop/infra";
import { ClaudeCodeProvider, extractAssistantText } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { forEachJsonlEntry, parseJsonlEntry } from "../events/log-file-tailer.ts";
import type { ServerSync } from "../orchestrator/sync/server-sync.ts";
import { detectSignal } from "../orchestrator/sync/signal-detector.ts";
import { createTemplateContext, resolveTemplate } from "../orchestrator/sync/template-resolver.ts";
import { SettingKey } from "../settings/types.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import type { ExecuteResult, ExecutorContext } from "./types.ts";

const logger = getLogger("executor");

export interface ExecuteTaskOptions {
  ctx: LocalServerContext;
  task: Task;
  stepCommand: StepCommand;
  executionInfo: ExecutionInfo;
  serverSync?: ServerSync;
  provider?: ClaudeCodeProvider;
}

export const executeTask = async (
  ctx: LocalServerContext,
  task: Task,
  stepCommand: StepCommand,
  executionInfo: ExecutionInfo,
  serverSync?: ServerSync,
  provider?: ClaudeCodeProvider,
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
  provider?: ClaudeCodeProvider;
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

  const stepId = await createStepRecord(ctx, executionId, stepCommand.type);
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

  return spawnAgentWithReaper({
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
  });
};

interface SpawnAgentOptions {
  ctx: LocalServerContext;
  executorCtx: ExecutorContext;
  worktreeInfo: WorktreeInfo;
  prompt: string;
  stepId: string;
  executionId: string;
  stepCommand: StepCommand;
  executionInfo: ExecutionInfo;
  taskId: string;
  repoId: string;
  signals?: string[];
  serverSync?: ServerSync;
  provider?: ClaudeCodeProvider;
}

const spawnAgentWithReaper = (opts: SpawnAgentOptions): Promise<void> => {
  const {
    ctx,
    executorCtx,
    stepId,
    taskId,
    prompt,
    signals = [],
    provider = new ClaudeCodeProvider(),
  } = opts;

  const logFile = join(executorCtx.logsDir, `${stepId}.jsonl`);
  const timeoutMs = executorCtx.timeoutSecs * 1000;

  return provider
    .run({
      prompt,
      cwd: executorCtx.worktreePath,
      logFilePath: logFile,
      env: {
        AOP_TASK_ID: taskId,
        AOP_STEP_ID: stepId,
      },
      onSpawn: async (pid) => {
        await ctx.executionRepository.updateStepExecution(stepId, {
          agent_pid: pid,
        });
        logger.info("Agent spawned with PID {pid}", { pid, stepId });
      },
      inactivityTimeoutMs: timeoutMs,
    })
    .then((runResult) => handleAgentCompletion(opts, logFile, runResult, signals));
};

const handleAgentCompletion = async (
  opts: SpawnAgentOptions,
  logFile: string,
  runResult: { exitCode: number; sessionId?: string; timedOut?: boolean },
  signals: string[],
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

  populateLogBuffer(ctx, logFile, executionId);

  const completionStatus = result.status === "success" ? "completed" : "failed";
  ctx.logBuffer.markComplete(executionId, completionStatus);

  await persistExecutionLogs(ctx, executionId);
  cleanupLogFile(logFile);

  const currentTask = await ctx.taskRepository.get(taskId);
  if (currentTask && currentTask.status !== "WORKING") {
    logger.info("Task status changed to {status}, skipping next step", {
      taskId,
      status: currentTask.status,
    });
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

const syncTaskStatus = async (
  serverSync: ServerSync,
  taskId: string,
  repoId: string,
  status: TaskStatus,
): Promise<void> => {
  try {
    await serverSync.syncTask(taskId, repoId, status);
  } catch (err) {
    logger.warn("Failed to sync task status: {error}", {
      taskId,
      status,
      error: String(err),
    });
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
): Promise<string> => {
  const stepId = generateTypeId("step");
  const now = new Date().toISOString();

  await ctx.executionRepository.createStepExecution({
    id: stepId,
    execution_id: executionId,
    step_type: stepType ?? null,
    status: StepExecutionStatus.RUNNING,
    started_at: now,
  });

  return stepId;
};

export const createWorktree = async (ctx: ExecutorContext): Promise<WorktreeInfo> => {
  const gitManager = new GitManager({ repoPath: ctx.repoPath, repoId: ctx.repoId });
  await gitManager.init();
  const baseBranch = ctx.task.base_branch ?? (await gitManager.getDefaultBranch());
  try {
    return await gitManager.createWorktree(ctx.task.id, baseBranch);
  } catch (error) {
    if (error instanceof WorktreeExistsError) {
      logger.warn("Worktree already exists, skipping creation", {
        taskId: ctx.task.id,
      });
      return {
        path: aopPaths.worktree(ctx.repoId, ctx.task.id),
        branch: ctx.task.id,
        baseBranch,
        baseCommit: "",
      };
    }
    throw error;
  }
};

export const setupWorktreeOpenspecSymlink = (worktreePath: string, repoId: string): void => {
  const localOpenspec = join(worktreePath, aopPaths.relativeOpenspec());
  try {
    lstatSync(localOpenspec);
    return;
  } catch {}
  const globalOpenspec = aopPaths.openspec(repoId);
  symlinkSync(globalOpenspec, localOpenspec);
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
  });
  return resolveTemplate(stepCommand.promptTemplate, templateContext);
};

export const processAgentCompletion = (
  logFile: string,
  runResult: { exitCode: number; sessionId?: string; timedOut?: boolean },
  signals: string[],
): ExecuteResult => {
  const collectedText: string[] = [];

  if (existsSync(logFile)) {
    const content = readFileSync(logFile, "utf-8");
    forEachJsonlEntry(content, (data) => {
      const text = extractAssistantText(data);
      if (text) collectedText.push(text);
    });
  }

  const status = runResult.timedOut ? "timeout" : runResult.exitCode === 0 ? "success" : "failure";
  const fullOutput = collectedText.join("\n");
  const { signal } = detectSignal(fullOutput, signals);

  return {
    exitCode: runResult.exitCode,
    sessionId: runResult.sessionId,
    status,
    signal,
  };
};

export const populateLogBuffer = (
  ctx: LocalServerContext,
  logFile: string,
  executionId: string,
): void => {
  if (!existsSync(logFile)) return;

  const content = readFileSync(logFile, "utf-8");
  forEachJsonlEntry(content, (data) => {
    for (const line of parseJsonlEntry(data)) {
      ctx.logBuffer.push(executionId, line);
    }
  });
};

export const cleanupLogFile = (logFile: string): void => {
  try {
    unlinkSync(logFile);
  } catch (err) {
    logger.warn("Failed to cleanup log file: {error}", {
      logFile,
      error: String(err),
    });
  }
};

export const persistExecutionLogs = async (
  ctx: LocalServerContext,
  executionId: string,
): Promise<void> => {
  const lines = ctx.logBuffer.getLines(executionId);
  if (lines.length === 0) return;

  const logs = lines.map((line) => ({
    execution_id: executionId,
    stream: line.stream,
    content: line.content,
    timestamp: line.timestamp,
  }));

  try {
    await ctx.executionRepository.saveExecutionLogs(logs);
    logger.debug("Persisted {count} log lines for execution {executionId}", {
      count: logs.length,
      executionId,
    });
  } catch (err) {
    logger.warn("Failed to persist execution logs: {error}", {
      executionId,
      error: String(err),
    });
  }
};

export interface ServerStepInfo {
  serverStepId?: string;
  serverExecutionId?: string;
  attempt?: number;
}

interface NextStepInfo {
  step: StepCommand;
  execution: ExecutionInfo;
}

interface ServerCompletionResult {
  handled: boolean;
  nextStep?: NextStepInfo;
}

const tryServerCompletion = async (
  ctx: LocalServerContext,
  taskId: string,
  result: ExecuteResult,
  serverSync?: ServerSync,
  serverStepInfo?: ServerStepInfo,
): Promise<ServerCompletionResult> => {
  if (!serverSync || !serverStepInfo?.serverStepId || !serverStepInfo?.serverExecutionId) {
    return { handled: false };
  }

  const completionResult = await completeStepOnServer(
    serverSync,
    serverStepInfo.serverStepId,
    serverStepInfo.serverExecutionId,
    serverStepInfo.attempt ?? 1,
    result,
  );

  if (!completionResult) {
    return { handled: false };
  }

  await ctx.taskRepository.update(taskId, {
    status: completionResult.taskStatus,
  });

  if (
    completionResult.step &&
    completionResult.execution &&
    completionResult.taskStatus === "WORKING"
  ) {
    return {
      handled: true,
      nextStep: {
        step: completionResult.step,
        execution: completionResult.execution,
      },
    };
  }

  return { handled: true };
};

export const finalizeExecutionAndGetNextStep = async (
  ctx: LocalServerContext,
  taskId: string,
  executionId: string,
  stepId: string,
  result: ExecuteResult,
  serverSync?: ServerSync,
  serverStepInfo?: ServerStepInfo,
): Promise<NextStepInfo | null> => {
  await updateStepExecutionRecord(ctx, stepId, result);

  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    logger.error("Task not found during finalization", { taskId });
    await finalizeExecutionRecord(ctx, executionId, result);
    return null;
  }

  const serverResult = await tryServerCompletion(ctx, taskId, result, serverSync, serverStepInfo);
  if (serverResult.handled) {
    if (serverResult.nextStep) {
      return serverResult.nextStep;
    }
    await finalizeExecutionRecord(ctx, executionId, result);
    return null;
  }

  await finalizeExecutionRecord(ctx, executionId, result);

  const taskStatus: TaskStatus = result.status === "success" ? "DONE" : "BLOCKED";
  await ctx.taskRepository.update(taskId, { status: taskStatus });

  if (serverSync) {
    await syncTaskStatus(serverSync, taskId, task.repo_id, taskStatus);
  }

  return null;
};

const updateStepExecutionRecord = async (
  ctx: LocalServerContext,
  stepId: string,
  result: ExecuteResult,
): Promise<void> => {
  const now = new Date().toISOString();
  const stepStatus =
    result.status === "success" ? StepExecutionStatus.SUCCESS : StepExecutionStatus.FAILURE;

  await ctx.executionRepository.updateStepExecution(stepId, {
    status: stepStatus,
    exit_code: result.exitCode,
    signal: result.signal ?? null,
    ended_at: now,
    error: result.status === "timeout" ? "Inactivity timeout" : null,
  });
};

const finalizeExecutionRecord = async (
  ctx: LocalServerContext,
  executionId: string,
  result: ExecuteResult,
): Promise<void> => {
  const now = new Date().toISOString();
  await ctx.executionRepository.updateExecution(executionId, {
    status: result.status === "success" ? ExecutionStatus.COMPLETED : ExecutionStatus.FAILED,
    completed_at: now,
  });
};

const completeStepOnServer = async (
  serverSync: ServerSync,
  stepId: string,
  executionId: string,
  attempt: number,
  result: ExecuteResult,
): Promise<StepCompleteResponse | null> => {
  try {
    const stepResult = {
      executionId,
      attempt,
      status: result.status === "success" ? ("success" as const) : ("failure" as const),
      signal: result.signal,
      error:
        result.status === "timeout"
          ? { code: "agent_timeout" as const, message: "Agent timed out" }
          : result.status === "failure"
            ? {
                code: "agent_crash" as const,
                message: `Agent exited with code ${result.exitCode}`,
              }
            : undefined,
      durationMs: 0,
    };

    const response = await serverSync.completeStep(stepId, stepResult);
    logger.info("Step completed on server, taskStatus: {taskStatus}", {
      stepId,
      taskStatus: response.taskStatus,
      hasNextStep: !!response.step,
      signal: result.signal,
    });

    return response;
  } catch (err) {
    logger.warn("Failed to complete step on server: {error}", {
      stepId,
      error: String(err),
    });
    return null;
  }
};

export const ensureDir = (dir: string): void => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};
