import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionInfo, StepCommand } from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { forEachJsonlEntry } from "../events/log-file-tailer.ts";
import type { ServerSync, StepCompletePayload } from "../orchestrator/sync/server-sync.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import { cleanupLogFile, persistExecutionLogs, populateLogBuffer } from "./executor.ts";
import {
  isClaudeProcess as defaultIsClaudeProcess,
  isProcessAlive as defaultIsProcessAlive,
} from "./process-utils.ts";
import type { StepWithTask } from "./types.ts";

const logger = getLogger("aop", "executor", "recovery");

export type { StepWithTask };

export interface RecoveryResult {
  recovered: number;
  reset: number;
  reattached: number;
}

export interface RecoveryDeps {
  logsDir: string;
  isProcessAlive?: (pid: number) => boolean;
  isClaudeProcess?: (pid: number) => boolean;
  reattachToRunningAgent?: (step: StepWithTask) => void;
  serverSync?: ServerSync;
  executeTask?: (task: Task, step: StepCommand, execution: ExecutionInfo) => void;
}

export const recoverStaleTasks = async (
  ctx: LocalServerContext,
  deps: RecoveryDeps,
): Promise<RecoveryResult> => {
  const {
    logsDir,
    isProcessAlive = defaultIsProcessAlive,
    isClaudeProcess = defaultIsClaudeProcess,
  } = deps;

  const runningSteps = await ctx.executionRepository.getRunningStepExecutions();
  if (runningSteps.length === 0) {
    return { recovered: 0, reset: 0, reattached: 0 };
  }

  const result: RecoveryResult = { recovered: 0, reset: 0, reattached: 0 };

  for (const step of runningSteps) {
    const action = classifyStep(step, logsDir, isProcessAlive, isClaudeProcess);
    await applyRecoveryAction(ctx, step, action, deps);
    result[action.type]++;
  }

  return result;
};

type RecoveryAction =
  | { type: "reattached" }
  | { type: "recovered"; logFile: string }
  | { type: "reset" };

const classifyStep = (
  step: StepWithTask,
  logsDir: string,
  isProcessAlive: (pid: number) => boolean,
  isClaudeProcess: (pid: number) => boolean,
): RecoveryAction => {
  const pid = step.agent_pid;

  if (pid && isProcessAlive(pid) && isClaudeProcess(pid)) {
    return { type: "reattached" };
  }

  const logFile = join(logsDir, `${step.id}.jsonl`);
  if (pid && existsSync(logFile)) {
    return { type: "recovered", logFile };
  }

  return { type: "reset" };
};

const applyRecoveryAction = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  action: RecoveryAction,
  deps: RecoveryDeps,
): Promise<void> => {
  const log = logger.with({ stepId: step.id, taskId: step.task_id, pid: step.agent_pid });

  if (action.type === "reattached") {
    log.info("Agent still alive, reattaching to executor pipeline");
    deps.reattachToRunningAgent?.(step);
    return;
  }

  if (action.type === "recovered") {
    log.info("Recovering dead agent from log file");
    await recoverFromLogFile(ctx, step, action.logFile, deps);
    return;
  }

  log.info("Dead agent with no recoverable log, resetting task to READY");
  await resetStaleStep(ctx, step);
};

const TERMINAL_STATUSES = new Set(["BLOCKED", "REMOVED", "DONE"]);

const MAX_RETRY_DELAY_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const completeStepOnServerWithRetry = async (
  serverSync: ServerSync,
  stepId: string,
  payload: StepCompletePayload,
): Promise<Awaited<ReturnType<ServerSync["completeStep"]>>> => {
  let delay = 1000;
  for (;;) {
    try {
      return await serverSync.completeStep(stepId, payload);
    } catch (err) {
      logger.warn("Server unavailable during recovery, retrying in {delay}ms: {error}", {
        stepId,
        delay,
        error: String(err),
      });
      await sleep(delay);
      delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    }
  }
};

const recoverFromLogFile = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  logFile: string,
  deps: RecoveryDeps,
): Promise<"success" | "failure"> => {
  const outcome = determineOutcomeFromLog(logFile);
  const now = new Date().toISOString();

  const stepStatus =
    outcome === "success" ? StepExecutionStatus.SUCCESS : StepExecutionStatus.FAILURE;
  const execStatus = outcome === "success" ? ExecutionStatus.COMPLETED : ExecutionStatus.FAILED;

  await ctx.executionRepository.updateStepExecution(step.id, {
    status: stepStatus,
    ended_at: now,
  });
  await ctx.executionRepository.updateExecution(step.execution_id, {
    status: execStatus,
    completed_at: now,
  });

  populateLogBuffer(ctx, logFile, step.execution_id);
  ctx.logBuffer.markComplete(step.execution_id, outcome === "success" ? "completed" : "failed");
  await persistExecutionLogs(ctx, step.execution_id);
  cleanupLogFile(logFile);

  const task = await ctx.taskRepository.get(step.task_id);
  if (task && TERMINAL_STATUSES.has(task.status)) {
    logger.info("Preserving task status {status} during log recovery", {
      taskId: step.task_id,
      status: task.status,
    });
    return outcome;
  }

  if (step.remote_execution_id) {
    await handleServerCompletion(ctx, step, task, outcome, deps);
  } else if (outcome === "failure") {
    await ctx.taskRepository.update(step.task_id, { status: "BLOCKED" });
  }
  // success without remote_execution_id: task stays WORKING (unchanged)

  return outcome;
};

const handleServerCompletion = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  task: Task | null,
  outcome: "success" | "failure",
  deps: RecoveryDeps,
): Promise<void> => {
  const { serverSync, executeTask } = deps;

  if (!serverSync) {
    logger.warn("No serverSync available for recovery, setting task BLOCKED", {
      taskId: step.task_id,
    });
    await ctx.taskRepository.update(step.task_id, { status: "BLOCKED" });
    return;
  }

  const remoteExecutionId = step.remote_execution_id;
  if (!remoteExecutionId) return;

  const payload: StepCompletePayload = {
    executionId: remoteExecutionId,
    attempt: step.attempt ?? 1,
    status: outcome === "success" ? "success" : "failure",
    durationMs: 0,
  };

  const response = await completeStepOnServerWithRetry(serverSync, step.id, payload);

  if (response.step && response.execution && response.taskStatus === "WORKING") {
    logger.info("Recovery: launching next step {stepType}", {
      taskId: step.task_id,
      stepType: response.step.type,
    });
    if (task && executeTask) {
      executeTask(task, response.step, response.execution);
    }
    return;
  }

  logger.info("Recovery: server returned terminal status {status}", {
    taskId: step.task_id,
    status: response.taskStatus,
  });
  await ctx.taskRepository.update(step.task_id, { status: response.taskStatus });
};

const resetStaleStep = async (ctx: LocalServerContext, step: StepWithTask): Promise<void> => {
  const now = new Date().toISOString();
  await ctx.executionRepository.updateStepExecution(step.id, {
    status: StepExecutionStatus.CANCELLED,
    ended_at: now,
  });
  await ctx.executionRepository.updateExecution(step.execution_id, {
    status: ExecutionStatus.CANCELLED,
    completed_at: now,
  });

  const task = await ctx.taskRepository.get(step.task_id);
  if (task && TERMINAL_STATUSES.has(task.status)) {
    logger.info("Preserving task status {status} during recovery (not resetting to READY)", {
      taskId: step.task_id,
      status: task.status,
    });
    return;
  }

  await ctx.taskRepository.update(step.task_id, { status: "READY" });
};

const determineOutcomeFromLog = (logFile: string): "success" | "failure" => {
  const content = readFileSync(logFile, "utf-8");
  let lastResult: "success" | "failure" | null = null;

  forEachJsonlEntry(content, (data) => {
    if (data.type === "result") {
      lastResult = data.subtype === "success" ? "success" : "failure";
    }
  });

  return lastResult ?? "failure";
};
