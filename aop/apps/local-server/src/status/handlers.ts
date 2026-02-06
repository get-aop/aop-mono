import type { SSERepoWithTasks, SSEServerStatus, SSETask } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { Execution, Task } from "../db/schema.ts";

export type RepoStatus = SSERepoWithTasks;
export type ServerStatus = SSEServerStatus;

export const toSSETask = (
  task: Task,
  currentExecution?: Pick<Execution, "id"> | null,
): SSETask => ({
  id: task.id,
  repoId: task.repo_id,
  changePath: task.change_path,
  status: task.status,
  baseBranch: task.base_branch ?? null,
  createdAt: task.created_at,
  updatedAt: task.updated_at,
  errorMessage: undefined,
  currentExecutionId: currentExecution?.id,
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
          const runningExecution = executions.find((e) => e.status === "running");
          return toSSETask(task, runningExecution);
        }),
      );

      return {
        id: repo.id,
        name: repo.name,
        path: repo.path,
        working,
        max: repo.max_concurrent_tasks ?? 1,
        tasks: sseTasks,
      };
    }),
  );

  return {
    globalCapacity: { working: globalWorking, max: globalMax },
    repos: repoStatuses,
  };
};
