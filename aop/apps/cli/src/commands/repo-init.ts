import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("aop", "cli", "repo:init");

interface RepoInitResponse {
  ok: boolean;
  repoId: string;
  alreadyExists: boolean;
}

export const repoInitCommand = async (repoPath?: string): Promise<void> => {
  const path = repoPath ?? process.cwd();

  const result = await fetchServer<RepoInitResponse>("/api/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });

  if (!result.ok) {
    if (result.error.error === "Not a git repository") {
      logger.error("Error: '{path}' is not a git repository", { path });
    } else {
      logger.error("Error: {error}", { error: result.error.error });
    }
    process.exit(1);
  }

  if (result.data.alreadyExists) {
    logger.info("Repository already registered: {id}", { id: result.data.repoId, path });
    return;
  }

  logger.info("Repository registered: {id}", { id: result.data.repoId, path });
};
