import { existsSync } from "node:fs";
import type { ExecutionInfo, StepCommand, TaskStatus } from "@aop/common/protocol";
import { aopPaths, getLogger, runWithSpan } from "@aop/infra";
import type { OrchestratorStatus } from "../app.ts";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { abortTask } from "../executor/abort.ts";
import { executeTask } from "../executor/executor.ts";
import { recoverStaleTasks } from "../executor/recovery.ts";
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
      ctx.serverSync = serverSync;
      return;
    }

    serverSync = createServerSync({ serverUrl, apiKey });
    ctx.serverSync = serverSync;
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

    const repos = await ctx.repoRepository.getAll();
    const repoIds = new Set(repos.map((r) => r.id));
    const tasks = await ctx.taskRepository.list({ excludeRemoved: true });
    const activeTasks = tasks.filter((t) => repoIds.has(t.repo_id));
    if (activeTasks.length === 0) return;

    for (const task of activeTasks) {
      await serverSync.syncTask(task.id, task.repo_id, task.status as TaskStatus);
    }

    logger.info("Synced {count} active tasks to server on startup", { count: activeTasks.length });
  };

  const startWatcher = async (): Promise<void> => {
    const repos = await ctx.repoRepository.getAll();

    watcher = createWatcherManager(async (event) => {
      await runWithSpan("watcher-event", async () => {
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

  const abortExecutingTasks = async (): Promise<void> => {
    if (executingTasks.size === 0) return;

    const taskIds = Array.from(executingTasks.keys());
    logger.info("Aborting {count} executing tasks on shutdown", { count: taskIds.length });

    await Promise.allSettled(
      taskIds.map((taskId) =>
        abortTask(ctx, taskId, { targetStatus: "BLOCKED", serverSync: serverSync ?? undefined }),
      ),
    );

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

  const handleStaleTaskRecovery = async (): Promise<void> => {
    const result = await recoverStaleTasks(ctx, { logsDir: aopPaths.logs() });

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

      await abortExecutingTasks();
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
