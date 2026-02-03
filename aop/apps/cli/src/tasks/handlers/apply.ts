import {
  ApplyConflictError,
  DirtyWorkingDirectoryError,
  GitManager,
  NoChangesError,
  WorktreeNotFoundError,
} from "@aop/git-manager";
import type { CommandContext } from "../../context.ts";
import { resolveTask } from "../resolve.ts";

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
  ctx: CommandContext,
  identifier: string,
): Promise<ApplyTaskResult> => {
  const { taskRepository, repoRepository } = ctx;

  const task = await resolveTask(taskRepository, repoRepository, identifier);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status !== "DONE" && task.status !== "BLOCKED") {
    return { success: false, error: { code: "INVALID_STATUS", status: task.status } };
  }

  const repo = await repoRepository.getById(task.repo_id);
  if (!repo) {
    return { success: false, error: { code: "REPO_NOT_FOUND", taskId: task.id } };
  }

  const gitManager = new GitManager({ repoPath: repo.path });
  await gitManager.init();

  try {
    const result = await gitManager.applyWorktree(task.id);
    return { success: true, affectedFiles: result.affectedFiles };
  } catch (err) {
    return { success: false, error: classifyApplyError(err, task.id) };
  }
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
