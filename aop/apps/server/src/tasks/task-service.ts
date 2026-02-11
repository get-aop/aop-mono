import type { Result } from "@aop/common";
import { err, ok } from "@aop/common";
import type { TaskStatus, TaskStatusResponse } from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import type { ExecutionRepository } from "../executions/execution-repository.ts";
import type { RepoRepository } from "../repos/repo-repository.ts";
import type { TaskRepository } from "./task-repository.ts";

const logger = getLogger("task-service");

export type GetTaskStatusResult = Result<TaskStatusResponse, "task_not_found">;

export interface TaskService {
  syncTask: (
    clientId: string,
    taskId: string,
    repoId: string,
    status: TaskStatus,
    syncedAt: Date,
  ) => Promise<void>;
  getTaskStatus: (clientId: string, taskId: string) => Promise<GetTaskStatusResult>;
}

export const createTaskService = (
  taskRepo: TaskRepository,
  executionRepo: ExecutionRepository,
  repoRepo: RepoRepository,
): TaskService => ({
  syncTask: async (clientId, taskId, repoId, status, syncedAt) => {
    // Ensure repo exists before syncing task (auto-create if needed)
    await repoRepo.upsert({
      id: repoId,
      client_id: clientId,
      synced_at: syncedAt,
    });

    await taskRepo.upsert({
      id: taskId,
      client_id: clientId,
      repo_id: repoId,
      status,
      synced_at: syncedAt,
    });

    logger.info("Task synced {taskId} status={status}", { taskId, status });
  },

  getTaskStatus: async (clientId, taskId) => {
    const task = await taskRepo.findById(taskId);
    if (!task || task.client_id !== clientId) {
      return err("task_not_found");
    }

    const activeExecution = await executionRepo.findActiveByTask(taskId);

    return ok({
      status: task.status,
      execution: activeExecution
        ? {
            id: activeExecution.id,
            awaitingResult: true,
          }
        : undefined,
    });
  },
});
