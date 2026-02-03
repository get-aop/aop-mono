import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { isProcessAlive } from "../daemon/index.ts";
import { ExecutionStatus, StepExecutionStatus } from "../executions/types.ts";
import type { ServerSync } from "../sync/server-sync.ts";

const logger = getLogger("aop", "executor", "abort");

const GRACEFUL_SHUTDOWN_MS = 3000;

export interface AbortResult {
  taskId: string;
  agentKilled: boolean;
}

export const abortTask = async (
  ctx: CommandContext,
  taskId: string,
  serverSync?: ServerSync,
): Promise<AbortResult> => {
  const log = logger.with({ taskId });
  log.info("Aborting task");

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
  await ctx.taskRepository.update(taskId, { status: "REMOVED" });

  if (serverSync) {
    try {
      await serverSync.syncTask(taskId, task.repo_id, "REMOVED");
    } catch (err) {
      log.warn("Failed to sync task removal: {error}", { error: String(err) });
    }
  }

  log.info("Task aborted", { agentKilled: result.agentKilled });
  return result;
};

const killAgent = async (pid: number, log: ReturnType<typeof logger.with>): Promise<boolean> => {
  if (!isProcessAlive(pid)) {
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

const updateExecutionStatus = async (ctx: CommandContext, taskId: string): Promise<void> => {
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

const waitForProcessExit = (pid: number, timeoutMs: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (!isProcessAlive(pid)) {
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
