import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
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
}

export const abortTask = async (
  ctx: LocalServerContext,
  taskId: string,
  options?: AbortTaskOptions,
): Promise<AbortResult> => {
  const targetStatus = options?.targetStatus ?? "REMOVED";

  const log = logger.with({ taskId });
  log.info("Aborting task", { targetStatus });

  const task = await ctx.taskRepository.get(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Set status FIRST to prevent reapers from launching new steps
  await ctx.taskRepository.update(taskId, { status: targetStatus });

  const result: AbortResult = { taskId, agentKilled: false };

  // Kill ALL running agents for this task via execution records
  const killedFromRecords = await killAllRunningAgents(ctx, taskId, log);
  if (killedFromRecords) result.agentKilled = true;

  // Fallback: scan /proc for any agents matching this task ID
  const killedFromProc = await killAgentsByTaskId(taskId, log);
  if (killedFromProc) result.agentKilled = true;

  await updateExecutionStatus(ctx, taskId);

  log.info("Task aborted", { agentKilled: result.agentKilled, targetStatus });
  return result;
};

const killAllRunningAgents = async (
  ctx: LocalServerContext,
  taskId: string,
  log: ReturnType<typeof logger.with>,
): Promise<boolean> => {
  const executions = await ctx.executionRepository.getExecutionsByTaskId(taskId);
  const runningExecs = executions.filter((e) => e.status === ExecutionStatus.RUNNING);

  const results = await Promise.all(
    runningExecs.map((exec) => killRunningStepsForExecution(ctx, exec.id, log)),
  );
  return results.some(Boolean);
};

const killRunningStepsForExecution = async (
  ctx: LocalServerContext,
  executionId: string,
  log: ReturnType<typeof logger.with>,
): Promise<boolean> => {
  const steps = await ctx.executionRepository.getStepExecutionsByExecutionId(executionId);
  let killed = false;

  for (const step of steps) {
    if (step.status !== StepExecutionStatus.RUNNING) continue;

    const pid = step.agent_pid ?? processUtils.findPidByStepId(step.id);
    if (pid && (await killAgent(pid, log))) {
      killed = true;
    }
  }

  return killed;
};

const killAgentsByTaskId = async (
  taskId: string,
  log: ReturnType<typeof logger.with>,
): Promise<boolean> => {
  const pids = processUtils.findPidsByTaskId(taskId);
  if (pids.length === 0) return false;

  log.info("Found {count} agent processes via /proc scan", { count: pids.length });
  let killed = false;
  for (const pid of pids) {
    if (await killAgent(pid, log)) killed = true;
  }
  return killed;
};

const killAgent = async (pid: number, log: ReturnType<typeof logger.with>): Promise<boolean> => {
  if (!processUtils.isProcessAlive(pid)) {
    log.debug("Agent process not alive, skipping kill", { pid });
    return false;
  }

  // Use process group kill to terminate agent and all its children.
  // Agents are spawned with detached:true so their PID equals their PGID.
  log.info("Sending SIGTERM to agent process group", { pid });
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Fall back to single-process kill if group kill fails
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      log.warn("Failed to send SIGTERM to agent", { pid });
      return false;
    }
  }

  const gracefullyTerminated = await waitForProcessExit(pid, GRACEFUL_SHUTDOWN_MS);
  if (gracefullyTerminated) {
    log.debug("Agent terminated gracefully", { pid });
    return true;
  }

  log.info("Agent did not terminate gracefully, sending SIGKILL", { pid });
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      log.warn("Failed to send SIGKILL to agent", { pid });
    }
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
    }

    // Update stale steps regardless of execution status — the completion handler
    // may have finalized the execution before we got here (race condition)
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
