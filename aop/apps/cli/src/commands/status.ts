import { getLogger } from "@aop/infra";
import type { CommandContext } from "../context.ts";
import { getFullStatus } from "../daemon/status.ts";
import type { Task } from "../db/schema.ts";
import { getTaskStatus } from "../tasks";

const logger = getLogger("aop", "cli", "status");

export interface StatusOptions {
  json?: boolean;
}

interface DaemonStatus {
  running: boolean;
  pid: number | null;
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
  globalCapacity: { working: number; max: number };
  repos: RepoStatus[];
}

const writeJson = (data: unknown): void => {
  const encoder = new TextEncoder();
  Bun.write(Bun.stdout, encoder.encode(`${JSON.stringify(data)}\n`));
};

const getPidFile = (): string | undefined => process.env.AOP_PID_FILE;

export const statusCommand = async (
  ctx: CommandContext,
  taskId?: string,
  options: StatusOptions = {},
): Promise<void> => {
  if (taskId) {
    await showSingleTask(ctx, taskId, options);
  } else {
    await showFullStatus(ctx, options);
  }
};

const showSingleTask = async (
  ctx: CommandContext,
  identifier: string,
  options: StatusOptions,
): Promise<void> => {
  const result = await getTaskStatus(ctx, identifier);
  if (!result.success) {
    if (options.json) {
      writeJson({ error: "Task not found", identifier: result.error.identifier });
    } else {
      logger.error("Error: Task '{identifier}' not found", { identifier: result.error.identifier });
    }
    process.exit(1);
  }
  if (options.json) {
    writeJson(result.task);
  } else {
    printTaskDetails(result.task);
  }
};

const showFullStatus = async (ctx: CommandContext, options: StatusOptions): Promise<void> => {
  const result = await getFullStatus(ctx, { pidFile: getPidFile() });

  if (options.json) {
    writeJson(result.status);
  } else {
    printFullStatus(result.status);
  }
};

const printDaemonStatus = (daemon: DaemonStatus): void => {
  if (daemon.running) {
    logger.info("Daemon: running (pid {pid})", { pid: daemon.pid });
  } else {
    logger.info("Daemon: stopped");
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

const printFullStatus = (status: StatusOutput): void => {
  const { daemon, globalCapacity, repos } = status;

  printDaemonStatus(daemon);
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
