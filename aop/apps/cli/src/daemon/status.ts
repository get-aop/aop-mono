import type { CommandContext } from "../context.ts";
import type { Repo, Task } from "../db/schema.ts";
import { SettingKey } from "../settings/types.ts";
import type { TaskRepository } from "../tasks/repository.ts";
import { getDaemonPid, getDefaultPidFile, isDaemonRunning } from "./daemon.ts";

interface DaemonStatus {
  running: boolean;
  pid: number | null;
}

interface GlobalCapacity {
  working: number;
  max: number;
}

interface RepoStatus {
  id: string;
  name: string | null;
  path: string;
  working: number;
  max: number;
  tasks: Task[];
}

interface StatusOutput {
  daemon: DaemonStatus;
  globalCapacity: GlobalCapacity;
  repos: RepoStatus[];
}

export type GetFullStatusResult = { success: true; status: StatusOutput };

export interface GetStatusOptions {
  pidFile?: string;
}

export const getFullStatus = async (
  ctx: CommandContext,
  options: GetStatusOptions = {},
): Promise<GetFullStatusResult> => {
  const { taskRepository, repoRepository, settingsRepository } = ctx;
  const pidFile = options.pidFile ?? getDefaultPidFile();

  const daemon: DaemonStatus = {
    running: isDaemonRunning(pidFile),
    pid: getDaemonPid(pidFile),
  };

  const globalMax = Number.parseInt(
    await settingsRepository.get(SettingKey.MAX_CONCURRENT_TASKS),
    10,
  );
  const globalWorking = await taskRepository.countWorking();

  const repos = await repoRepository.getAll();
  const allTasks = await taskRepository.list();

  const repoStatuses = await buildRepoStatuses(repos, allTasks, taskRepository);

  return {
    success: true,
    status: {
      daemon,
      globalCapacity: { working: globalWorking, max: globalMax },
      repos: repoStatuses,
    },
  };
};

const buildRepoStatuses = async (
  repos: Repo[],
  allTasks: Task[],
  taskRepository: TaskRepository,
): Promise<RepoStatus[]> => {
  const statuses: RepoStatus[] = [];

  for (const repo of repos) {
    const repoTasks = allTasks.filter((t) => t.repo_id === repo.id && t.status !== "REMOVED");
    const working = await taskRepository.countWorking(repo.id);

    statuses.push({
      id: repo.id,
      name: repo.name,
      path: repo.path,
      working,
      max: repo.max_concurrent_tasks ?? 1,
      tasks: repoTasks,
    });
  }

  return statuses;
};
