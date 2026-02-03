import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { notifyDaemon } from "../daemon/daemon.ts";
import { initRepo } from "../repos/handlers.ts";

const logger = getLogger("aop", "cli", "repo:init");

export const repoInitCommand = async (ctx: CommandContext, repoPath?: string): Promise<void> => {
  const path = repoPath ?? process.cwd();

  const result = await initRepo(ctx, path);

  if (!result.success) {
    if (result.error.code === "NOT_A_GIT_REPO") {
      logger.error("Error: '{path}' is not a git repository", { path: result.error.path });
    }
    process.exit(1);
  }

  if (result.alreadyExists) {
    logger.info("Repository already registered: {id}", { id: result.repoId, path });
    return;
  }

  logger.info("Repository registered: {id}", { id: result.repoId, path });

  if (notifyDaemon()) {
    logger.debug("Notified daemon to watch new repo");
  }
};
