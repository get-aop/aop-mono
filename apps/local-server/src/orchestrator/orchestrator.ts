import { existsSync } from "node:fs";
import type { ExecutionInfo, StepCommand, TaskStatus } from "@aop/common/protocol";
import { aopPaths, getLogger, runWithSpan } from "@aop/infra";
import { createProvider, type LLMProvider } from "@aop/llm-provider";
import type { OrchestratorStatus } from "../app.ts";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { executeTask, reattachToRunningAgent } from "../executor/executor.ts";
import { recoverStaleTasks } from "../executor/recovery.ts";
import { SettingKey } from "../settings/types.ts";
import { finalizeLaunchFailure } from "./launch-failure.ts";
import { createQueueProcessor, type QueueProcessor } from "./queue/processor.ts";
import {
  createTicker,
  createWatcherManager,
  reconcileAllRepos,
  reconcileRepo,
  type Ticker,
  type WatcherManager,
} from "./watcher/index.ts";

const logger = getLogger("orchestrator");

export interface Orchestrator {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isReady: () => boolean;
  getStatus: () => OrchestratorStatus;
  triggerRefresh: () => boolean;
}

interface ExecutingTask {
  task: Task;
  promise: Promise<void>;
}

export const createOrchestrator = (ctx: LocalServerContext): Orchestrator => {
  let watcher: WatcherManager | null = null;
  let ticker: Ticker | null = null;
  let queueProcessor: QueueProcessor | null = null;
  let ready = false;
  const executingTasks = new Map<string, ExecutingTask>();
  let pendingRefresh: Promise<void> | null = null;

  const getStatus = (): OrchestratorStatus => ({
    watcher: watcher ? "running" : "stopped",
    ticker: ticker?.isRunning() ? "running" : "stopped",
    processor: queueProcessor?.isRunning() ? "running" : "stopped",
  });

  const startWatcher = async (): Promise<void> => {
    const repos = await ctx.repoRepository.getAll();

    watcher = createWatcherManager(async (event) => {
      await runWithSpan("watcher-event", async () => {
        logger.debug("Watcher event: {type} {taskName}", {
          type: event.type,
          taskName: event.taskName,
          repoId: event.repoId,
        });
        const repo = await ctx.repoRepository.getById(event.repoId);
        if (repo) {
          await reconcileRepo(repo, {
            repoRepository: ctx.repoRepository,
            taskRepository: ctx.taskRepository,
            linearStore: ctx.linearStore,
          });
        }
      });
    });

    for (const repo of repos) {
      watcher.addRepo(repo.id, repo.path);
    }

    logger.info("Watcher started for {count} repos", { count: repos.length });
  };

  const startTicker = async (): Promise<void> => {
    const intervalSecs = Number.parseInt(
      await ctx.settingsRepository.get(SettingKey.WATCHER_POLL_INTERVAL_SECS),
      10,
    );

    ticker = createTicker(
      async () => {
        triggerRefreshInternal();
      },
      { intervalMs: intervalSecs * 1000 },
    );

    ticker.start();
  };

  const startQueueProcessor = async (): Promise<void> => {
    queueProcessor = createQueueProcessor({
      taskRepository: ctx.taskRepository,
      repoRepository: ctx.repoRepository,
      settingsRepository: ctx.settingsRepository,
      executionRepository: ctx.executionRepository,
      workflowService: ctx.workflowService,
      executeTask: (task, stepCommand, execution, revertStatus) =>
        executeTaskAsync(task, stepCommand, execution, revertStatus),
    });

    await queueProcessor.start();
  };

  const resolveProviderForTask = async (task: Task): Promise<LLMProvider> => {
    const providerKey = await ctx.settingsRepository.get(SettingKey.AGENT_PROVIDER);

    try {
      return createProvider(providerKey);
    } catch (err) {
      logger.warn(
        "Invalid provider '{provider}' for task {taskId}, falling back to codex: {error}",
        {
          taskId: task.id,
          provider: providerKey,
          error: String(err),
        },
      );
      return createProvider("codex");
    }
  };

  const executeTaskAsync = (
    task: Task,
    stepCommand: StepCommand,
    execution: ExecutionInfo,
    revertStatus: TaskStatus = "READY",
  ): void => {
    const promise: Promise<void> = resolveProviderForTask(task)
      .then((provider) => executeTask(ctx, task, stepCommand, execution, provider))
      .then(() => {})
      .catch(async (err) => {
        logger.error("Task execution failed: {error}", {
          taskId: task.id,
          error: String(err),
        });

        try {
          // Close the just-created step/execution before reverting the task so
          // failed launches do not stay visible as fake "running" history.
          await finalizeLaunchFailure({
            executionRepository: ctx.executionRepository,
            taskRepository: ctx.taskRepository,
            taskId: task.id,
            stepExecutionId: stepCommand.id,
            executionId: execution.id,
            revertStatus,
            error: err,
          });
        } catch (updateErr) {
          logger.error("Failed to finalize execution failure: {error}", {
            taskId: task.id,
            error: String(updateErr),
          });
        }
      })
      .finally(() => {
        executingTasks.delete(task.id);
      });

    executingTasks.set(task.id, { task, promise });
  };

  const triggerRefreshInternal = (): void => {
    if (!ready) return;

    pendingRefresh = refreshWatchedRepos()
      .catch((err) => {
        logger.error("Refresh failed: {error}", { error: String(err) });
      })
      .finally(() => {
        pendingRefresh = null;
      });
  };

  const refreshWatchedRepos = async (): Promise<void> => {
    if (!watcher) return;

    await runWithSpan("refresh", async () => {
      const startTime = performance.now();
      const repos = await ctx.repoRepository.getAll();

      let removedCount = 0;
      for (const repo of repos) {
        if (!existsSync(repo.path)) {
          logger.info("Repo path no longer exists, removing: {repoPath}", {
            repoId: repo.id,
            repoPath: repo.path,
          });
          watcher?.removeRepo(repo.id);
          await ctx.repoRepository.remove(repo.id);
          removedCount++;
          continue;
        }
        watcher?.addRepo(repo.id, repo.path);
      }

      await reconcileAllRepos({
        repoRepository: ctx.repoRepository,
        taskRepository: ctx.taskRepository,
        linearStore: ctx.linearStore,
      });

      const durationMs = Math.round(performance.now() - startTime);
      logger.info(
        "Refresh complete in {durationMs}ms, watching {count} repos, removed {removedCount}",
        {
          durationMs,
          count: repos.length - removedCount,
          removedCount,
        },
      );
    });
  };

  const waitForPendingRefresh = async (): Promise<void> => {
    if (pendingRefresh) {
      try {
        await pendingRefresh;
      } catch {
        // Ignore errors from pending refresh during shutdown
      }
    }
  };

  const handleStaleTaskRecovery = async (): Promise<void> => {
    const result = await recoverStaleTasks(ctx, {
      logsDir: aopPaths.logs(),
      reattachToRunningAgent: (step) => {
        const promise = ctx.taskRepository
          .get(step.task_id)
          .then(async (task) => {
            if (!task) return;
            const provider = await resolveProviderForTask(task);
            await reattachToRunningAgent(ctx, step, provider);
          })
          .catch(async (err) => {
            logger.error("Reattached agent failed: {error}", {
              taskId: step.task_id,
              error: String(err),
            });
            try {
              await ctx.taskRepository.update(step.task_id, { status: "BLOCKED" });
            } catch (updateErr) {
              logger.error("Failed to set task BLOCKED after reattach failure: {error}", {
                taskId: step.task_id,
                error: String(updateErr),
              });
            }
          })
          .finally(() => {
            executingTasks.delete(step.task_id);
          });

        executingTasks.set(step.task_id, {
          task: { id: step.task_id } as Task,
          promise,
        });
      },
      executeTask: (task, stepCommand, execution) => {
        executeTaskAsync(task, stepCommand, execution, "BLOCKED");
      },
    });

    if (result.recovered > 0 || result.reset > 0 || result.reattached > 0) {
      logger.info(
        "Startup recovery: {recovered} recovered from logs, {reattached} reattached to alive agents, {reset} reset to READY",
        { ...result },
      );
    }
  };

  return {
    start: async () => {
      const startTime = performance.now();
      logger.info("Starting orchestrator");

      await handleStaleTaskRecovery();
      await startWatcher();
      await startTicker();
      await startQueueProcessor();

      ready = true;
      const durationMs = Math.round(performance.now() - startTime);
      logger.info("Orchestrator started in {durationMs}ms", { durationMs });
    },

    stop: async () => {
      logger.info("Stopping orchestrator");
      ready = false;

      queueProcessor?.stop();
      ticker?.stop();
      watcher?.stop();

      await waitForPendingRefresh();

      logger.info("Orchestrator stopped");
    },

    isReady: () => ready,

    getStatus,

    triggerRefresh: () => {
      if (!ready) return false;
      triggerRefreshInternal();
      return true;
    },
  };
};
