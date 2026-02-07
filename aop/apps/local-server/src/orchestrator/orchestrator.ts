import { existsSync } from "node:fs";
import type { ExecutionInfo, StepCommand, TaskStatus } from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import type { OrchestratorStatus } from "../app.ts";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { executeTask } from "../executor/executor.ts";
import { SettingKey } from "../settings/types.ts";
import { createQueueProcessor, type QueueProcessor } from "./queue/processor.ts";
import { createDegradedServerSync, createServerSync, type ServerSync } from "./sync/server-sync.ts";
import {
  createTicker,
  createWatcherManager,
  reconcileAllRepos,
  reconcileRepo,
  type Ticker,
  type WatcherManager,
} from "./watcher/index.ts";

const logger = getLogger("aop", "orchestrator");

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
  let serverSync: ServerSync | null = null;
  let ready = false;
  const executingTasks = new Map<string, ExecutingTask>();
  let pendingRefresh: Promise<void> | null = null;

  const getStatus = (): OrchestratorStatus => ({
    watcher: watcher ? "running" : "stopped",
    ticker: ticker?.isRunning() ? "running" : "stopped",
    processor: queueProcessor?.isRunning() ? "running" : "stopped",
  });

  const initializeServerSync = async (): Promise<void> => {
    const serverUrl = await ctx.settingsRepository.get(SettingKey.SERVER_URL);
    const apiKey = await ctx.settingsRepository.get(SettingKey.API_KEY);

    if (!serverUrl || !apiKey) {
      logger.info("No server URL or API key configured, running in degraded mode");
      serverSync = createDegradedServerSync();
      return;
    }

    serverSync = createServerSync({ serverUrl, apiKey });
    await authenticateAndRetryQueued();
    await syncActiveTasksToServer();
  };

  const authenticateAndRetryQueued = async (): Promise<void> => {
    if (!serverSync) return;

    try {
      const maxConcurrent = Number.parseInt(
        await ctx.settingsRepository.get(SettingKey.MAX_CONCURRENT_TASKS),
        10,
      );

      const result = await serverSync.authenticate({
        requestedMaxConcurrentTasks: maxConcurrent,
      });

      logger.info("Authenticated with server, clientId: {clientId}, maxConcurrent: {max}", {
        clientId: result.clientId,
        max: result.effectiveMaxConcurrentTasks,
      });

      await serverSync.flushOfflineQueue();
      await serverSync.retryQueuedReadyTasks();
    } catch (err) {
      logger.warn("Server authentication failed, running in degraded mode: {error}", {
        error: String(err),
      });
    }
  };

  const syncActiveTasksToServer = async (): Promise<void> => {
    if (!serverSync || serverSync.isDegraded()) return;

    const tasks = await ctx.taskRepository.list({ excludeRemoved: true });
    if (tasks.length === 0) return;

    for (const task of tasks) {
      await serverSync.syncTask(task.id, task.repo_id, task.status as TaskStatus);
    }

    logger.info("Synced {count} active tasks to server on startup", { count: tasks.length });
  };

  const startWatcher = async (): Promise<void> => {
    const repos = await ctx.repoRepository.getAll();

    watcher = createWatcherManager(async (event) => {
      logger.debug("Watcher event: {type} {changeName}", {
        type: event.type,
        changeName: event.changeName,
        repoId: event.repoId,
      });
      const repo = await ctx.repoRepository.getById(event.repoId);
      if (repo) {
        await reconcileRepo(repo, {
          repoRepository: ctx.repoRepository,
          taskRepository: ctx.taskRepository,
        });
      }
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
      serverSync: serverSync ?? undefined,
      executeTask: (task, stepCommand, execution) => executeTaskAsync(task, stepCommand, execution),
    });

    await queueProcessor.start();
  };

  const executeTaskAsync = (
    task: Task,
    stepCommand: StepCommand,
    execution: ExecutionInfo,
  ): void => {
    const promise: Promise<void> = executeTask(
      ctx,
      task,
      stepCommand,
      execution,
      serverSync ?? undefined,
    )
      .then(() => {})
      .catch((err) => {
        logger.error("Task execution failed: {error}", {
          taskId: task.id,
          error: String(err),
        });
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

    const startTime = performance.now();
    const repos = await ctx.repoRepository.getAll();

    let removedCount = 0;
    for (const repo of repos) {
      if (!existsSync(repo.path)) {
        logger.info("Repo path no longer exists, removing: {repoPath}", {
          repoId: repo.id,
          repoPath: repo.path,
        });
        watcher.removeRepo(repo.id);
        await ctx.repoRepository.remove(repo.id);
        removedCount++;
        continue;
      }
      watcher.addRepo(repo.id, repo.path);
    }

    await reconcileAllRepos({
      repoRepository: ctx.repoRepository,
      taskRepository: ctx.taskRepository,
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
  };

  const waitForExecutingTasks = async (): Promise<void> => {
    if (executingTasks.size === 0) return;

    logger.info("Waiting for {count} executing tasks to complete", {
      count: executingTasks.size,
    });

    const promises = Array.from(executingTasks.values()).map((t) => t.promise);
    await Promise.allSettled(promises);
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

  const flushServerSyncQueue = async (): Promise<void> => {
    if (!serverSync) return;

    const queueSize = serverSync.getOfflineQueueSize();
    if (queueSize > 0) {
      logger.info("Flushing {count} queued server requests before shutdown", {
        count: queueSize,
      });
      try {
        await serverSync.flushOfflineQueue();
      } catch (err) {
        logger.warn("Failed to flush offline queue: {error}", {
          error: String(err),
        });
      }
    }
  };

  const resetStaleTasks = async (): Promise<void> => {
    // Cancel stale step executions first (inner-most), then executions, then tasks
    const cancelledSteps = await ctx.executionRepository.cancelRunningStepExecutions();
    const cancelledExecutions = await ctx.executionRepository.cancelRunningExecutions();
    const resetTasks = await ctx.taskRepository.resetStaleWorkingTasks();

    if (resetTasks > 0 || cancelledExecutions > 0 || cancelledSteps > 0) {
      logger.info(
        "Reset {taskCount} stale tasks, cancelled {execCount} executions and {stepCount} steps",
        {
          taskCount: resetTasks,
          execCount: cancelledExecutions,
          stepCount: cancelledSteps,
        },
      );
    }
  };

  return {
    start: async () => {
      const startTime = performance.now();
      logger.info("Starting orchestrator");

      await resetStaleTasks();
      await initializeServerSync();
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

      await waitForExecutingTasks();
      await waitForPendingRefresh();
      await flushServerSyncQueue();

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
