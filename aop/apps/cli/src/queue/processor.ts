import type { ExecutionInfo, StepCommand, TaskReadyResponse } from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import type { Task } from "../db/schema.ts";
import type { RepoRepository } from "../repos/repository.ts";
import type { SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";
import type { ServerSync } from "../sync/server-sync.ts";
import type { ConcurrencyLimits, TaskRepository } from "../tasks/repository.ts";

const logger = getLogger("aop", "queue-processor");

export interface QueueProcessorConfig {
  pollIntervalMs?: number;
}

export interface QueueProcessorDeps {
  taskRepository: TaskRepository;
  repoRepository: RepoRepository;
  settingsRepository: SettingsRepository;
  serverSync?: ServerSync;
  executeTask: (task: Task, stepCommand: StepCommand, execution: ExecutionInfo) => void;
}

export interface QueueProcessor {
  start: () => Promise<void>;
  stop: () => void;
  isRunning: () => boolean;
  processOnce: () => Promise<Task | null>;
}

export const createQueueProcessor = (
  deps: QueueProcessorDeps,
  config?: QueueProcessorConfig,
): QueueProcessor => {
  const { taskRepository, repoRepository, settingsRepository, serverSync, executeTask } = deps;
  let running = false;
  let timer: Timer | null = null;

  const getPollIntervalMs = async (): Promise<number> => {
    if (config?.pollIntervalMs !== undefined) {
      return config.pollIntervalMs;
    }
    const intervalSecs = await settingsRepository.get(SettingKey.QUEUE_POLL_INTERVAL_SECS);
    return Number.parseInt(intervalSecs, 10) * 1000;
  };

  const getGlobalMax = async (): Promise<number> => {
    const maxStr = await settingsRepository.get(SettingKey.MAX_CONCURRENT_TASKS);
    return Number.parseInt(maxStr, 10);
  };

  const getRepoMax = async (repoId: string): Promise<number> => {
    const repo = await repoRepository.getById(repoId);
    return repo?.max_concurrent_tasks ?? 1;
  };

  const tryMarkTaskReady = async (task: Task): Promise<TaskReadyResponse | null> => {
    if (!serverSync || serverSync.isDegraded()) {
      return null;
    }

    try {
      const options = task.preferred_workflow
        ? { workflowName: task.preferred_workflow }
        : undefined;
      return await serverSync.markTaskReady(task.id, task.repo_id, options);
    } catch (err) {
      logger.warn("Failed to mark task ready on server: {error}", {
        taskId: task.id,
        error: String(err),
      });
      return null;
    }
  };

  const processOnce = async (): Promise<Task | null> => {
    const limits: ConcurrencyLimits = {
      globalMax: await getGlobalMax(),
      getRepoMax,
    };

    const task = await taskRepository.getNextExecutable(limits);
    if (!task) {
      return null;
    }

    const log = logger.with({ taskId: task.id, changePath: task.change_path });

    const readyResult = await tryMarkTaskReady(task);

    if (!readyResult) {
      log.debug("No server connection, task stays READY");
      return null;
    }

    if (readyResult.queued) {
      log.info("Task queued by server, skipping execution");
      return null;
    }

    if (!readyResult.step || !readyResult.execution) {
      log.warn("Server returned incomplete response, skipping execution");
      return null;
    }

    log.info("Executing task");
    executeTask(task, readyResult.step, readyResult.execution);

    return task;
  };

  const loop = async () => {
    if (!running) return;

    try {
      await processOnce();
    } catch (err) {
      logger.error("Queue processor error: {error}", { error: String(err), err });
    }

    if (running) {
      const intervalMs = await getPollIntervalMs();
      timer = setTimeout(loop, intervalMs);
    }
  };

  return {
    start: async () => {
      if (running) {
        logger.warn("Queue processor already running");
        return;
      }
      running = true;
      const intervalMs = await getPollIntervalMs();
      logger.info("Queue processor started with interval {intervalMs}ms", { intervalMs });
      timer = setTimeout(loop, intervalMs);
    },

    stop: () => {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      logger.info("Queue processor stopped");
    },

    isRunning: () => running,

    processOnce,
  };
};
