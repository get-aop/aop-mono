import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BranchNotFoundError,
  DirtyWorkingDirectoryError,
  GitManager,
  NoChangesError,
  WorktreeNotFoundError,
} from "@aop/git-manager";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { abortTask } from "../executor/index.ts";
import { resolveTask } from "./resolve.ts";

const logger = getLogger("task");

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

export type ResumeTaskResult =
  | { success: true; taskId: string }
  | { success: false; error: ResumeTaskError };

export type ResumeTaskError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "NOT_PAUSED"; status: string }
  | { code: "NO_STEP_EXECUTION" }
  | { code: "RESUME_FAILED"; message: string };

export const resumeTask = async (
  ctx: LocalServerContext,
  identifier: string,
  input: string,
): Promise<ResumeTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    logger.warn("Resume failed: task not found {identifier}", { identifier });
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status !== "PAUSED") {
    logger.warn("Resume failed: task {taskId} status is {status}, expected PAUSED", {
      taskId: task.id,
      status: task.status,
    });
    return { success: false, error: { code: "NOT_PAUSED", status: task.status } };
  }

  const latestStep = await ctx.executionRepository.getLatestStepExecution(task.id);
  if (!latestStep) {
    logger.error("Resume failed: no step execution found for task {taskId}", { taskId: task.id });
    return { success: false, error: { code: "NO_STEP_EXECUTION" } };
  }

  await ctx.taskRepository.update(task.id, {
    status: "RESUMING",
    resume_input: input,
  });

  logger.info("Task enqueued for resume {taskId}", { taskId: task.id });
  return { success: true, taskId: task.id };
};

export type MarkTaskReadyResult =
  | { success: true; task: Task }
  | { success: false; error: MarkTaskReadyError };

export type MarkTaskReadyError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "ALREADY_READY"; taskId: string }
  | { code: "INVALID_STATUS"; status: string }
  | { code: "MISSING_PROMPT_FILE"; changePath: string }
  | { code: "UPDATE_FAILED" };

export interface MarkTaskReadyOptions {
  workflow?: string;
  baseBranch?: string;
  provider?: string;
  retryFromStep?: string;
}

const getMarkTaskReadyError = (task: Task): MarkTaskReadyError | null => {
  if (task.status === "READY") {
    return { code: "ALREADY_READY", taskId: task.id };
  }

  if (task.status !== "DRAFT" && task.status !== "BLOCKED") {
    return { code: "INVALID_STATUS", status: task.status };
  }

  return null;
};

const buildReadyTaskUpdate = (options?: MarkTaskReadyOptions) => ({
  status: "READY" as const,
  ready_at: new Date().toISOString(),
  preferred_workflow: options?.workflow ?? null,
  base_branch: options?.baseBranch ?? null,
  preferred_provider: options?.provider ?? null,
  retry_from_step: options?.retryFromStep ?? null,
});

export const markTaskReady = async (
  ctx: LocalServerContext,
  identifier: string,
  options?: MarkTaskReadyOptions,
): Promise<MarkTaskReadyResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    logger.warn("Mark ready failed: task not found {identifier}", { identifier });
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  const invalidState = getMarkTaskReadyError(task);
  if (invalidState) {
    if (invalidState.code === "INVALID_STATUS") {
      logger.warn("Mark ready failed: invalid status {status} for task {taskId}", {
        status: task.status,
        taskId: task.id,
      });
    }

    return { success: false, error: invalidState };
  }

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    return {
      success: false,
      error: { code: "NOT_FOUND", identifier },
    };
  }

  const changePath = join(repo.path, task.change_path);
  if (!hasMarkdownFile(changePath)) {
    logger.warn("Mark ready failed: no .md files at {changePath}", {
      changePath: task.change_path,
    });
    return {
      success: false,
      error: { code: "MISSING_PROMPT_FILE", changePath: task.change_path },
    };
  }

  const updated = await ctx.taskRepository.update(task.id, buildReadyTaskUpdate(options));

  if (!updated) {
    logger.error("Mark ready failed: update returned null for task {taskId}", { taskId: task.id });
    return { success: false, error: { code: "UPDATE_FAILED" } };
  }

  logger.info("Task marked ready {taskId} ({changePath})", {
    taskId: updated.id,
    changePath: updated.change_path,
  });
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
    logger.warn("Remove failed: task not found {identifier}", { identifier });
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
      logger.warn("Remove blocked: task {taskId} is working (use force)", { taskId: task.id });
      return {
        success: false,
        error: { code: "TASK_WORKING", taskId: task.id },
      };
    }

    logger.info("Force removing working task {taskId}, aborting agent", { taskId: task.id });
    await abortTask(ctx, task.id, { serverSync: ctx.serverSync });
    return { success: true, taskId: task.id, aborted: true };
  }

  const success = await ctx.taskRepository.markRemoved(task.id);
  if (!success) {
    logger.error("Remove failed: markRemoved returned false for task {taskId}", {
      taskId: task.id,
    });
    return { success: false, error: { code: "REMOVE_FAILED" } };
  }

  logger.info("Task removed {taskId} ({changePath})", {
    taskId: task.id,
    changePath: task.change_path,
  });
  return { success: true, taskId: task.id, aborted: false };
};

export type BlockTaskResult =
  | { success: true; taskId: string; agentKilled: boolean }
  | { success: false; error: BlockTaskError };

export type BlockTaskError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "INVALID_STATUS"; status: string };

export const blockTask = async (
  ctx: LocalServerContext,
  identifier: string,
): Promise<BlockTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    logger.warn("Block failed: task not found {identifier}", { identifier });
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status !== "WORKING") {
    logger.warn("Block failed: task {taskId} status is {status}, expected WORKING", {
      taskId: task.id,
      status: task.status,
    });
    return {
      success: false,
      error: { code: "INVALID_STATUS", status: task.status },
    };
  }

  logger.info("Blocking task {taskId}, aborting agent", { taskId: task.id });
  const result = await abortTask(ctx, task.id, {
    targetStatus: "BLOCKED",
    serverSync: ctx.serverSync,
  });
  logger.info("Task blocked {taskId} (agentKilled={agentKilled})", {
    taskId: task.id,
    agentKilled: result.agentKilled,
  });
  return { success: true, taskId: task.id, agentKilled: result.agentKilled };
};

export type ApplyTaskResult =
  | { success: true; affectedFiles: string[]; conflictingFiles: string[] }
  | { success: false; error: ApplyTaskError };

export type ApplyTaskError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "INVALID_STATUS"; status: string }
  | { code: "REPO_NOT_FOUND"; taskId: string }
  | { code: "DIRTY_WORKING_DIRECTORY" }
  | { code: "NO_CHANGES" }
  | { code: "WORKTREE_NOT_FOUND"; taskId: string }
  | { code: "BRANCH_NOT_FOUND"; branch: string };

export const applyTask = async (
  ctx: LocalServerContext,
  identifier: string,
  targetBranch?: string,
): Promise<ApplyTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, identifier);
  if (!task) {
    logger.warn("Apply failed: task not found {identifier}", { identifier });
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status !== "DONE" && task.status !== "BLOCKED") {
    logger.warn("Apply failed: task {taskId} status is {status}", {
      taskId: task.id,
      status: task.status,
    });
    return {
      success: false,
      error: { code: "INVALID_STATUS", status: task.status },
    };
  }

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    logger.error("Apply failed: repo not found for task {taskId}", { taskId: task.id });
    return {
      success: false,
      error: { code: "REPO_NOT_FOUND", taskId: task.id },
    };
  }

  logger.info("Applying task {taskId} to {targetBranch}", {
    taskId: task.id,
    targetBranch: targetBranch ?? "current branch",
  });

  const gitManager = new GitManager({ repoPath: repo.path, repoId: repo.id });
  await gitManager.init();

  try {
    const result = await gitManager.applyWorktree(task.id, targetBranch);
    logger.info("Task applied {taskId}: {fileCount} files affected, {conflictCount} conflicts", {
      taskId: task.id,
      fileCount: result.affectedFiles.length,
      conflictCount: result.conflictingFiles.length,
    });
    return {
      success: true,
      affectedFiles: result.affectedFiles,
      conflictingFiles: result.conflictingFiles,
    };
  } catch (err) {
    const classified = classifyApplyError(err, task.id);
    logger.warn("Apply failed for task {taskId}: {code}", {
      taskId: task.id,
      code: classified.code,
    });
    return { success: false, error: classified };
  }
};

const hasMarkdownFile = (changePath: string): boolean => {
  if (!existsSync(changePath)) return false;
  const entries = readdirSync(changePath);
  return entries.some((entry) => entry.endsWith(".md"));
};

const classifyApplyError = (err: unknown, taskId: string): ApplyTaskError => {
  if (err instanceof DirtyWorkingDirectoryError) {
    return { code: "DIRTY_WORKING_DIRECTORY" };
  }
  if (err instanceof NoChangesError) {
    return { code: "NO_CHANGES" };
  }
  if (err instanceof WorktreeNotFoundError) {
    return { code: "WORKTREE_NOT_FOUND", taskId };
  }
  if (err instanceof BranchNotFoundError) {
    return { code: "BRANCH_NOT_FOUND", branch: err.branch };
  }
  throw err;
};
