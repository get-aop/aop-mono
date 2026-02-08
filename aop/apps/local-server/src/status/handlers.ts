import type { SSERepoWithTasks, SSEServerStatus, SSETask } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { Execution, Task } from "../db/schema.ts";
import { readTaskProgress } from "../task/progress.ts";

export type RepoStatus = SSERepoWithTasks;
export type ServerStatus = SSEServerStatus;

export const toSSETask = (
  task: Task,
  execution?: Pick<Execution, "id" | "started_at" | "completed_at"> | null,
): SSETask => ({
  id: task.id,
  repoId: task.repo_id,
  changePath: task.change_path,
  status: task.status,
  baseBranch: task.base_branch ?? null,
  createdAt: task.created_at,
  updatedAt: task.updated_at,
  errorMessage: undefined,
  currentExecutionId: execution?.id,
  executionStartedAt: execution?.started_at ?? undefined,
  executionCompletedAt: execution?.completed_at ?? undefined,
  taskProgress: readTaskProgress(task.repo_id, task.change_path),
});

export const getServerStatus = async (ctx: LocalServerContext): Promise<ServerStatus> => {
  const globalMax = Number.parseInt(await ctx.settingsRepository.get("max_concurrent_tasks"), 10);
  const globalWorking = await ctx.taskRepository.countWorking();

  const repos = await ctx.repoRepository.getAll();

  const repoStatuses = await Promise.all(
    repos.map(async (repo) => {
      const repoTasks = await ctx.taskRepository.list({
        repo_id: repo.id,
        excludeRemoved: true,
      });
      const working = await ctx.taskRepository.countWorking(repo.id);

      const sseTasks = await Promise.all(
        repoTasks.map(async (task) => {
          const executions = await ctx.executionRepository.getExecutionsByTaskId(task.id);
          const execution = executions.find((e) => e.status === "running") ?? executions[0];
          return toSSETask(task, execution);
        }),
      );

      return {
        id: repo.id,
        name: repo.name,
        path: repo.path,
        working,
        max: repo.max_concurrent_tasks ?? 3,
        tasks: sseTasks,
      };
    }),
  );

  return {
    globalCapacity: { working: globalWorking, max: globalMax },
    repos: repoStatuses,
  };
};
