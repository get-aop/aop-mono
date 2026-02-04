import type { Kysely } from "kysely";
import type { Database } from "./db/schema.ts";
import {
  createExecutionRepository,
  type ExecutionRepository,
} from "./executor/execution-repository.ts";
import { createRepoRepository, type RepoRepository } from "./repo/repository.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings/repository.ts";
import { createTaskRepository, type TaskRepository } from "./task/repository.ts";

export interface CommandContext {
  taskRepository: TaskRepository;
  repoRepository: RepoRepository;
  settingsRepository: SettingsRepository;
  executionRepository: ExecutionRepository;
}

export const createCommandContext = (db: Kysely<Database>): CommandContext => ({
  taskRepository: createTaskRepository(db),
  repoRepository: createRepoRepository(db),
  settingsRepository: createSettingsRepository(db),
  executionRepository: createExecutionRepository(db),
});
