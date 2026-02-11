import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import type {
  ExecutionInfo,
  SignalDefinition,
  StepCommand,
  StepCompleteResponse,
  TaskStatus,
} from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import { extractAssistantText } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import { forEachJsonlEntry, parseJsonlEntry } from "../events/log-file-tailer.ts";
import type { ServerSync, StepCompletePayload } from "../orchestrator/sync/server-sync.ts";
import { detectSignal } from "../orchestrator/sync/signal-detector.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import type { ExecuteResult } from "./types.ts";

const logger = getLogger("executor");
const COMPLETE_STEP_MAX_ATTEMPTS = 3;
const COMPLETE_STEP_RETRY_BASE_DELAY_MS = 500;

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

export interface NextStepInfo {
  step: StepCommand;
  execution: ExecutionInfo;
}

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

// --- Private helpers ---

export const syncTaskStatus = async (
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

export const finalizeExecutionRecord = async (
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
      logger.info("Step completed on server, taskStatus: {taskStatus}", {
        stepId,
        taskStatus: response.taskStatus,
        hasNextStep: !!response.step,
        signal: result.signal,
      });
      return response;
    } catch (err) {
      if (tryIndex >= COMPLETE_STEP_MAX_ATTEMPTS) {
        logger.warn("Failed to complete step on server after retries: {error}", {
          stepId,
          attempts: tryIndex,
          error: String(err),
        });
        return null;
      }

      const retryDelayMs = COMPLETE_STEP_RETRY_BASE_DELAY_MS * 2 ** (tryIndex - 1);
      logger.warn(
        "Failed to complete step on server (attempt {attempt}), retrying in {delay}ms: {error}",
        { stepId, attempt: tryIndex, delay: retryDelayMs, error: String(err) },
      );
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
