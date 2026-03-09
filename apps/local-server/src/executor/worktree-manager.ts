import { GitManager, WorktreeExistsError, type WorktreeInfo } from "@aop/git-manager";
import { aopPaths, getLogger } from "@aop/infra";
import type { ExecutorContext } from "./types.ts";

const logger = getLogger("executor");

export const createWorktree = async (ctx: ExecutorContext): Promise<WorktreeInfo> => {
  const gitManager = new GitManager({ repoPath: ctx.repoPath, repoId: ctx.repoId });
  await gitManager.init();
  const baseBranch = ctx.task.base_branch ?? (await gitManager.getDefaultBranch());
  try {
    return await gitManager.createWorktree(ctx.task.id, baseBranch);
  } catch (error) {
    if (error instanceof WorktreeExistsError) {
      logger.warn("Worktree already exists, skipping creation", {
        taskId: ctx.task.id,
      });
      return {
        path: aopPaths.worktree(ctx.repoId, ctx.task.id),
        branch: ctx.task.id,
        baseBranch,
        baseCommit: "",
      };
    }
    throw error;
  }
};
