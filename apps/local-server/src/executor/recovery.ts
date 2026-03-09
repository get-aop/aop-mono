import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionInfo, StepCommand } from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import { inferRunOutcomeFromRawJsonl } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { readLogLines } from "../events/log-file-tailer.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import { cleanupLogFile, populateLogBuffer } from "./executor.ts";
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

const recoverFromLogFile = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  logFile: string,
  deps: RecoveryDeps,
): Promise<"success" | "failure"> => {
  const outcome = determineOutcomeFromLog(logFile);

  const flushedCount = await ctx.executionRepository.getStepLogCount(step.id);
  await persistStepLogsFromOffset(ctx, step.id, logFile, flushedCount);

  populateLogBuffer(ctx, logFile, step.id);
  ctx.logBuffer.markComplete(step.id, outcome === "success" ? "completed" : "failed");
  cleanupLogFile(logFile);

  const task = await ctx.taskRepository.get(step.task_id);
  if (task && TERMINAL_STATUSES.has(task.status)) {
    logger.info("Preserving task status {status} during log recovery", {
      taskId: step.task_id,
      status: task.status,
    });
    return outcome;
  }

  if (!task) {
    return outcome;
  }

  const completion = await ctx.workflowService.completeStep(task, {
    executionId: step.execution_id,
    stepId: step.id,
    status: outcome === "success" ? "success" : "failure",
  });

  if (completion.step && completion.execution && completion.taskStatus === "WORKING") {
    logger.info("Recovery: launching next step {stepType}", {
      taskId: step.task_id,
      stepType: completion.step.type,
    });
    if (deps.executeTask) {
      deps.executeTask(task, completion.step, completion.execution);
    }
  }

  return outcome;
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

const persistStepLogsFromOffset = async (
  ctx: LocalServerContext,
  stepExecutionId: string,
  logFile: string,
  offset: number,
): Promise<void> => {
  const { lines } = readLogLines(logFile, offset);
  if (lines.length === 0) return;

  const now = new Date().toISOString();
  const logs = lines.map((content) => ({
    step_execution_id: stepExecutionId,
    content,
    created_at: now,
  }));

  try {
    await ctx.executionRepository.saveStepLogs(logs);
    logger.debug("Persisted {count} log lines from offset {offset} for step {stepId}", {
      count: logs.length,
      offset,
      stepId: stepExecutionId,
    });
  } catch (err) {
    logger.warn("Failed to persist step logs from offset: {error}", {
      stepExecutionId,
      offset,
      error: String(err),
    });
  }
};

const determineOutcomeFromLog = (logFile: string): "success" | "failure" => {
  const content = readFileSync(logFile, "utf-8");
  const inferred = inferRunOutcomeFromRawJsonl(content, { requireCompleteLine: true });
  return inferred.outcome === "success" ? "success" : "failure";
};
