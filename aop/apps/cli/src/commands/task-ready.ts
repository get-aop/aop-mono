import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { type MarkTaskReadyError, markTaskReady } from "../tasks";

const logger = getLogger("aop", "cli", "task:ready");

export interface TaskReadyOptions {
  workflow?: string;
}

export const taskReadyCommand = async (
  ctx: CommandContext,
  identifier: string,
  options?: TaskReadyOptions,
): Promise<void> => {
  const result = await markTaskReady(ctx, identifier, options);

  if (result.success) {
    logger.info("Task marked as READY: {taskId}", { taskId: result.task.id });
    return;
  }

  handleError(result.error);
};

const handleError = (error: MarkTaskReadyError): never => {
  switch (error.code) {
    case "NOT_FOUND":
      logger.error("Error: Task not found: {identifier}", { identifier: error.identifier });
      break;
    case "ALREADY_READY":
      logger.info("Task is already READY: {taskId}", { taskId: error.taskId });
      process.exit(0);
      break;
    case "INVALID_STATUS":
      logger.error("Error: Cannot mark task as READY from status {status}", {
        status: error.status,
      });
      break;
    case "UPDATE_FAILED":
      logger.error("Error: Failed to update task");
      break;
  }
  process.exit(1);
};
