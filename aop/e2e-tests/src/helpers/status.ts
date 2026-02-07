import type { TaskStatus } from "@aop/common";
import { DEFAULT_LOCAL_SERVER_URL } from "./constants";
import { runAopCommand } from "./e2e-server";

export interface TaskInfo {
  id: string;
  status: TaskStatus;
  repo_id: string;
  change_path: string;
  worktree_path: string | null;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WaitForTaskOptions {
  timeout?: number;
  pollInterval?: number;
}

export interface StatusOutput {
  ready: boolean;
  globalCapacity: { working: number; max: number };
  repos: Array<{
    id: string;
    name: string | null;
    path: string;
    working: number;
    max: number;
    tasks: TaskInfo[];
  }>;
}

export const getTaskStatus = async (taskId: string): Promise<TaskInfo | null> => {
  // Use resolve endpoint which returns tasks regardless of status (including REMOVED)
  // The status command filters out REMOVED tasks, so we use the resolve API directly
  try {
    const response = await fetch(`${DEFAULT_LOCAL_SERVER_URL}/api/tasks/resolve/${taskId}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { task: TaskInfo };
    return data.task;
  } catch {
    return null;
  }
};

export const waitForTask = async (
  taskId: string,
  targetStatus: TaskStatus | TaskStatus[],
  options: WaitForTaskOptions = {},
): Promise<TaskInfo | null> => {
  const { timeout = 300_000, pollInterval = 1000 } = options;
  const statuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const task = await getTaskStatus(taskId);
    if (task && statuses.includes(task.status)) {
      return task;
    }
    await Bun.sleep(pollInterval);
  }

  return null;
};

interface SSETaskRaw {
  id: string;
  repoId: string;
  changePath: string;
  status: TaskStatus;
  worktreePath?: string | null;
  readyAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

const normalizeTask = (raw: SSETaskRaw): TaskInfo => ({
  id: raw.id,
  status: raw.status,
  repo_id: raw.repoId,
  change_path: raw.changePath,
  worktree_path: raw.worktreePath ?? null,
  ready_at: raw.readyAt ?? null,
  created_at: raw.createdAt,
  updated_at: raw.updatedAt,
});

export const getFullStatus = async (): Promise<StatusOutput | null> => {
  const { exitCode, stdout } = await runAopCommand(["status", "--json"]);
  if (exitCode !== 0) {
    return null;
  }
  try {
    const raw = JSON.parse(stdout);
    // Normalize SSE camelCase tasks to snake_case TaskInfo
    for (const repo of raw.repos) {
      repo.tasks = repo.tasks.map(normalizeTask);
    }
    return raw as StatusOutput;
  } catch {
    return null;
  }
};

export const findTasksByStatus = (status: StatusOutput, targetStatus: string): TaskInfo[] => {
  const tasks: TaskInfo[] = [];
  for (const repo of status.repos) {
    for (const task of repo.tasks) {
      if (task.status === targetStatus) {
        tasks.push(task);
      }
    }
  }
  return tasks;
};

export const findTasksForRepo = (status: StatusOutput, repoPath: string): TaskInfo[] => {
  const repo = status.repos.find((r) => r.path === repoPath);
  return repo?.tasks ?? [];
};

export const getRepoStatus = (status: StatusOutput, repoPath: string) => {
  const repo = status.repos.find((r) => r.path === repoPath);
  if (!repo) throw new Error(`Repo not found in status: ${repoPath}`);
  return repo;
};

export const waitForTasksInRepo = async (
  repoPath: string,
  expectedCount: number,
  options: WaitForTaskOptions = {},
): Promise<TaskInfo[]> => {
  const { timeout = 60_000, pollInterval = 2000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const status = await getFullStatus();
    if (status) {
      const tasks = findTasksForRepo(status, repoPath);
      if (tasks.length >= expectedCount) {
        return tasks;
      }
    }
    await Bun.sleep(pollInterval);
  }

  return [];
};

export const waitForRepoInStatus = async (
  repoPath: string,
  options: WaitForTaskOptions = {},
): Promise<boolean> => {
  const { timeout = 5000, pollInterval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const status = await getFullStatus();
    if (status) {
      const repo = status.repos.find((r) => r.path === repoPath);
      if (repo) {
        return true;
      }
    }
    await Bun.sleep(pollInterval);
  }

  return false;
};
