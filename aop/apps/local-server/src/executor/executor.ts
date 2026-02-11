import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  ExecutionInfo,
  SignalDefinition,
  StepCommand,
  StepCompleteResponse,
  TaskStatus,
} from "@aop/common/protocol";
import { GitManager, WorktreeExistsError, type WorktreeInfo } from "@aop/git-manager";
import { aopPaths, generateTypeId, getLogger } from "@aop/infra";
import {
  ClaudeCodeProvider,
  createProvider,
  extractAssistantText,
  type LLMProvider,
} from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { forEachJsonlEntry, parseJsonlEntry } from "../events/log-file-tailer.ts";
import type { ServerSync, StepCompletePayload } from "../orchestrator/sync/server-sync.ts";
import { detectSignal } from "../orchestrator/sync/signal-detector.ts";
import { createTemplateContext, resolveTemplate } from "../orchestrator/sync/template-resolver.ts";
import { SettingKey } from "../settings/types.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import { isAgentRunning } from "./process-utils.ts";
import type { ExecuteResult, ExecutorContext, StepWithTask } from "./types.ts";

const logger = getLogger("executor");
const COMPLETE_STEP_MAX_ATTEMPTS = 3;
const COMPLETE_STEP_RETRY_BASE_DELAY_MS = 500;

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

export interface SpawnAgentOptions {
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
  signals?: SignalDefinition[];
  serverSync?: ServerSync;
  provider?: LLMProvider;
}

export const REAPER_POLL_INTERVAL_MS = 2000;

const getProvider = async (ctx: LocalServerContext, task: Task) => {
  if (task.preferred_provider) {
    return createProvider(task.preferred_provider);
  }

  const providerKey = await ctx.settingsRepository.get(SettingKey.AGENT_PROVIDER);
  if (providerKey) {
    return createProvider(providerKey);
  }

  return new ClaudeCodeProvider();
};

const spawnAgentWithReaper = async (opts: SpawnAgentOptions): Promise<void> => {
  const {
    ctx,
    executorCtx,
    stepId,
    taskId,
    prompt,
    signals = [],
    provider: explicitProvider,
  } = opts;

  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  const provider = explicitProvider ?? (await getProvider(ctx, task));

  const logFile = join(executorCtx.logsDir, `${stepId}.jsonl`);
  const timeoutMs = executorCtx.timeoutSecs * 1000;

  // Agents are spawned as detached + unref'd processes so they survive server restarts.
  // provider.run() awaits proc.exited which may never resolve for unref'd processes.
  // We race two completion paths: provider resolution vs PID polling.
  const runResult = await spawnAndReap(ctx, provider, logFile, {
    prompt,
    cwd: executorCtx.worktreePath,
    logFilePath: logFile,
    env: { AOP_TASK_ID: taskId, AOP_STEP_ID: stepId },
    stepId,
    inactivityTimeoutMs: timeoutMs,
    fastMode: executorCtx.fastMode,
  });

  return handleAgentCompletion(opts, logFile, runResult, signals);
};

interface SpawnAndReapOptions {
  prompt: string;
  cwd?: string;
  logFilePath: string;
  env: Record<string, string>;
  stepId: string;
  inactivityTimeoutMs?: number;
  fastMode?: boolean;
}

type RunResultLike = { exitCode: number; sessionId?: string; timedOut?: boolean };

/**
 * Spawns the agent and waits for completion via whichever path resolves first:
 * - Path A: provider.run() resolves (proc.exited works, or mock provider)
 * - Path B: PID polling detects process exit/zombie (primary path for detached+unref agents)
 */
const spawnAndReap = (
  ctx: LocalServerContext,
  provider: LLMProvider,
  logFile: string,
  opts: SpawnAndReapOptions,
): Promise<RunResultLike> => {
  return new Promise<RunResultLike>((resolve, reject) => {
    let settled = false;
    let pollInterval: Timer | undefined;

    const settle = (result: RunResultLike) => {
      if (settled) return;
      settled = true;
      if (pollInterval) clearInterval(pollInterval);
      resolve(result);
    };

    provider
      .run({
        prompt: opts.prompt,
        cwd: opts.cwd,
        logFilePath: opts.logFilePath,
        env: opts.env,
        onSpawn: async (pid) => {
          await ctx.executionRepository.updateStepExecution(opts.stepId, {
            agent_pid: pid,
          });
          logger.info("Agent spawned with PID {pid}", { pid, stepId: opts.stepId });

          // Start PID polling — the primary completion mechanism for detached agents
          if (!isAgentRunning(pid)) {
            settle(readRunResultFromLog(logFile));
            return;
          }
          pollInterval = setInterval(() => {
            if (!isAgentRunning(pid)) {
              settle(readRunResultFromLog(logFile));
            }
          }, REAPER_POLL_INTERVAL_MS);
        },
        inactivityTimeoutMs: opts.inactivityTimeoutMs,
        fastMode: opts.fastMode,
      })
      .then((runResult) => {
        // provider.run() resolved — use its result directly (mock providers, or proc.exited worked)
        settle(runResult);
      })
      .catch((err) => {
        if (!settled) reject(err);
      });
  });
};

/** Polls until the process is no longer running (exited or zombie). */
export const pollForProcessExit = (pid: number): Promise<void> => {
  return new Promise((resolve) => {
    // Check immediately in case the process already exited
    if (!isAgentRunning(pid)) {
      resolve();
      return;
    }

    const interval = setInterval(() => {
      if (!isAgentRunning(pid)) {
        clearInterval(interval);
        resolve();
      }
    }, REAPER_POLL_INTERVAL_MS);
  });
};

/**
 * Reattaches to a running agent process from a previous server session.
 * Waits for the process to exit, then runs the normal completion pipeline
 * (log persistence → completeStep on server → next step chain).
 */
export const reattachToRunningAgent = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  serverSync?: ServerSync,
  provider?: LLMProvider,
): Promise<void> => {
  const task = await ctx.taskRepository.get(step.task_id);
  if (!task) throw new Error(`Task not found: ${step.task_id}`);

  const executorCtx = await buildContext(ctx, task);
  const worktreeInfo = await createWorktree(executorCtx);

  const pid = step.agent_pid;
  if (pid) {
    await pollForProcessExit(pid);
  }

  const logFile = join(executorCtx.logsDir, `${step.id}.jsonl`);
  const runResult = readRunResultFromLog(logFile);

  const opts: SpawnAgentOptions = {
    ctx,
    executorCtx,
    worktreeInfo,
    prompt: "",
    stepId: step.id,
    executionId: step.execution_id,
    stepCommand: {
      id: step.id,
      type: step.step_type ?? "unknown",
      stepId: step.step_id ?? undefined,
      promptTemplate: "",
      signals: step.signals_json ? JSON.parse(step.signals_json) : [],
      attempt: step.attempt ?? 1,
      iteration: step.iteration ?? 1,
    },
    executionInfo: {
      id: step.remote_execution_id ?? step.execution_id,
      workflowId: "",
    },
    taskId: step.task_id,
    repoId: task.repo_id,
    serverSync,
    provider,
  };

  const signals = step.signals_json ? JSON.parse(step.signals_json) : [];
  await handleAgentCompletion(opts, logFile, runResult, signals);
};

/** Reads the JSONL log file to determine exit code from the result entry. */
export const readRunResultFromLog = (logFile: string): { exitCode: number; timedOut?: boolean } => {
  if (!existsSync(logFile)) {
    return { exitCode: 1 };
  }

  const content = readFileSync(logFile, "utf-8");
  let lastResult: "success" | "failure" | null = null;

  forEachJsonlEntry(content, (data) => {
    if (data.type === "result") {
      lastResult = data.subtype === "success" ? "success" : "failure";
    }
  });

  return { exitCode: lastResult === "success" ? 0 : 1 };
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
    signals: stepCommand.signals,
    input: stepCommand.input,
  });
  return resolveTemplate(stepCommand.promptTemplate, templateContext);
};

export const processAgentCompletion = (
  logFile: string,
  runResult: { exitCode: number; sessionId?: string; timedOut?: boolean },
  signals: SignalDefinition[],
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
  // Only detect signals when the agent succeeded — a crashed/timed-out agent's output is unreliable
  const signal = status === "success" ? detectSignal(fullOutput, signals).signal : undefined;
  const pauseContext = signal === "REQUIRES_INPUT" ? extractPauseContext(fullOutput) : undefined;

  return {
    exitCode: runResult.exitCode,
    sessionId: runResult.sessionId,
    status,
    signal,
    pauseContext,
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

  // Server is the source of truth for workflow progression — without it we can't advance
  const taskStatus: TaskStatus = "BLOCKED";
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
    pause_context: result.pauseContext ?? null,
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const completeStepOnServer = async (
  serverSync: ServerSync,
  stepId: string,
  executionId: string,
  attempt: number,
  result: ExecuteResult,
): Promise<StepCompleteResponse | null> => {
  const stepResult = buildStepCompletePayload(executionId, attempt, result);

  for (let tryIndex = 1; tryIndex <= COMPLETE_STEP_MAX_ATTEMPTS; tryIndex++) {
    try {
      const response = await serverSync.completeStep(stepId, stepResult);
      logStepCompletedOnServer(stepId, response, result.signal);
      return response;
    } catch (err) {
      if (tryIndex >= COMPLETE_STEP_MAX_ATTEMPTS) {
        logStepCompletionRetriesExhausted(stepId, tryIndex, err);
        return null;
      }

      const retryDelayMs = getCompleteStepRetryDelayMs(tryIndex);
      logStepCompletionRetry(stepId, tryIndex, retryDelayMs, err);
      await sleep(retryDelayMs);
    }
  }

  return null;
};

const buildStepCompletePayload = (
  executionId: string,
  attempt: number,
  result: ExecuteResult,
): StepCompletePayload => ({
  executionId,
  attempt,
  status: result.status === "success" ? "success" : "failure",
  signal: result.signal,
  error: buildStepCompleteError(result),
  durationMs: 0,
  pauseContext: result.pauseContext,
});

const buildStepCompleteError = (result: ExecuteResult): StepCompletePayload["error"] => {
  if (result.status === "timeout") {
    return { code: "agent_timeout", message: "Agent timed out" };
  }
  if (result.status === "failure") {
    return {
      code: "agent_crash",
      message: `Agent exited with code ${result.exitCode}`,
    };
  }
  return undefined;
};

const logStepCompletedOnServer = (
  stepId: string,
  response: StepCompleteResponse,
  signal: string | undefined,
): void => {
  logger.info("Step completed on server, taskStatus: {taskStatus}", {
    stepId,
    taskStatus: response.taskStatus,
    hasNextStep: !!response.step,
    signal,
  });
};

const logStepCompletionRetriesExhausted = (
  stepId: string,
  attempts: number,
  err: unknown,
): void => {
  logger.warn("Failed to complete step on server after retries: {error}", {
    stepId,
    attempts,
    error: String(err),
  });
};

const getCompleteStepRetryDelayMs = (attempt: number): number =>
  COMPLETE_STEP_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

const logStepCompletionRetry = (
  stepId: string,
  attempt: number,
  delay: number,
  err: unknown,
): void => {
  logger.warn(
    "Failed to complete step on server (attempt {attempt}), retrying in {delay}ms: {error}",
    {
      stepId,
      attempt,
      delay,
      error: String(err),
    },
  );
};

export const extractPauseContext = (output: string): string | undefined => {
  const lines = output.split("\n");
  const contextLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("INPUT_REASON:") || line.startsWith("INPUT_TYPE:")) {
      contextLines.push(line);
    }
  }

  return contextLines.length > 0 ? contextLines.join("\n") : undefined;
};

export const ensureDir = (dir: string): void => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};
