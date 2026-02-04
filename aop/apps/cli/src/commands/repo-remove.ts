import { resolve } from "node:path";
import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("aop", "cli", "repo:remove");

export interface RemoveRepoOptions {
  force?: boolean;
}

interface RepoStatus {
  id: string;
  path: string;
}

interface StatusResponse {
  repos: RepoStatus[];
}

interface RepoRemoveResponse {
  ok: boolean;
  repoId: string;
  abortedTasks: number;
}

export const repoRemoveCommand = async (
  repoPath?: string,
  options: RemoveRepoOptions = {},
): Promise<void> => {
  const path = resolve(repoPath ?? process.cwd());

  const statusResult = await fetchServer<StatusResponse>("/api/status");
  if (!statusResult.ok) {
    logger.error("Error: Failed to fetch status from server");
    process.exit(1);
  }

  const repo = statusResult.data.repos.find((r) => r.path === path);
  if (!repo) {
    logger.error("Error: Repository not registered: {path}", { path });
    process.exit(1);
  }

  const forceParam = options.force ? "?force=true" : "";
  const result = await fetchServer<RepoRemoveResponse>(`/api/repos/${repo.id}${forceParam}`, {
    method: "DELETE",
  });

  if (!result.ok) {
    if (result.error.error === "Cannot remove repo with working tasks") {
      logger.error(
        "Error: Cannot remove repository with {count} working tasks. Use --force to abort them.",
        { count: (result.error as { count?: number }).count ?? 0 },
      );
    } else {
      logger.error("Error: {error}", { error: result.error.error });
    }
    process.exit(1);
  }

  if (result.data.abortedTasks > 0) {
    logger.info("Aborted {count} working tasks", { count: result.data.abortedTasks });
  }
  logger.info("Repository removed: {id}", { id: result.data.repoId, path });
};
