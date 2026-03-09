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
import { createRepoRepository, type RepoRepository } from "./repo/repository.ts";
import { createSessionRepository, type SessionRepository } from "./session/repository.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings/repository.ts";
import { createTaskRepository, type TaskRepository } from "./task/repository.ts";
import { createLocalWorkflowService, type LocalWorkflowService } from "./workflow/service.ts";

export interface LocalServerContext {
  taskRepository: TaskRepository;
  repoRepository: RepoRepository;
  settingsRepository: SettingsRepository;
  executionRepository: ExecutionRepository;
  sessionRepository: SessionRepository;
  taskEventEmitter: TaskEventEmitter;
  logBuffer: LogBuffer;
  logFlusher: LogFlusher;
  workflowService: LocalWorkflowService;
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
  const repoRepository = createRepoRepository(db);
  const executionRepository = createExecutionRepository();
  const logFlusher = options.logFlusher ?? createLogFlusher(executionRepository);

  const context = {
    taskRepository: createTaskRepository(repoRepository, {
      eventEmitter: taskEventEmitter,
    }),
    repoRepository,
    settingsRepository: createSettingsRepository(db),
    executionRepository,
    sessionRepository: createSessionRepository(db),
    taskEventEmitter,
    logBuffer,
    logFlusher,
  } as LocalServerContext;

  context.workflowService = createLocalWorkflowService(context);

  return context;
};
