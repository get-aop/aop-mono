import type { CommandContext } from "../../context.ts";
import { abortTask } from "../../executor/index.ts";
import { resolveTask } from "../resolve.ts";

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
  ctx: CommandContext,
  identifier: string,
  options: RemoveTaskOptions = {},
): Promise<RemoveTaskResult> => {
  const task = await resolveTask(ctx.taskRepository, ctx.repoRepository, identifier);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status === "REMOVED") {
    return { success: false, error: { code: "ALREADY_REMOVED", taskId: task.id } };
  }

  if (task.status === "WORKING") {
    if (!options.force) {
      return { success: false, error: { code: "TASK_WORKING", taskId: task.id } };
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
