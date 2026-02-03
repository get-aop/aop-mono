import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { type RunTaskError, runTask } from "../tasks";

const logger = getLogger("aop", "cli", "run");

export const runCommand = async (
  ctx: CommandContext,
  taskIdOrChangePath: string,
): Promise<void> => {
  const result = await runTask(ctx, taskIdOrChangePath);

  if (!result.success) {
    logError(result.error);
    process.exit(1);
  }

  const log = logger.with({ taskId: result.task.id });
  log.info("\nTask complete: {finalStatus}", { finalStatus: result.finalStatus });

  if (result.finalStatus === "DONE") {
    log.info("\nRun 'aop apply <taskId>' to apply changes to main repo");
  } else {
    log.info("\nTask blocked. Check the error and re-run if needed.");
  }
};

const logError = (error: RunTaskError): void => {
  switch (error.code) {
    case "NOT_FOUND":
      logger.error("Error: {message}", { message: error.message });
      break;
    case "ALREADY_WORKING":
      logger.error("Error: Task is already running: {taskId}", { taskId: error.taskId });
      break;
    case "PATH_NOT_FOUND":
      logger.error("Error: Change path does not exist: {path}", { path: error.path });
      break;
    case "NO_REPO_ROOT":
      logger.error("Error: Could not find git repository root");
      break;
  }
};
