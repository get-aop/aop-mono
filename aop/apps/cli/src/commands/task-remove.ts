import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("cli", "task-remove");

export interface RemoveTaskOptions {
  force?: boolean;
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

interface TaskRemoveResponse {
  ok: boolean;
  taskId: string;
  aborted: boolean;
  alreadyRemoved?: boolean;
}

export const taskRemoveCommand = async (
  identifier: string,
  options: RemoveTaskOptions = {},
): Promise<void> => {
  const task = await findTask(identifier);
  await removeTask(task, options);
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

const removeTask = async (task: Task, options: RemoveTaskOptions): Promise<void> => {
  const forceParam = options.force ? "?force=true" : "";
  const result = await fetchServer<TaskRemoveResponse>(
    `/api/repos/${task.repo_id}/tasks/${task.id}${forceParam}`,
    { method: "DELETE" },
  );

  if (!result.ok) {
    return handleRemoveError(task.id, result.error);
  }

  if (result.data.alreadyRemoved) {
    logger.info("Task is already REMOVED: {taskId}", { taskId: result.data.taskId });
    return;
  }

  const message = result.data.aborted ? "Task aborted and removed" : "Task removed";
  logger.info("{message}: {taskId}", { message, taskId: result.data.taskId });
};

const handleRemoveError = (taskId: string, error: { error: string }): never => {
  if (error.error === "Task is currently working, use force=true to abort") {
    logger.error("Error: Task is currently WORKING. Use --force to abort it.", { taskId });
  } else {
    logger.error("Error: {error}", { error: error.error });
  }
  process.exit(1);
};
