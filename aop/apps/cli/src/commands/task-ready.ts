import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("aop", "cli", "task:ready");

export interface TaskReadyOptions {
  workflow?: string;
}

interface Task {
  id: string;
  repo_id: string;
}

interface RepoStatus {
  id: string;
  tasks: Task[];
}

interface StatusResponse {
  repos: RepoStatus[];
}

interface TaskReadyResponse {
  ok: boolean;
  taskId: string;
  alreadyReady?: boolean;
}

export const taskReadyCommand = async (
  identifier: string,
  options?: TaskReadyOptions,
): Promise<void> => {
  const task = await findTask(identifier);
  await markTaskReady(task, options);
};

const findTask = async (identifier: string): Promise<Task> => {
  const statusResult = await fetchServer<StatusResponse>("/api/status");
  if (!statusResult.ok) {
    logger.error("Error: Failed to fetch status from server");
    process.exit(1);
  }

  for (const repo of statusResult.data.repos) {
    const task = repo.tasks.find((t) => t.id === identifier || t.id.startsWith(identifier));
    if (task) return task;
  }

  logger.error("Error: Task not found: {identifier}", { identifier });
  process.exit(1);
};

const markTaskReady = async (task: Task, options?: TaskReadyOptions): Promise<void> => {
  const body = options?.workflow ? { workflow: options.workflow } : {};
  const result = await fetchServer<TaskReadyResponse>(
    `/api/repos/${task.repo_id}/tasks/${task.id}/ready`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!result.ok) {
    return handleReadyError(result.error);
  }

  if (result.data.alreadyReady) {
    logger.info("Task is already READY: {taskId}", { taskId: result.data.taskId });
    return;
  }

  logger.info("Task marked as READY: {taskId}", { taskId: result.data.taskId });
};

const handleReadyError = (error: { error: string; status?: string }): never => {
  if (error.error === "Invalid task status") {
    logger.error("Error: Cannot mark task as READY from status {status}", {
      status: error.status ?? "unknown",
    });
  } else {
    logger.error("Error: {error}", { error: error.error });
  }
  process.exit(1);
};
