import { existsSync } from "node:fs";
import { cleanupLoggers, getLogger } from "@aop/infra";
import type { Kysely } from "kysely";
import { type CommandContext, createCommandContext } from "../context.ts";
import { closeDatabase, createDatabase, getDefaultDbPath } from "../db/connection.ts";
import { runMigrations } from "../db/migrations.ts";
import type { Database, Task } from "../db/schema.ts";
import { executeTask } from "../executor/executor.ts";
import { createQueueProcessor, type QueueProcessor } from "../queue/processor.ts";
import { SettingKey } from "../settings/types.ts";
import {
  createDegradedServerSync,
  createServerSync,
  type ServerSync,
} from "../sync/server-sync.ts";
import { reconcileAllRepos, reconcileRepo } from "../watcher/reconcile.ts";
import { createTicker, type Ticker } from "../watcher/ticker.ts";
import { createWatcherManager, type WatcherManager } from "../watcher/watcher.ts";
import { DEFAULT_PID_FILE, isProcessAlive, removePidFile, writePidFile } from "./pid-utils.ts";
import type { DaemonConfig, ExecutingTask } from "./types.ts";

const logger = getLogger("aop", "daemon");

export interface Daemon {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
  getServerSync: () => ServerSync | null;
}

class DaemonInstance {
  private db: Kysely<Database>;
  private ctx: CommandContext;
  private running = false;
  private watcher: WatcherManager | null = null;
  private ticker: Ticker | null = null;
  private queueProcessor: QueueProcessor | null = null;
  private executingTasks = new Map<string, ExecutingTask>();
  private pidFile: string;
  private shutdownPromise: Promise<void> | null = null;
  private pendingRefresh: Promise<void> | null = null;
  private serverSync: ServerSync | null = null;
  private serverSyncInjected = false;

  constructor(db: Kysely<Database>, config: DaemonConfig) {
    this.db = db;
    this.pidFile = config.pidFile ?? DEFAULT_PID_FILE;
    this.ctx = createCommandContext(db);
    if (config.serverSync) {
      this.serverSync = config.serverSync;
      this.serverSyncInjected = true;
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn("Daemon already running");
      return;
    }

    const startTime = performance.now();
    logger.info("Starting daemon");
    this.running = true;

    this.writePid();
    this.setupSignalHandlers();

    await runMigrations(this.db);

    const ctx = this.ctx;

    await this.initializeServerSync(ctx);
    await this.resumeWorkingTasks(ctx);
    await this.startWatcher(ctx);
    await this.startTicker(ctx);
    await this.startQueueProcessor(ctx);

    const durationMs = Math.round(performance.now() - startTime);
    logger.info("Daemon started successfully in {durationMs}ms", { durationMs });
  }

  async stop(): Promise<void> {
    if (!this.running) {
      logger.warn("Daemon not running");
      return;
    }

    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async performShutdown(): Promise<void> {
    logger.info("Stopping daemon");
    this.running = false;

    this.queueProcessor?.stop();
    this.ticker?.stop();
    this.watcher?.stop();

    await this.waitForExecutingTasks();
    await this.waitForPendingRefresh();
    await this.flushServerSyncQueue();
    await closeDatabase();

    this.removePid();
    logger.info("Daemon stopped");
    cleanupLoggers();
  }

  private async flushServerSyncQueue(): Promise<void> {
    if (!this.serverSync) return;

    const queueSize = this.serverSync.getOfflineQueueSize();
    if (queueSize > 0) {
      logger.info("Flushing {count} queued server requests before shutdown", { count: queueSize });
      try {
        await this.serverSync.flushOfflineQueue();
      } catch (err) {
        logger.warn("Failed to flush offline queue: {error}", { error: String(err) });
      }
    }
  }

  private async waitForPendingRefresh(): Promise<void> {
    if (this.pendingRefresh) {
      try {
        await this.pendingRefresh;
      } catch {
        // Ignore errors from pending refresh during shutdown
      }
    }
  }

  private async initializeServerSync(ctx: CommandContext): Promise<void> {
    if (this.serverSyncInjected) {
      logger.info("Using injected ServerSync");
      await this.authenticateAndRetryQueued();
      return;
    }

    const serverUrl = await ctx.settingsRepository.get(SettingKey.SERVER_URL);
    const apiKey = await ctx.settingsRepository.get(SettingKey.API_KEY);

    if (!serverUrl || !apiKey) {
      logger.info("No server URL or API key configured, running in degraded mode");
      this.serverSync = createDegradedServerSync();
      return;
    }

    this.serverSync = createServerSync({ serverUrl, apiKey });
    await this.authenticateAndRetryQueued();
  }

  private async authenticateAndRetryQueued(): Promise<void> {
    if (!this.serverSync) return;

    try {
      const maxConcurrent = Number.parseInt(
        await this.ctx.settingsRepository.get(SettingKey.MAX_CONCURRENT_TASKS),
        10,
      );

      const result = await this.serverSync.authenticate({
        requestedMaxConcurrentTasks: maxConcurrent,
      });

      logger.info("Authenticated with server, clientId: {clientId}, maxConcurrent: {max}", {
        clientId: result.clientId,
        max: result.effectiveMaxConcurrentTasks,
      });

      await this.serverSync.flushOfflineQueue();
      await this.serverSync.retryQueuedReadyTasks();
    } catch (err) {
      logger.warn("Server authentication failed, running in degraded mode: {error}", {
        error: String(err),
      });
    }
  }

  getServerSync(): ServerSync | null {
    return this.serverSync;
  }

  private async resumeWorkingTasks(ctx: CommandContext): Promise<void> {
    const workingTasks = await ctx.taskRepository.list({ status: "WORKING" });
    logger.info("Found {count} working tasks to resume", { count: workingTasks.length });

    for (const task of workingTasks) {
      const step = await ctx.executionRepository.getLatestStepExecution(task.id);

      if (step?.agent_pid && isProcessAlive(step.agent_pid)) {
        logger.info("Task {taskId} has running agent (pid {pid}), monitoring", {
          taskId: task.id,
          pid: step.agent_pid,
        });
      } else {
        logger.info("Task {taskId} agent not running, attempting recovery", { taskId: task.id });
        await this.recoverTask(ctx, task);
      }
    }
  }

  private async recoverTask(ctx: CommandContext, task: Task): Promise<void> {
    if (!this.serverSync || this.serverSync.isDegraded()) {
      logger.warn("Cannot recover task {taskId} without server connection", { taskId: task.id });
      return;
    }

    try {
      const readyResult = await this.serverSync.markTaskReady(task.id, task.repo_id);
      if (readyResult.step && readyResult.execution) {
        this.executeTaskAsync(ctx, task, readyResult.step, readyResult.execution);
      } else {
        logger.warn("Server did not return step command for recovery, task {taskId}", {
          taskId: task.id,
        });
      }
    } catch (err) {
      logger.error("Failed to recover task {taskId}: {error}", {
        taskId: task.id,
        error: String(err),
      });
    }
  }

  private async startWatcher(ctx: CommandContext): Promise<void> {
    const repos = await ctx.repoRepository.getAll();

    this.watcher = createWatcherManager(async (event) => {
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
      this.watcher.addRepo(repo.id, repo.path);
    }

    logger.info("Watcher started for {count} repos", { count: repos.length });
  }

  private async startTicker(ctx: CommandContext): Promise<void> {
    const intervalSecs = Number.parseInt(
      await ctx.settingsRepository.get(SettingKey.WATCHER_POLL_INTERVAL_SECS),
      10,
    );

    this.ticker = createTicker(
      async () => {
        this.triggerRefresh();
      },
      { intervalMs: intervalSecs * 1000 },
    );

    this.ticker.start();
  }

  private async startQueueProcessor(ctx: CommandContext): Promise<void> {
    this.queueProcessor = createQueueProcessor({
      taskRepository: ctx.taskRepository,
      repoRepository: ctx.repoRepository,
      settingsRepository: ctx.settingsRepository,
      serverSync: this.serverSync ?? undefined,
      executeTask: (task, stepCommand, execution) =>
        this.executeTaskAsync(ctx, task, stepCommand, execution),
    });

    await this.queueProcessor.start();
  }

  private executeTaskAsync(
    ctx: CommandContext,
    task: Task,
    stepCommand: { id: string; type: string; promptTemplate: string; attempt: number },
    execution: { id: string; workflowId: string },
  ): void {
    const promise: Promise<void> = executeTask(
      ctx,
      task,
      stepCommand,
      execution,
      this.serverSync ?? undefined,
    )
      .then(() => {})
      .catch((err) => {
        logger.error("Task execution failed: {error}", { taskId: task.id, error: String(err) });
      })
      .finally(() => {
        this.executingTasks.delete(task.id);
      });

    this.executingTasks.set(task.id, { task, promise });
  }

  private async waitForExecutingTasks(): Promise<void> {
    if (this.executingTasks.size === 0) return;

    logger.info("Waiting for {count} executing tasks to complete", {
      count: this.executingTasks.size,
    });

    const promises = Array.from(this.executingTasks.values()).map((t) => t.promise);
    await Promise.allSettled(promises);
  }

  private writePid(): void {
    writePidFile(this.pidFile);
  }

  private removePid(): void {
    removePidFile(this.pidFile);
  }

  private setupSignalHandlers(): void {
    const shutdownHandler = () => {
      logger.info("Received shutdown signal");
      this.stop();
    };

    process.on("SIGTERM", shutdownHandler);
    process.on("SIGINT", shutdownHandler);

    process.on("SIGUSR1", () => {
      logger.info("Received SIGUSR1, refreshing watched repos");
      this.triggerRefresh();
    });
  }

  private triggerRefresh(): void {
    if (!this.running) return;

    this.pendingRefresh = this.refreshWatchedRepos()
      .catch((err) => {
        logger.error("Refresh failed: {error}", { error: String(err) });
      })
      .finally(() => {
        this.pendingRefresh = null;
      });
  }

  private async refreshWatchedRepos(): Promise<void> {
    if (!this.watcher) return;

    const startTime = performance.now();
    const ctx = this.ctx;
    const repos = await ctx.repoRepository.getAll();

    let removedCount = 0;
    for (const repo of repos) {
      if (!existsSync(repo.path)) {
        logger.info("Repo path no longer exists, removing: {repoPath}", {
          repoId: repo.id,
          repoPath: repo.path,
        });
        this.watcher.removeRepo(repo.id);
        await ctx.repoRepository.remove(repo.id);
        removedCount++;
        continue;
      }
      this.watcher.addRepo(repo.id, repo.path);
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
  }
}

export const createDaemon = (config: DaemonConfig = {}): Daemon => {
  const dbPath = config.dbPath ?? getDefaultDbPath();
  const db = createDatabase(dbPath);
  const instance = new DaemonInstance(db, config);

  return {
    start: () => instance.start(),
    stop: () => instance.stop(),
    isRunning: () => instance.isRunning(),
    getServerSync: () => instance.getServerSync(),
  };
};

export {
  DEFAULT_PID_FILE,
  getDaemonPid,
  getDefaultPidFile,
  isDaemonRunning,
  isProcessAlive,
  notifyDaemon,
  stopDaemonByPid,
} from "./pid-utils.ts";
