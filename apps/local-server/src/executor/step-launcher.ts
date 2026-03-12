import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionInfo, SignalDefinition, StepCommand } from "@aop/common/protocol";
import type { WorktreeInfo } from "@aop/git-manager";
import { getLogger } from "@aop/infra";
import {
  ClaudeCodeProvider,
  CodexProvider,
  createProvider,
  inferRunOutcomeFromRawJsonl,
  type LLMProvider,
} from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { SettingKey } from "../settings/types.ts";
import { isAgentRunning } from "./process-utils.ts";
import type { ExecutorContext, StepWithTask } from "./types.ts";

const logger = getLogger("executor");

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
  provider?: LLMProvider;
}

export type HandleAgentCompletionFn = (
  opts: SpawnAgentOptions,
  logFile: string,
  runResult: { exitCode: number; sessionId?: string; timedOut?: boolean },
  signals: SignalDefinition[],
) => Promise<void>;

export const REAPER_POLL_INTERVAL_MS = 2000;
const PROVIDER_RUN_GRACE_MS = 1500;

/** Reads JSONL log file and infers process outcome from shared log semantics. */
export const readRunResultFromLog = (logFile: string): { exitCode: number; timedOut?: boolean } => {
  if (!existsSync(logFile)) {
    return { exitCode: 1 };
  }

  const content = readFileSync(logFile, "utf-8");
  const inferred = inferRunOutcomeFromRawJsonl(content, { requireCompleteLine: true });
  return { exitCode: inferred.outcome === "success" ? 0 : 1 };
};

export const getProvider = async (ctx: LocalServerContext): Promise<LLMProvider> => {
  const providerKey = await ctx.settingsRepository.get(SettingKey.AGENT_PROVIDER);
  if (providerKey) {
    return createProvider(providerKey);
  }

  return new CodexProvider();
};

interface ResolvedStepProvider {
  provider: LLMProvider;
  model?: string;
  reasoningEffort?: string;
}

const mapReasoningEffort = (
  provider: "openai" | "anthropic",
  reasoning: "low" | "medium" | "high" | "extra-high",
): string => {
  if (reasoning !== "extra-high") {
    return reasoning;
  }

  return provider === "anthropic" ? "max" : "xhigh";
};

const resolveProviderForStep = async (
  ctx: LocalServerContext,
  stepCommand: StepCommand,
  fallbackProvider?: LLMProvider,
): Promise<ResolvedStepProvider> => {
  const stepAgent = stepCommand.agent;
  if (!stepAgent) {
    return {
      provider: fallbackProvider ?? (await getProvider(ctx)),
    };
  }

  if (stepAgent.provider === "anthropic") {
    return {
      provider: new ClaudeCodeProvider(),
      model: stepAgent.model,
      reasoningEffort: mapReasoningEffort(stepAgent.provider, stepAgent.reasoning),
    };
  }

  return {
    provider: new CodexProvider(),
    model: stepAgent.model,
    reasoningEffort: mapReasoningEffort(stepAgent.provider, stepAgent.reasoning),
  };
};

export const spawnAgentWithReaper = async (
  opts: SpawnAgentOptions,
  onCompletion: HandleAgentCompletionFn,
): Promise<void> => {
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
  const { provider, model, reasoningEffort } = await resolveProviderForStep(
    ctx,
    opts.stepCommand,
    explicitProvider,
  );

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
    model,
    reasoningEffort,
    stepId,
    inactivityTimeoutMs: timeoutMs,
    fastMode: executorCtx.fastMode,
  });

  return onCompletion(opts, logFile, runResult, signals);
};

/** Polls until the process is no longer running (exited or zombie). */
export const pollForProcessExit = (pid: number): Promise<void> => {
  return new Promise((resolve) => {
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
 * (log persistence -> completeStep on server -> next step chain).
 */
export const reattachToRunningAgent = async (
  ctx: LocalServerContext,
  step: StepWithTask,
  buildContextFn: (ctx: LocalServerContext, task: Task) => Promise<ExecutorContext>,
  createWorktreeFn: (ctx: ExecutorContext) => Promise<WorktreeInfo>,
  onCompletion: HandleAgentCompletionFn,
  provider?: LLMProvider,
): Promise<void> => {
  const task = await ctx.taskRepository.get(step.task_id);
  if (!task) throw new Error(`Task not found: ${step.task_id}`);

  const executorCtx = await buildContextFn(ctx, task);
  const worktreeInfo = await createWorktreeFn(executorCtx);

  const logFile = join(executorCtx.logsDir, `${step.id}.jsonl`);
  ctx.logFlusher.track(step.id, logFile);

  const pid = step.agent_pid;
  if (pid) {
    await pollForProcessExit(pid);
  }
  const runResult = readRunResultFromLog(logFile);
  const signals = step.signals_json ? JSON.parse(step.signals_json) : [];

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
      signals,
      attempt: step.attempt ?? 1,
      iteration: step.iteration ?? 1,
    },
    executionInfo: {
      id: step.execution_id,
      workflowId: "",
    },
    taskId: step.task_id,
    repoId: task.repo_id,
    provider,
  };

  await onCompletion(opts, logFile, runResult, signals);
};

// --- Private helpers ---

interface SpawnAndReapOptions {
  prompt: string;
  cwd?: string;
  logFilePath: string;
  env: Record<string, string>;
  model?: string;
  reasoningEffort?: string;
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
    let reaping = false;
    let pollInterval: Timer | undefined;
    let providerRunPromise: Promise<RunResultLike> | null = null;
    let spawnedPid: number | null = null;

    const settle = (result: RunResultLike) => {
      if (settled) return;
      settled = true;
      if (pollInterval) clearInterval(pollInterval);
      resolve(result);
    };

    const settleFromPollPath = async () => {
      if (settled || reaping) return;
      reaping = true;
      const providerResult = await waitForProviderRun(providerRunPromise, PROVIDER_RUN_GRACE_MS);
      settle(providerResult ?? readRunResultFromLog(logFile));
    };

    providerRunPromise = provider.run({
      prompt: opts.prompt,
      cwd: opts.cwd,
      logFilePath: opts.logFilePath,
      env: opts.env,
      model: opts.model,
      reasoningEffort: opts.reasoningEffort,
      onSpawn: async (pid) => {
        spawnedPid = pid;
        await ctx.executionRepository.updateStepExecution(opts.stepId, {
          agent_pid: pid,
        });
        ctx.logFlusher.track(opts.stepId, logFile);
        logger.info("Agent spawned with PID {pid}", { pid, stepId: opts.stepId });

        // Start PID polling — the primary completion mechanism for detached agents
        if (!isAgentRunning(pid)) {
          void settleFromPollPath();
          return;
        }
        pollInterval = setInterval(() => {
          if (!isAgentRunning(pid)) {
            void settleFromPollPath();
          }
        }, REAPER_POLL_INTERVAL_MS);
      },
      inactivityTimeoutMs: opts.inactivityTimeoutMs,
      fastMode: opts.fastMode,
    });

    providerRunPromise
      .then((runResult) => {
        if (!spawnedPid) {
          settle(runResult);
          return;
        }

        // Detached providers can resolve after writing the result line but before the
        // agent process has actually exited. Wait for PID polling in that case so
        // completion handlers do not remove an in-use worktree.
        if (!isAgentRunning(spawnedPid)) {
          settle(runResult);
        }
      })
      .catch((err) => {
        if (!settled) reject(err);
      });
  });
};

const waitForProviderRun = async (
  providerRunPromise: Promise<RunResultLike> | null,
  timeoutMs: number,
): Promise<RunResultLike | null> => {
  if (!providerRunPromise) return null;

  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([providerRunPromise, timeout]);
  } catch {
    return null;
  }
};
