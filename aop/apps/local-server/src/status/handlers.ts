import type { CommandContext } from "../context.ts";
import type { Task } from "../db/schema.ts";

export interface RepoStatus {
  id: string;
  name: string | null;
  path: string;
  working: number;
  max: number;
  tasks: Task[];
}

export interface ServerStatus {
  globalCapacity: {
    working: number;
    max: number;
  };
  repos: RepoStatus[];
}

export const getServerStatus = async (ctx: CommandContext): Promise<ServerStatus> => {
  const globalMax = Number.parseInt(await ctx.settingsRepository.get("max_concurrent_tasks"), 10);
  const globalWorking = await ctx.taskRepository.countWorking();

  const repos = await ctx.repoRepository.getAll();

  const repoStatuses = await Promise.all(
    repos.map(async (repo) => {
      const repoTasks = await ctx.taskRepository.list({ repo_id: repo.id, excludeRemoved: true });
      const working = await ctx.taskRepository.countWorking(repo.id);

      return {
        id: repo.id,
        name: repo.name,
        path: repo.path,
        working,
        max: repo.max_concurrent_tasks ?? 1,
        tasks: repoTasks,
      };
    }),
  );

  return {
    globalCapacity: { working: globalWorking, max: globalMax },
    repos: repoStatuses,
  };
};
