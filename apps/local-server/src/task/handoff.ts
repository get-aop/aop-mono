import { GitManager, WorktreeNotFoundError, type HandoffResult } from "@aop/git-manager";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { deriveTaskBranchName } from "./branch-name.ts";

const logger = getLogger("task-handoff");

export const handoffCompletedTask = async (
  ctx: LocalServerContext,
  taskId: string,
): Promise<HandoffResult | null> => {
  const task = await ctx.taskRepository.get(taskId);
  if (!task || task.status !== "DONE" || !task.worktree_path) {
    return null;
  }

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    logger.warn("Skipping handoff for task {taskId}: repo not found", { taskId });
    return null;
  }

  const gitManager = new GitManager({ repoPath: repo.path, repoId: repo.id });
  await gitManager.init();

  try {
    const branchName = deriveTaskBranchName(task.change_path, task.id);
    const result = await gitManager.handoffWorktree(task.id, `Complete ${branchName}`);
    await ctx.taskRepository.update(task.id, { worktree_path: null });
    return result;
  } catch (error) {
    if (error instanceof WorktreeNotFoundError) {
      logger.warn("Skipping handoff for task {taskId}: worktree not found", { taskId });
      return null;
    }

    throw error;
  }
};
