import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { StepExecution } from "../db/schema.ts";
import { forEachJsonlEntry } from "../events/log-file-tailer.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import { cleanupLogFile, persistExecutionLogs, populateLogBuffer } from "./executor.ts";
import {
  isClaudeProcess as defaultIsClaudeProcess,
  isProcessAlive as defaultIsProcessAlive,
} from "./process-utils.ts";

const logger = getLogger("aop", "executor", "recovery");

const PID_POLL_INTERVAL_MS = 2000;

export interface RecoveryResult {
  recovered: number;
  reset: number;
  reattached: number;
}

export interface RecoveryDeps {
  logsDir: string;
  isProcessAlive?: (pid: number) => boolean;
  isClaudeProcess?: (pid: number) => boolean;
}

type StepWithTask = StepExecution & { task_id: string };

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
    await applyRecoveryAction(ctx, step, action, { logsDir, isProcessAlive });
    result[action.type]++;
  }

  return result;
};

export const reattachToAgent = (
  ctx: LocalServerContext,
  step: StepWithTask,
  deps: { logsDir: string; isProcessAlive: (pid: number) => boolean },
): NodeJS.Timeout => {
  const pid = step.agent_pid as number;
  const log = logger.with({ stepId: step.id, taskId: step.task_id, pid });

  const intervalId = setInterval(async () => {
    if (deps.isProcessAlive(pid)) return;

    clearInterval(intervalId);
    log.info("Reattached agent PID died, finalizing");
    await finalizeReattachedAgent(ctx, step, deps.logsDir);
  }, PID_POLL_INTERVAL_MS);

  return intervalId;
};

const finalizeReattachedAgent = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  logsDir: string,
): Promise<void> => {
  const logFile = join(logsDir, `${step.id}.jsonl`);

  if (existsSync(logFile)) {
    await recoverFromLogFile(ctx, step, logFile);
    populateLogBuffer(ctx, logFile, step.execution_id);
    ctx.logBuffer.markComplete(
      step.execution_id,
      (await ctx.taskRepository.get(step.task_id))?.status === "DONE" ? "completed" : "failed",
    );
    await persistExecutionLogs(ctx, step.execution_id);
    cleanupLogFile(logFile);
  } else {
    await resetStaleStep(ctx, step);
  }
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
  deps: { logsDir: string; isProcessAlive: (pid: number) => boolean },
): Promise<void> => {
  const log = logger.with({ stepId: step.id, taskId: step.task_id, pid: step.agent_pid });

  if (action.type === "reattached") {
    log.info("Agent still alive, starting PID poller");
    reattachToAgent(ctx, step, deps);
    return;
  }

  if (action.type === "recovered") {
    log.info("Recovering dead agent from log file");
    await recoverFromLogFile(ctx, step, action.logFile);
    return;
  }

  log.info("Dead agent with no recoverable log, resetting task to READY");
  await resetStaleStep(ctx, step);
};

const recoverFromLogFile = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  logFile: string,
): Promise<void> => {
  const outcome = determineOutcomeFromLog(logFile);
  const now = new Date().toISOString();

  const stepStatus =
    outcome === "success" ? StepExecutionStatus.SUCCESS : StepExecutionStatus.FAILURE;
  const execStatus = outcome === "success" ? ExecutionStatus.COMPLETED : ExecutionStatus.FAILED;
  const taskStatus = outcome === "success" ? "DONE" : "BLOCKED";

  await ctx.executionRepository.updateStepExecution(step.id, {
    status: stepStatus,
    ended_at: now,
  });
  await ctx.executionRepository.updateExecution(step.execution_id, {
    status: execStatus,
    completed_at: now,
  });
  await ctx.taskRepository.update(step.task_id, { status: taskStatus });
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
