import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("aop", "cli", "status");

export interface StatusOptions {
  json?: boolean;
}

interface Task {
  id: string;
  repo_id: string;
  change_path: string;
  worktree_path: string | null;
  status: string;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RepoStatus {
  id: string;
  name: string | null;
  path: string;
  working: number;
  max: number;
  tasks: Task[];
}

interface StatusResponse {
  ready: boolean;
  globalCapacity: { working: number; max: number };
  repos: RepoStatus[];
}

const writeJson = (data: unknown): void => {
  const encoder = new TextEncoder();
  Bun.write(Bun.stdout, encoder.encode(`${JSON.stringify(data)}\n`));
};

export const statusCommand = async (
  taskId?: string,
  options: StatusOptions = {},
): Promise<void> => {
  if (taskId) {
    await showSingleTask(taskId, options);
  } else {
    await showFullStatus(options);
  }
};

const matchesIdentifier = (task: Task, repo: RepoStatus, identifier: string): boolean => {
  if (task.id === identifier || task.id.startsWith(identifier)) {
    return true;
  }
  if (task.change_path === identifier || task.change_path.endsWith(`/${identifier}`)) {
    return true;
  }
  const fullChangePath = `${repo.path}/${task.change_path}`;
  if (identifier === fullChangePath || identifier.endsWith(`/${task.change_path}`)) {
    return true;
  }
  return false;
};

const showSingleTask = async (identifier: string, options: StatusOptions): Promise<void> => {
  const result = await fetchServer<StatusResponse>("/api/status");

  if (!result.ok) {
    logger.error("Error: Failed to fetch status from server");
    process.exit(1);
  }

  const { repos } = result.data;
  let foundTask: Task | undefined;
  for (const repo of repos) {
    foundTask = repo.tasks.find((t) => matchesIdentifier(t, repo, identifier));
    if (foundTask) break;
  }

  if (!foundTask) {
    if (options.json) {
      writeJson({ error: "Task not found", identifier });
    } else {
      logger.error("Error: Task '{identifier}' not found", { identifier });
    }
    process.exit(1);
  }

  if (options.json) {
    writeJson(foundTask);
  } else {
    printTaskDetails(foundTask);
  }
};

const showFullStatus = async (options: StatusOptions): Promise<void> => {
  const result = await fetchServer<StatusResponse>("/api/status");

  if (!result.ok) {
    logger.error("Error: Failed to fetch status from server");
    process.exit(1);
  }

  if (options.json) {
    writeJson(result.data);
  } else {
    printFullStatus(result.data);
  }
};

const printRepoStatus = (repo: RepoStatus): void => {
  const { tasks, ...repoWithoutTasks } = repo;
  logger.info(`Repo ${repo.name}`, { repo: repoWithoutTasks });

  if (repo.tasks.length === 0) {
    logger.info("  (no tasks)");
  } else {
    for (const task of repo.tasks) {
      const changeName = task.change_path.split("/").pop();
      const taskLine = `${task.id}  ${task.status.padEnd(7)}  ${changeName}`;
      logger.info(taskLine);
    }
  }
  logger.info("");
};

const printFullStatus = (status: StatusResponse): void => {
  const { ready, globalCapacity, repos } = status;

  if (ready) {
    logger.info("Server: running");
  } else {
    logger.info("Server: starting");
  }
  logger.info("Global capacity: {working}/{max} working", {
    working: globalCapacity.working,
    max: globalCapacity.max,
  });

  if (repos.length === 0) {
    logger.info("\nNo repositories registered");
    return;
  }

  logger.info("");
  repos.forEach(printRepoStatus);
};

const printTaskDetails = (task: Task): void => {
  logger.info("Task: {id}", { id: task.id });
  logger.info("Status: {status}", { status: task.status });
  logger.info("Repository ID: {repoId}", { repoId: task.repo_id });
  logger.info("Change: {changePath}", { changePath: task.change_path });

  if (task.worktree_path) {
    logger.info("Worktree: {worktreePath}", { worktreePath: task.worktree_path });
  }
  if (task.ready_at) {
    logger.info("Ready At: {readyAt}", { readyAt: task.ready_at });
  }

  logger.info("Created: {createdAt}", { createdAt: task.created_at });
  logger.info("Updated: {updatedAt}", { updatedAt: task.updated_at });
};
