import type {
  ExecutionInfo,
  StepCommand,
  TaskReadyResponse,
  TaskStatus,
} from "@aop/common/protocol";
import { getLogger, runWithSpan } from "@aop/infra";
import type { Task } from "../../db/schema.ts";
import type { ExecutionRepository } from "../../executor/execution-repository.ts";
import type { RepoRepository } from "../../repo/repository.ts";
import type { SettingsRepository } from "../../settings/repository.ts";
import { SettingKey } from "../../settings/types.ts";
import type { ConcurrencyLimits, TaskRepository } from "../../task/repository.ts";
import type { MarkReadyOptions, ServerSync } from "../sync/server-sync.ts";

const logger = getLogger("queue-processor");

export interface QueueProcessorConfig {
  pollIntervalMs?: number;
}

export interface QueueProcessorDeps {
  taskRepository: TaskRepository;
  repoRepository: RepoRepository;
  settingsRepository: SettingsRepository;
  executionRepository: ExecutionRepository;
  serverSync?: ServerSync;
  executeTask: (
    task: Task,
    stepCommand: StepCommand,
    execution: ExecutionInfo,
    revertStatus?: TaskStatus,
  ) => void;
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
  const {
    taskRepository,
    repoRepository,
    settingsRepository,
    executionRepository,
    serverSync,
    executeTask,
  } = deps;
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
    return repo?.max_concurrent_tasks ?? 3;
  };

  const buildMarkReadyOptions = (task: Task): MarkReadyOptions | undefined => {
    const options: MarkReadyOptions = {};
    if (task.preferred_workflow) options.workflowName = task.preferred_workflow;
    if (task.retry_from_step) options.retryFromStep = task.retry_from_step;
    return Object.keys(options).length > 0 ? options : undefined;
  };

  const tryMarkTaskReady = async (task: Task): Promise<TaskReadyResponse | null> => {
    if (!serverSync || serverSync.isDegraded()) {
      return null;
    }
    if (serverSync.isTaskQueued(task.id)) {
      return { status: task.status, queued: true };
    }

    try {
      return await serverSync.markTaskReady(task.id, task.repo_id, buildMarkReadyOptions(task));
    } catch (err) {
      logger.warn("Failed to mark task ready on server: {error}", {
        taskId: task.id,
        error: String(err),
      });
      return null;
    }
  };

  interface ResolvedStep {
    step: StepCommand;
    execution: ExecutionInfo;
  }

  const resolveStep = async (task: Task): Promise<ResolvedStep | null> => {
    const log = logger.with({ taskId: task.id });
    const readyResult = await tryMarkTaskReady(task);

    if (!readyResult) {
      log.debug("No server connection, task stays READY");
      return null;
    }

    if (readyResult.queued) {
      log.debug("Task queued by server, skipping execution");
      return null;
    }

    if (!readyResult.step || !readyResult.execution) {
      log.warn("Server returned incomplete response, skipping execution");
      return null;
    }

    return { step: readyResult.step, execution: readyResult.execution };
  };

  const resolveResume = async (task: Task): Promise<ResolvedStep | null> => {
    const log = logger.with({ taskId: task.id });

    if (!serverSync || serverSync.isDegraded()) {
      log.debug("No server connection, task stays RESUMING");
      return null;
    }

    if (!task.resume_input) {
      log.error("No resume_input found for RESUMING task");
      return null;
    }

    const latestStep = await executionRepository.getLatestStepExecution(task.id);
    if (!latestStep) {
      log.error("No step execution found for RESUMING task");
      return null;
    }

    const response = await serverSync.resumeStep(latestStep.id, task.resume_input);

    if (!response.step || !response.execution) {
      log.warn("Server returned incomplete resume response");
      return null;
    }

    return { step: response.step, execution: response.execution };
  };

  const processReadyTask = async (limits: ConcurrencyLimits): Promise<Task | null> => {
    const task = await taskRepository.getNextExecutable(limits);
    if (!task) return null;

    // Claim the task immediately to prevent double-dequeue race condition.
    // Reverted to READY if execution doesn't proceed.
    await taskRepository.update(task.id, { status: "WORKING" });

    try {
      const stepInfo = await resolveStep(task);
      if (!stepInfo) {
        await taskRepository.update(task.id, { status: "READY" });
        return null;
      }

      if (task.retry_from_step) {
        await taskRepository.update(task.id, { retry_from_step: null });
      }

      logger.info("Executing task", { taskId: task.id, changePath: task.change_path });
      executeTask(task, stepInfo.step, stepInfo.execution, "READY");
      return task;
    } catch (err) {
      await taskRepository.update(task.id, { status: "READY" }).catch(() => {});
      throw err;
    }
  };

  const processResumingTask = async (limits: ConcurrencyLimits): Promise<Task | null> => {
    const task = await taskRepository.getNextResumable(limits);
    if (!task) return null;

    await taskRepository.update(task.id, { status: "WORKING" });

    try {
      const stepInfo = await resolveResume(task);
      if (!stepInfo) {
        await taskRepository.update(task.id, { status: "RESUMING" });
        return null;
      }

      await taskRepository.update(task.id, { resume_input: null });

      logger.info("Resuming task", { taskId: task.id, changePath: task.change_path });
      executeTask(task, stepInfo.step, stepInfo.execution, "BLOCKED");
      return task;
    } catch (err) {
      await taskRepository.update(task.id, { status: "RESUMING" }).catch(() => {});
      throw err;
    }
  };

  const processOnce = async (): Promise<Task | null> => {
    const limits: ConcurrencyLimits = {
      globalMax: await getGlobalMax(),
      getRepoMax,
    };

    // Prioritize resuming paused tasks over starting new ones
    const resumed = await processResumingTask(limits);
    if (resumed) return resumed;

    return processReadyTask(limits);
  };

  const loop = async () => {
    if (!running) return;

    try {
      await runWithSpan("queue-process", () => processOnce());
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
