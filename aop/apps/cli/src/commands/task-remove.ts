import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { type RemoveTaskError, type RemoveTaskOptions, removeTask } from "../tasks";

const logger = getLogger("aop", "cli", "task:remove");

export type { RemoveTaskOptions };

export const taskRemoveCommand = async (
  ctx: CommandContext,
  identifier: string,
  options: RemoveTaskOptions = {},
): Promise<void> => {
  const result = await removeTask(ctx, identifier, options);

  if (result.success) {
    const message = result.aborted ? "Task aborted and removed" : "Task removed";
    logger.info("{message}: {taskId}", { message, taskId: result.taskId });
    return;
  }

  handleError(result.error);
};

const handleError = (error: RemoveTaskError): never => {
  switch (error.code) {
    case "NOT_FOUND":
      logger.error("Error: Task not found: {identifier}", { identifier: error.identifier });
      break;
    case "ALREADY_REMOVED":
      logger.info("Task is already REMOVED: {taskId}", { taskId: error.taskId });
      process.exit(0);
      break;
    case "TASK_WORKING":
      logger.error("Error: Task is currently WORKING. Use --force to abort it.", {
        taskId: error.taskId,
      });
      break;
    case "REMOVE_FAILED":
      logger.error("Error: Failed to remove task");
      break;
  }
  process.exit(1);
};
