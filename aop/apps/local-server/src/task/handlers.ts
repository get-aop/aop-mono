import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ApplyConflictError,
  DirtyWorkingDirectoryError,
  GitManager,
  NoChangesError,
  WorktreeNotFoundError,
} from "@aop/git-manager";
import { aopPaths } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { abortTask } from "../executor/index.ts";
import { resolveTask } from "./resolve.ts";

export const getTaskById = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<Task | null> => {
  return ctx.taskRepository.get(taskId);
};

export const resolveTaskByIdentifier = async (
  ctx: LocalServerContext,
  identifier: string,
): Promise<Task | null> => {
  return resolveTask(ctx.taskRepository, identifier);
};

export type MarkTaskReadyResult =
  | { success: true; task: Task }
  | { success: false; error: MarkTaskReadyError };

export type MarkTaskReadyError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "ALREADY_READY"; taskId: string }
  | { code: "INVALID_STATUS"; status: string }
  | { code: "MISSING_TASKS_FILE"; changePath: string }
  | { code: "UPDATE_FAILED" };

export interface MarkTaskReadyOptions {
  workflow?: string;
  baseBranch?: string;
}

export const markTaskReady = async (
  ctx: LocalServerContext,
  identifier: string,
  options?: MarkTaskReadyOptions,
): Promise<MarkTaskReadyResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status === "READY") {
    return {
      success: false,
      error: { code: "ALREADY_READY", taskId: task.id },
    };
  }

  if (task.status !== "DRAFT" && task.status !== "BLOCKED") {
    return {
      success: false,
      error: { code: "INVALID_STATUS", status: task.status },
    };
  }

  const changePath = join(aopPaths.repoDir(task.repo_id), task.change_path);
  if (!hasTasksFile(changePath)) {
    return {
      success: false,
      error: { code: "MISSING_TASKS_FILE", changePath: task.change_path },
    };
  }

  const updated = await ctx.taskRepository.update(task.id, {
    status: "READY",
    ready_at: new Date().toISOString(),
    preferred_workflow: options?.workflow ?? null,
    base_branch: options?.baseBranch ?? null,
  });

  if (!updated) {
    return { success: false, error: { code: "UPDATE_FAILED" } };
  }

  return { success: true, task: updated };
};

export type RemoveTaskResult =
  | { success: true; taskId: string; aborted: boolean }
  | { success: false; error: RemoveTaskError };

export type RemoveTaskError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "ALREADY_REMOVED"; taskId: string }
  | { code: "TASK_WORKING"; taskId: string }
  | { code: "REMOVE_FAILED" };

export interface RemoveTaskOptions {
  force?: boolean;
}

export const removeTask = async (
  ctx: LocalServerContext,
  identifier: string,
  options: RemoveTaskOptions = {},
): Promise<RemoveTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status === "REMOVED") {
    return {
      success: false,
      error: { code: "ALREADY_REMOVED", taskId: task.id },
    };
  }

  if (task.status === "WORKING") {
    if (!options.force) {
      return {
        success: false,
        error: { code: "TASK_WORKING", taskId: task.id },
      };
    }

    await abortTask(ctx, task.id);
    return { success: true, taskId: task.id, aborted: true };
  }

  const success = await ctx.taskRepository.markRemoved(task.id);
  if (!success) {
    return { success: false, error: { code: "REMOVE_FAILED" } };
  }

  return { success: true, taskId: task.id, aborted: false };
};

export type ApplyTaskResult =
  | { success: true; affectedFiles: string[] }
  | { success: false; error: ApplyTaskError };

export type ApplyTaskError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "INVALID_STATUS"; status: string }
  | { code: "REPO_NOT_FOUND"; taskId: string }
  | { code: "DIRTY_WORKING_DIRECTORY" }
  | { code: "CONFLICT"; conflictingFiles: string[] }
  | { code: "NO_CHANGES" }
  | { code: "WORKTREE_NOT_FOUND"; taskId: string };

export const applyTask = async (
  ctx: LocalServerContext,
  identifier: string,
): Promise<ApplyTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status !== "DONE" && task.status !== "BLOCKED") {
    return {
      success: false,
      error: { code: "INVALID_STATUS", status: task.status },
    };
  }

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    return {
      success: false,
      error: { code: "REPO_NOT_FOUND", taskId: task.id },
    };
  }

  const gitManager = new GitManager({ repoPath: repo.path, repoId: repo.id });
  await gitManager.init();

  try {
    const result = await gitManager.applyWorktree(task.id);
    return { success: true, affectedFiles: result.affectedFiles };
  } catch (err) {
    return { success: false, error: classifyApplyError(err, task.id) };
  }
};

const TASKS_FILE = "tasks.md";

const hasTasksFile = (changePath: string): boolean => {
  return existsSync(join(changePath, TASKS_FILE));
};

const classifyApplyError = (err: unknown, taskId: string): ApplyTaskError => {
  if (err instanceof DirtyWorkingDirectoryError) {
    return { code: "DIRTY_WORKING_DIRECTORY" };
  }
  if (err instanceof ApplyConflictError) {
    return { code: "CONFLICT", conflictingFiles: err.conflictingFiles };
  }
  if (err instanceof NoChangesError) {
    return { code: "NO_CHANGES" };
  }
  if (err instanceof WorktreeNotFoundError) {
    return { code: "WORKTREE_NOT_FOUND", taskId };
  }
  throw err;
};
