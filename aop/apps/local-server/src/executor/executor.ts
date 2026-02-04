import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ExecutionInfo,
  StepCommand,
  StepCompleteResponse,
  TaskStatus,
} from "@aop/common/protocol";
import { GitManager, WorktreeExistsError, type WorktreeInfo } from "@aop/git-manager";
import { createFileOutputHandler, generateTypeId, getLogger } from "@aop/infra";
import { ClaudeCodeProvider, extractAssistantText } from "@aop/llm-provider";
import type { CommandContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import type { ServerSync } from "../orchestrator/sync/server-sync.ts";
import { detectSignal } from "../orchestrator/sync/signal-detector.ts";
import { createTemplateContext, resolveTemplate } from "../orchestrator/sync/template-resolver.ts";
import { SettingKey } from "../settings/types.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import type { ExecuteResult, ExecutorContext } from "./types.ts";

const logger = getLogger("aop", "executor");

export interface ExecuteTaskOptions {
  ctx: CommandContext;
  task: Task;
  stepCommand: StepCommand;
  executionInfo: ExecutionInfo;
  serverSync?: ServerSync;
  /** For testing: inject a custom provider */
  provider?: ClaudeCodeProvider;
}

export const executeTask = async (
  ctx: CommandContext,
  task: Task,
  stepCommand: StepCommand,
  executionInfo: ExecutionInfo,
  serverSync?: ServerSync,
  provider?: ClaudeCodeProvider,
): Promise<ExecuteResult> => {
  const log = logger.with({ taskId: task.id, changePath: task.change_path });
  log.info("Starting task execution");

  const executorCtx = await buildContext(ctx, task);
  await markTaskWorking(ctx, task, executorCtx.worktreePath, serverSync);

  const worktreeInfo = await createWorktree(executorCtx);
  log.info("Worktree ready at {path}", { path: worktreeInfo.path });

  let currentStep = stepCommand;
  let currentExecution = executionInfo;

  while (true) {
    const { executionId, stepId } = await createExecutionRecords(ctx, task.id, currentStep.type);
    log.info("Created execution records for step", {
      executionId,
      stepId,
      stepType: currentStep.type,
    });

    const prompt = await buildPromptForExecution({
      executorCtx,
      worktreeInfo,
      stepCommand: currentStep,
      executionId: currentExecution.id,
    });
    log.info("Prompt rendered for step {stepType}, starting agent", { stepType: currentStep.type });

    const result = await runAgentWithTimeout({
      ctx,
      executorCtx,
      prompt,
      stepId,
      signals: currentStep.signals,
      provider,
    });
    log.info("Agent finished step {stepType}", {
      stepType: currentStep.type,
      exitCode: result.exitCode,
      status: result.status,
      signal: result.signal,
    });

    const nextStepInfo = await finalizeExecutionAndGetNextStep(
      ctx,
      task.id,
      executionId,
      stepId,
      result,
      serverSync,
      {
        serverStepId: currentStep.id,
        serverExecutionId: currentExecution.id,
        attempt: currentStep.attempt,
      },
    );

    if (!nextStepInfo) {
      return result;
    }

    currentStep = nextStepInfo.step;
    currentExecution = nextStepInfo.execution;
    log.info("Continuing to next step: {stepType}", { stepType: currentStep.type });
  }
};

export const buildContext = async (
  ctx: CommandContext,
  task: Task,
  logsDir = join(homedir(), ".aop", "logs"),
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

  const changePath = join(repo.path, task.change_path);
  const worktreePath = join(repo.path, ".worktrees", task.id);

  return {
    task,
    repoPath: repo.path,
    changePath,
    worktreePath,
    logsDir,
    timeoutSecs,
  };
};

export const markTaskWorking = async (
  ctx: CommandContext,
  task: Task,
  worktreePath: string,
  serverSync?: ServerSync,
): Promise<void> => {
  await ctx.taskRepository.update(task.id, { status: "WORKING", worktree_path: worktreePath });

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

export const createExecutionRecords = async (
  ctx: CommandContext,
  taskId: string,
  stepType?: string,
): Promise<{ executionId: string; stepId: string }> => {
  const executionId = generateTypeId("exec");
  const stepId = generateTypeId("step");
  const now = new Date().toISOString();

  await ctx.executionRepository.createExecution({
    id: executionId,
    task_id: taskId,
    status: ExecutionStatus.RUNNING,
    started_at: now,
  });

  await ctx.executionRepository.createStepExecution({
    id: stepId,
    execution_id: executionId,
    step_type: stepType ?? null,
    status: StepExecutionStatus.RUNNING,
    started_at: now,
  });

  return { executionId, stepId };
};

export const createWorktree = async (ctx: ExecutorContext): Promise<WorktreeInfo> => {
  const gitManager = new GitManager({ repoPath: ctx.repoPath });
  await gitManager.init();
  const baseBranch = await gitManager.getDefaultBranch();
  try {
    const res = await gitManager.createWorktree(ctx.task.id, baseBranch);
    return res;
  } catch (error) {
    if (error instanceof WorktreeExistsError) {
      logger.warn("Worktree already exists, skipping creation", { taskId: ctx.task.id });
      return {
        path: join(ctx.repoPath, ".worktrees", ctx.task.id),
        branch: ctx.task.id,
        baseBranch,
        baseCommit: "",
      };
    }
    throw error;
  }
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
  });
  return resolveTemplate(stepCommand.promptTemplate, templateContext);
};

export interface RunAgentOptions {
  ctx: CommandContext;
  executorCtx: ExecutorContext;
  prompt: string;
  stepId: string;
  /** Signal keywords to detect in agent output */
  signals?: string[];
  /** For testing: inject a custom provider */
  provider?: ClaudeCodeProvider;
}

export const runAgentWithTimeout = async (opts: RunAgentOptions): Promise<ExecuteResult> => {
  const {
    ctx,
    executorCtx,
    prompt,
    stepId,
    signals = [],
    provider = new ClaudeCodeProvider(),
  } = opts;
  const logFile = join(executorCtx.logsDir, `${executorCtx.task.id}.jsonl`);
  const timeoutMs = executorCtx.timeoutSecs * 1000;

  const collectedText: string[] = [];
  const outputHandler = createFileOutputHandler({
    logFile,
    onOutput: (data) => {
      const text = extractAssistantText(data);
      if (text) collectedText.push(text);
    },
  });

  const result = await provider.run({
    prompt,
    cwd: executorCtx.worktreePath,
    onOutput: outputHandler,
    inactivityTimeoutMs: timeoutMs,
  });

  if (result.sessionId) {
    await ctx.executionRepository.updateStepExecution(stepId, { session_id: result.sessionId });
  }

  const status = result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "failure";
  const fullOutput = collectedText.join("\n");
  const { signal } = detectSignal(fullOutput, signals);

  return { exitCode: result.exitCode, sessionId: result.sessionId, status, signal };
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
  ctx: CommandContext,
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
  ctx: CommandContext,
  taskId: string,
  executionId: string,
  stepId: string,
  result: ExecuteResult,
  serverSync?: ServerSync,
  serverStepInfo?: ServerStepInfo,
): Promise<NextStepInfo | null> => {
  await updateLocalExecutionRecords(ctx, executionId, stepId, result);

  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    logger.error("Task not found during finalization", { taskId });
    return null;
  }

  const serverResult = await tryServerCompletion(ctx, taskId, result, serverSync, serverStepInfo);
  if (serverResult.handled) {
    return serverResult.nextStep ?? null;
  }

  const taskStatus: TaskStatus = result.status === "success" ? "DONE" : "BLOCKED";
  await ctx.taskRepository.update(taskId, { status: taskStatus });

  if (serverSync) {
    await syncTaskStatus(serverSync, taskId, task.repo_id, taskStatus);
  }

  return null;
};

const updateLocalExecutionRecords = async (
  ctx: CommandContext,
  executionId: string,
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
            ? { code: "agent_crash" as const, message: `Agent exited with code ${result.exitCode}` }
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
