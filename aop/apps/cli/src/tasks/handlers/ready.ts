import type { CommandContext } from "../../context.ts";
import type { Task } from "../../db/schema.ts";
import { resolveTask } from "../resolve.ts";

export type MarkTaskReadyResult =
  | { success: true; task: Task }
  | { success: false; error: MarkTaskReadyError };

export type MarkTaskReadyError =
  | { code: "NOT_FOUND"; identifier: string }
  | { code: "ALREADY_READY"; taskId: string }
  | { code: "INVALID_STATUS"; status: string }
  | { code: "UPDATE_FAILED" };

export interface MarkTaskReadyOptions {
  workflow?: string;
}

export const markTaskReady = async (
  ctx: CommandContext,
  identifier: string,
  options?: MarkTaskReadyOptions,
): Promise<MarkTaskReadyResult> => {
  const task = await resolveTask(ctx.taskRepository, ctx.repoRepository, identifier);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }

  if (task.status === "READY") {
    return { success: false, error: { code: "ALREADY_READY", taskId: task.id } };
  }

  if (task.status !== "DRAFT" && task.status !== "BLOCKED") {
    return { success: false, error: { code: "INVALID_STATUS", status: task.status } };
  }

  const updated = await ctx.taskRepository.update(task.id, {
    status: "READY",
    ready_at: new Date().toISOString(),
    preferred_workflow: options?.workflow ?? null,
  });

  if (!updated) {
    return { success: false, error: { code: "UPDATE_FAILED" } };
  }

  return { success: true, task: updated };
};
