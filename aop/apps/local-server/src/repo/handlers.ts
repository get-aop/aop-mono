import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getRemoteOrigin, listLocalBranches } from "@aop/git-manager";
import { aopPaths, generateTypeId, getLogger } from "@aop/infra";
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
    logger.warn("Init repo failed: not a git repo at {path}", { path: repoPath });
    return {
      success: false,
      error: { code: "NOT_A_GIT_REPO", path: repoPath },
    };
  }

  const existing = await repoRepository.getByPath(repoPath);
  if (existing) {
    await setupOpenspecSymlink(repoPath, existing.id);
    logger.info("Repo already registered {repoId} at {path}", {
      repoId: existing.id,
      path: repoPath,
    });
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
    max_concurrent_tasks: 3,
    created_at: now,
    updated_at: now,
  });

  createRepoDirs(repo.id);
  await setupOpenspecSymlink(repoPath, repo.id);

  logger.info("Repo initialized {repoId} ({name}) at {path}", {
    repoId: repo.id,
    name,
    path: repoPath,
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
    logger.warn("Remove repo failed: not found at {path}", { path: repoPath });
    return { success: false, error: { code: "NOT_FOUND", path: repoPath } };
  }

  const workingTasks = await taskRepository.list({
    status: "WORKING",
    repo_id: repo.id,
  });
  if (workingTasks.length > 0 && !options.force) {
    logger.warn("Remove repo blocked: {count} working tasks for {repoId}", {
      count: workingTasks.length,
      repoId: repo.id,
    });
    return {
      success: false,
      error: { code: "HAS_WORKING_TASKS", count: workingTasks.length },
    };
  }

  let abortedTasks = 0;
  if (workingTasks.length > 0) {
    logger.info("Force removing repo {repoId}, aborting {count} tasks", {
      repoId: repo.id,
      count: workingTasks.length,
    });
    abortedTasks = await abortWorkingTasks(ctx, workingTasks);
  }

  // Mark all remaining non-REMOVED tasks as REMOVED before deleting the repo
  const remainingTasks = await taskRepository.list({
    repo_id: repo.id,
    excludeRemoved: true,
  });
  for (const task of remainingTasks) {
    if (task.status !== "WORKING") {
      await taskRepository.markRemoved(task.id);
    }
  }

  const removed = await repoRepository.remove(repo.id);
  if (!removed) {
    logger.error("Remove repo failed: repository.remove returned false for {repoId}", {
      repoId: repo.id,
    });
    return { success: false, error: { code: "REMOVE_FAILED" } };
  }

  logger.info("Repo removed {repoId} at {path} (aborted {abortedTasks} tasks)", {
    repoId: repo.id,
    path: repoPath,
    abortedTasks,
  });
  return { success: true, repoId: repo.id, abortedTasks };
};

const createRepoDirs = (repoId: string): void => {
  mkdirSync(aopPaths.worktreeMetadata(repoId), { recursive: true });
};

export const setupOpenspecSymlink = async (repoPath: string, repoId: string): Promise<void> => {
  const localOpenspecPath = join(repoPath, aopPaths.relativeOpenspec());
  const globalOpenspecPath = aopPaths.openspec(repoId);
  const nativeOpenspec = await hasTrackedOpenspecFiles(repoPath);

  if (isSymlink(localOpenspecPath) || isSymlink(globalOpenspecPath)) return;

  if (nativeOpenspec) {
    // Repo has committed openspec files — reverse symlink (global → local)
    mkdirSync(join(localOpenspecPath, "changes"), { recursive: true });
    mkdirSync(dirname(globalOpenspecPath), { recursive: true });
    symlinkSync(localOpenspecPath, globalOpenspecPath);
  } else {
    // No committed openspec files — standard symlink (local → global)
    mkdirSync(globalOpenspecPath, { recursive: true });
    relocateExistingOpenspec(localOpenspecPath, globalOpenspecPath);
    mkdirSync(join(globalOpenspecPath, "changes"), { recursive: true });
    symlinkSync(globalOpenspecPath, localOpenspecPath);
    addToGitExclude(repoPath, aopPaths.relativeOpenspec());
  }
};

const hasTrackedOpenspecFiles = async (repoPath: string): Promise<boolean> => {
  try {
    const proc = Bun.spawn(["git", "ls-files", "openspec/"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return false;

    const trackedFiles = output
      .trim()
      .split("\n")
      .filter((f) => f && !f.startsWith("openspec/changes/"));
    return trackedFiles.length > 0;
  } catch {
    return false;
  }
};

const isSymlink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const relocateExistingOpenspec = (localPath: string, globalPath: string): void => {
  if (!existsSync(localPath) || isSymlink(localPath)) return;

  const entries = readdirSync(localPath, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(localPath, entry.name);
    const dest = join(globalPath, entry.name);
    if (!existsSync(dest)) {
      cpSync(src, dest, { recursive: true });
    }
  }

  rmSync(localPath, { recursive: true, force: true });
};

const addToGitExclude = (repoPath: string, entry: string): void => {
  const excludePath = join(repoPath, ".git", "info", "exclude");
  try {
    const content = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
    const lines = content.split("\n").map((l) => l.trim());
    if (lines.includes(entry)) return;

    mkdirSync(join(repoPath, ".git", "info"), { recursive: true });
    const newline = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    appendFileSync(excludePath, `${newline}${entry}\n`);
  } catch {
    // Non-critical: git exclude is a convenience, not a requirement
  }
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

export const listRepoBranches = (
  repoPath: string,
): Promise<{ branches: string[]; current: string }> => listLocalBranches(repoPath);

export const getRepoById = async (ctx: LocalServerContext, repoId: string) => {
  return ctx.repoRepository.getById(repoId);
};

export const getRepoTasks = async (ctx: LocalServerContext, repoId: string) => {
  return ctx.taskRepository.list({ repo_id: repoId, excludeRemoved: true });
};

const logger = getLogger("repos-handlers");

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
