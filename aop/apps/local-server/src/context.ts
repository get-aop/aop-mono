import type { Kysely } from "kysely";
import type { Database } from "./db/schema.ts";
import {
  getLogBuffer,
  getTaskEventEmitter,
  type LogBuffer,
  type TaskEventEmitter,
} from "./events/index.ts";
import {
  createExecutionRepository,
  type ExecutionRepository,
} from "./executor/execution-repository.ts";
import { createLogFlusher, type LogFlusher } from "./executor/log-flusher.ts";
import type { ServerSync } from "./orchestrator/sync/server-sync.ts";
import { createRepoRepository, type RepoRepository } from "./repo/repository.ts";
import { createSessionRepository, type SessionRepository } from "./session/repository.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings/repository.ts";
import { createTaskRepository, type TaskRepository } from "./task/repository.ts";

export interface LocalServerContext {
  taskRepository: TaskRepository;
  repoRepository: RepoRepository;
  settingsRepository: SettingsRepository;
  executionRepository: ExecutionRepository;
  sessionRepository: SessionRepository;
  taskEventEmitter: TaskEventEmitter;
  logBuffer: LogBuffer;
  logFlusher: LogFlusher;
  serverSync?: ServerSync;
}

export interface CreateCommandContextOptions {
  taskEventEmitter?: TaskEventEmitter;
  logBuffer?: LogBuffer;
  logFlusher?: LogFlusher;
}

export const createCommandContext = (
  db: Kysely<Database>,
  options: CreateCommandContextOptions = {},
): LocalServerContext => {
  const taskEventEmitter = options.taskEventEmitter ?? getTaskEventEmitter();
  const logBuffer = options.logBuffer ?? getLogBuffer();
  const executionRepository = createExecutionRepository(db);
  const logFlusher = options.logFlusher ?? createLogFlusher(executionRepository);

  return {
    taskRepository: createTaskRepository(db, {
      eventEmitter: taskEventEmitter,
    }),
    repoRepository: createRepoRepository(db),
    settingsRepository: createSettingsRepository(db),
    executionRepository,
    sessionRepository: createSessionRepository(db),
    taskEventEmitter,
    logBuffer,
    logFlusher,
  };
};
