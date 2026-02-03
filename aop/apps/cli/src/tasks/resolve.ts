import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { findRepoRoot } from "@aop/git-manager";
import type { Task } from "../db/schema.ts";
import type { RepoRepository } from "../repos/repository.ts";
import type { TaskRepository } from "./repository.ts";

/**
 * Resolves a task by ID or change path.
 * First tries to find by task ID, then falls back to change path lookup.
 * Returns null if the task is not found (does not create new tasks).
 */
export const resolveTask = async (
  taskRepository: TaskRepository,
  repoRepository: RepoRepository,
  identifier: string,
): Promise<Task | null> => {
  const taskById = await taskRepository.get(identifier);
  if (taskById) return taskById;

  return resolveTaskByChangePath(taskRepository, repoRepository, identifier);
};

/**
 * Resolves a task by its change path (relative or absolute).
 * Determines the repo from the path and looks up the task by change_path.
 * Tasks are stored with relative paths (e.g., "openspec/changes/mychange").
 */
export const resolveTaskByChangePath = async (
  taskRepository: TaskRepository,
  repoRepository: RepoRepository,
  changePath: string,
): Promise<Task | null> => {
  const absolutePath = isAbsolute(changePath) ? changePath : resolve(process.cwd(), changePath);

  if (!existsSync(absolutePath)) return null;

  const repoPath = findRepoRoot(absolutePath);
  if (!repoPath) return null;

  const repo = await repoRepository.getByPath(repoPath);
  if (!repo) return null;

  const relativeChangePath = absolutePath.replace(`${repoPath}/`, "");
  return taskRepository.getByChangePath(repo.id, relativeChangePath);
};
