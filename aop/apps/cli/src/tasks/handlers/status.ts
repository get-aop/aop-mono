import type { CommandContext } from "../../context.ts";
import type { Task } from "../../db/schema.ts";
import { resolveTask } from "../resolve.ts";

export type GetTaskStatusResult =
  | { success: true; task: Task }
  | { success: false; error: GetTaskStatusError };

export type GetTaskStatusError = { code: "NOT_FOUND"; identifier: string };

export const getTaskStatus = async (
  ctx: CommandContext,
  identifier: string,
): Promise<GetTaskStatusResult> => {
  const task = await resolveTask(ctx.taskRepository, ctx.repoRepository, identifier);
  if (!task) {
    return { success: false, error: { code: "NOT_FOUND", identifier } };
  }
  return { success: true, task };
};
