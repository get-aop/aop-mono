import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { type RemoveRepoOptions, removeRepo } from "../repos/handlers.ts";

const logger = getLogger("aop", "cli", "repo:remove");

export type { RemoveRepoOptions };

export const repoRemoveCommand = async (
  ctx: CommandContext,
  repoPath?: string,
  options: RemoveRepoOptions = {},
): Promise<void> => {
  const path = repoPath ?? process.cwd();

  const result = await removeRepo(ctx, path, options);

  if (!result.success) {
    switch (result.error.code) {
      case "NOT_FOUND":
        logger.error("Error: Repository not registered: {path}", { path: result.error.path });
        break;
      case "HAS_WORKING_TASKS":
        logger.error(
          "Error: Cannot remove repository with {count} working tasks. Use --force to abort them.",
          { count: result.error.count },
        );
        break;
      case "REMOVE_FAILED":
        logger.error("Error: Failed to remove repository");
        break;
    }
    process.exit(1);
  }

  if (result.abortedTasks > 0) {
    logger.info("Aborted {count} working tasks", { count: result.abortedTasks });
  }
  logger.info("Repository removed: {id}", { id: result.repoId, path });
};
