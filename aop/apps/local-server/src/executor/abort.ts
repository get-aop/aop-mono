import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ServerSync } from "../orchestrator/sync/server-sync.ts";
import { ExecutionStatus, StepExecutionStatus } from "./execution-types.ts";
import * as processUtils from "./process-utils.ts";

const logger = getLogger("executor", "abort");

const GRACEFUL_SHUTDOWN_MS = 3000;

export interface AbortResult {
  taskId: string;
  agentKilled: boolean;
}

export interface AbortTaskOptions {
  targetStatus?: "REMOVED" | "BLOCKED";
  serverSync?: ServerSync;
}

export const abortTask = async (
  ctx: LocalServerContext,
  taskId: string,
  optionsOrServerSync?: AbortTaskOptions | ServerSync,
): Promise<AbortResult> => {
  const options = normalizeOptions(optionsOrServerSync);
  const targetStatus = options.targetStatus ?? "REMOVED";
  const { serverSync } = options;

  const log = logger.with({ taskId });
  log.info("Aborting task", { targetStatus });

  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const result: AbortResult = { taskId, agentKilled: false };

  const stepExecution = await ctx.executionRepository.getLatestStepExecution(taskId);
  if (stepExecution?.agent_pid && stepExecution.status === StepExecutionStatus.RUNNING) {
    result.agentKilled = await killAgent(stepExecution.agent_pid, log);
  }

  await updateExecutionStatus(ctx, taskId);
  await ctx.taskRepository.update(taskId, { status: targetStatus });

  if (serverSync) {
    try {
      await serverSync.syncTask(taskId, task.repo_id, targetStatus);
    } catch (err) {
      log.warn("Failed to sync task status: {error}", { error: String(err) });
    }
  }

  log.info("Task aborted", { agentKilled: result.agentKilled, targetStatus });
  return result;
};

const killAgent = async (pid: number, log: ReturnType<typeof logger.with>): Promise<boolean> => {
  if (!processUtils.isProcessAlive(pid)) {
    log.debug("Agent process not alive, skipping kill");
    return false;
  }

  log.info("Sending SIGTERM to agent", { pid });
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    log.warn("Failed to send SIGTERM to agent", { pid });
    return false;
  }

  const gracefullyTerminated = await waitForProcessExit(pid, GRACEFUL_SHUTDOWN_MS);
  if (gracefullyTerminated) {
    log.debug("Agent terminated gracefully");
    return true;
  }

  log.info("Agent did not terminate gracefully, sending SIGKILL", { pid });
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    log.warn("Failed to send SIGKILL to agent", { pid });
  }

  return true;
};

const updateExecutionStatus = async (ctx: LocalServerContext, taskId: string): Promise<void> => {
  const executions = await ctx.executionRepository.getExecutionsByTaskId(taskId);
  const now = new Date().toISOString();

  for (const execution of executions) {
    if (execution.status === ExecutionStatus.RUNNING) {
      await ctx.executionRepository.updateExecution(execution.id, {
        status: ExecutionStatus.ABORTED,
        completed_at: now,
      });

      const steps = await ctx.executionRepository.getStepExecutionsByExecutionId(execution.id);
      for (const step of steps) {
        if (step.status === StepExecutionStatus.RUNNING) {
          await ctx.executionRepository.updateStepExecution(step.id, {
            status: StepExecutionStatus.FAILURE,
            ended_at: now,
            error: "Aborted",
          });
        }
      }
    }
  }
};

const normalizeOptions = (
  optionsOrServerSync?: AbortTaskOptions | ServerSync,
): AbortTaskOptions => {
  if (!optionsOrServerSync) return {};
  if ("syncTask" in optionsOrServerSync) return { serverSync: optionsOrServerSync };
  return optionsOrServerSync;
};

const waitForProcessExit = (pid: number, timeoutMs: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (!processUtils.isProcessAlive(pid)) {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  });
};
