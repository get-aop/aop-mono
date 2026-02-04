import { getRemoteOrigin } from "@aop/git-manager";
import { generateTypeId, getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { abortTask } from "../executor/index.ts";
import { extractRepoName } from "./repository.ts";

export type InitRepoResult =
  | { success: true; repoId: string; alreadyExists: boolean }
  | { success: false; error: InitRepoError };

export type InitRepoError = { code: "NOT_A_GIT_REPO"; path: string };

export type RemoveRepoResult =
  | { success: true; repoId: string; abortedTasks: number }
  | { success: false; error: RemoveRepoError };

export type RemoveRepoError =
  | { code: "NOT_FOUND"; path: string }
  | { code: "HAS_WORKING_TASKS"; count: number }
  | { code: "REMOVE_FAILED" };

export interface RemoveRepoOptions {
  force?: boolean;
}

export const initRepo = async (
  ctx: LocalServerContext,
  repoPath: string,
): Promise<InitRepoResult> => {
  const { repoRepository } = ctx;

  const isGitRepo = await checkGitRepo(repoPath);
  if (!isGitRepo) {
    return {
      success: false,
      error: { code: "NOT_A_GIT_REPO", path: repoPath },
    };
  }

  const existing = await repoRepository.getByPath(repoPath);
  if (existing) {
    return { success: true, repoId: existing.id, alreadyExists: true };
  }

  const name = extractRepoName(repoPath);
  const remoteOrigin = await getRemoteOrigin(repoPath);
  const now = new Date().toISOString();

  const repo = await repoRepository.create({
    id: generateTypeId("repo"),
    path: repoPath,
    name,
    remote_origin: remoteOrigin,
    max_concurrent_tasks: 1,
    created_at: now,
    updated_at: now,
  });

  return { success: true, repoId: repo.id, alreadyExists: false };
};

export const removeRepo = async (
  ctx: LocalServerContext,
  repoPath: string,
  options: RemoveRepoOptions = {},
): Promise<RemoveRepoResult> => {
  const { repoRepository, taskRepository } = ctx;

  const repo = await repoRepository.getByPath(repoPath);
  if (!repo) {
    return { success: false, error: { code: "NOT_FOUND", path: repoPath } };
  }

  const workingTasks = await taskRepository.list({
    status: "WORKING",
    repo_id: repo.id,
  });
  if (workingTasks.length > 0 && !options.force) {
    return {
      success: false,
      error: { code: "HAS_WORKING_TASKS", count: workingTasks.length },
    };
  }

  let abortedTasks = 0;
  if (workingTasks.length > 0) {
    abortedTasks = await abortWorkingTasks(ctx, workingTasks);
  }

  const removed = await repoRepository.remove(repo.id);
  if (!removed) {
    return { success: false, error: { code: "REMOVE_FAILED" } };
  }

  return { success: true, repoId: repo.id, abortedTasks };
};

const checkGitRepo = async (path: string): Promise<boolean> => {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--git-dir"], {
      cwd: path,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
};

export const getRepoById = async (ctx: LocalServerContext, repoId: string) => {
  return ctx.repoRepository.getById(repoId);
};

export const getRepoTasks = async (ctx: LocalServerContext, repoId: string) => {
  return ctx.taskRepository.list({ repo_id: repoId, excludeRemoved: true });
};

const logger = getLogger("aop", "repos-handlers");

const abortWorkingTasks = async (ctx: LocalServerContext, tasks: Task[]): Promise<number> => {
  let abortedCount = 0;

  for (const task of tasks) {
    try {
      await abortTask(ctx, task.id);
      abortedCount++;
    } catch (err) {
      logger.error("Failed to abort task {taskId}: {error}", {
        taskId: task.id,
        error: String(err),
        err,
      });
    }
  }

  return abortedCount;
};
