import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { type ApplyTaskError, applyTask } from "../tasks";

const logger = getLogger("aop", "cli", "apply");

export const applyCommand = async (ctx: CommandContext, identifier: string): Promise<void> => {
  const result = await applyTask(ctx, identifier);

  if (result.success) {
    printSuccess(result.affectedFiles);
    return;
  }

  handleError(result.error);
};

const printSuccess = (affectedFiles: string[]): void => {
  logger.info("\nApplied {count} files:", { count: affectedFiles.length });
  for (const file of affectedFiles) {
    logger.info("  {file}", { file });
  }
  logger.info("\nReview changes and commit when ready.");
};

const handleError = (error: ApplyTaskError): never => {
  switch (error.code) {
    case "NOT_FOUND":
      logger.error("Task '{identifier}' not found", { identifier: error.identifier });
      break;
    case "INVALID_STATUS":
      logger.error("Error: Task status is '{status}', expected 'DONE' or 'BLOCKED'", {
        status: error.status,
      });
      logger.error("Run 'aop run' first to complete the task");
      break;
    case "REPO_NOT_FOUND":
      logger.error("Repository not found for task '{taskId}'", { taskId: error.taskId });
      break;
    case "DIRTY_WORKING_DIRECTORY":
      logger.error("\nError: Main repository has uncommitted changes");
      logger.error("Commit or stash your changes first, then re-run apply");
      break;
    case "CONFLICT":
      logger.error("\nError: Conflicts detected while applying changes");
      logger.error("Conflicting files:");
      for (const file of error.conflictingFiles) {
        logger.error("  {file}", { file });
      }
      break;
    case "NO_CHANGES":
      logger.info("\nNo changes to apply - worktree matches base commit");
      process.exit(0);
      break;
    case "WORKTREE_NOT_FOUND":
      logger.error("Worktree for task '{taskId}' not found", { taskId: error.taskId });
      break;
  }
  process.exit(1);
};
