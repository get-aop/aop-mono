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
import { createRepoRepository, type RepoRepository } from "./repo/repository.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings/repository.ts";
import { createTaskRepository, type TaskRepository } from "./task/repository.ts";

export interface LocalServerContext {
  taskRepository: TaskRepository;
  repoRepository: RepoRepository;
  settingsRepository: SettingsRepository;
  executionRepository: ExecutionRepository;
  taskEventEmitter: TaskEventEmitter;
  logBuffer: LogBuffer;
}

export interface CreateCommandContextOptions {
  taskEventEmitter?: TaskEventEmitter;
  logBuffer?: LogBuffer;
}

export const createCommandContext = (
  db: Kysely<Database>,
  options: CreateCommandContextOptions = {},
): LocalServerContext => {
  const taskEventEmitter = options.taskEventEmitter ?? getTaskEventEmitter();
  const logBuffer = options.logBuffer ?? getLogBuffer();

  return {
    taskRepository: createTaskRepository(db, {
      eventEmitter: taskEventEmitter,
    }),
    repoRepository: createRepoRepository(db),
    settingsRepository: createSettingsRepository(db),
    executionRepository: createExecutionRepository(db),
    taskEventEmitter,
    logBuffer,
  };
};
