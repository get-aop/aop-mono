import { getLogger } from "@aop/infra";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("aop", "cli", "apply");

interface Task {
  id: string;
  repo_id: string;
  status: string;
}

interface ResolveResponse {
  task: Task;
}

interface ApplyResponse {
  ok: boolean;
  affectedFiles: string[];
  conflictingFiles: string[];
  noChanges?: boolean;
}

interface ApplyErrorResponse {
  error: string;
  status?: string;
}

export const applyCommand = async (identifier: string): Promise<void> => {
  await requireServer();

  const resolveResult = await fetchServer<ResolveResponse>(
    `/api/tasks/resolve/${encodeURIComponent(identifier)}`,
  );

  if (!resolveResult.ok) {
    if (resolveResult.status === 404) {
      logger.error("Task '{identifier}' not found", { identifier });
    } else {
      logger.error("Failed to resolve task: {error}", { error: resolveResult.error.error });
    }
    process.exit(1);
  }

  const { task } = resolveResult.data;

  const applyResult = await fetchServer<ApplyResponse>(
    `/api/repos/${task.repo_id}/tasks/${task.id}/apply`,
    { method: "POST" },
  );

  if (!applyResult.ok) {
    handleApplyError(applyResult.error as ApplyErrorResponse, applyResult.status);
    process.exit(1);
  }

  if (applyResult.data.noChanges) {
    logger.info("\nNo changes to apply - worktree matches base commit");
    return;
  }

  printSuccess(applyResult.data.affectedFiles, applyResult.data.conflictingFiles);
};

const printSuccess = (affectedFiles: string[], conflictingFiles: string[]): void => {
  logger.info("\nApplied {count} files:", { count: affectedFiles.length });
  for (const file of affectedFiles) {
    logger.info("  {file}", { file });
  }

  if (conflictingFiles.length > 0) {
    logger.info("\nConflicts in {count} file(s) — resolve manually:", {
      count: conflictingFiles.length,
    });
    for (const file of conflictingFiles) {
      logger.info("  {file}", { file });
    }
  }

  logger.info("\nReview changes and commit when ready.");
};

const handleNotFound = (error: ApplyErrorResponse): void => {
  const messages: Record<string, string> = {
    "Task not found": "Task not found",
    "Repository not found": "Repository not found for task",
    "Worktree not found": "Worktree for task not found",
  };
  const message = messages[error.error] ?? `Not found: ${error.error}`;
  logger.error(message);
};

const handleConflict = (error: ApplyErrorResponse): void => {
  if (error.error === "Invalid task status") {
    logger.error("Error: Task status is '{status}', expected 'DONE' or 'BLOCKED'", {
      status: error.status,
    });
    logger.error("Run 'aop run' first to complete the task");
    return;
  }

  if (error.error === "Main repository has uncommitted changes") {
    logger.error("\nError: Main repository has uncommitted changes");
    logger.error("Commit or stash your changes first, then re-run apply");
    return;
  }

  logger.error("Conflict: {error}", { error: error.error });
};

const handleApplyError = (error: ApplyErrorResponse, status: number): void => {
  if (status === 404) {
    handleNotFound(error);
    return;
  }

  if (status === 409) {
    handleConflict(error);
    return;
  }

  logger.error("Failed to apply task: {error}", { error: error.error });
};
