import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, generateTypeId, getLogger, type Logger } from "@aop/infra";
import type { NewTask, Repo, Task } from "../../db/schema.ts";
import type { RepoRepository } from "../../repo/repository.ts";
import type { TaskRepository } from "../../task/repository.ts";

const logger = getLogger("reconcile");

const CHANGES_DIR = "openspec/changes";

export interface ReconcileResult {
  created: number;
  removed: number;
}

export interface ReconcileDeps {
  repoRepository: RepoRepository;
  taskRepository: TaskRepository;
}

export const reconcileRepo = async (repo: Repo, deps: ReconcileDeps): Promise<ReconcileResult> => {
  const startTime = performance.now();
  const log = logger.with({ repoId: repo.id, repoPath: repo.path });
  const globalChangesPath = aopPaths.openspecChanges(repo.id);
  const changesOnDisk = getChangesOnDisk(globalChangesPath);

  const allTasks = await deps.taskRepository.list({ repo_id: repo.id });
  const activeTasks = allTasks.filter((t) => t.status !== "REMOVED");

  const created = await createMissingTasks(
    repo.id,
    changesOnDisk,
    allTasks,
    deps.taskRepository,
    log,
  );
  const removed = await removeOrphanedTasks(changesOnDisk, activeTasks, deps.taskRepository, log);

  const durationMs = Math.round(performance.now() - startTime);
  log.debug("Repo reconciliation complete in {durationMs}ms", { durationMs, created, removed });

  return { created, removed };
};

export const reconcileAllRepos = async (deps: ReconcileDeps): Promise<ReconcileResult> => {
  const startTime = performance.now();
  const repos = await deps.repoRepository.getAll();
  const result: ReconcileResult = { created: 0, removed: 0 };

  for (const repo of repos) {
    const repoResult = await reconcileRepo(repo, deps);
    result.created += repoResult.created;
    result.removed += repoResult.removed;
  }

  const durationMs = Math.round(performance.now() - startTime);
  logger.info(
    "Reconciliation complete in {durationMs}ms: {repoCount} repos, {created} created, {removed} removed",
    {
      durationMs,
      repoCount: repos.length,
      created: result.created,
      removed: result.removed,
    },
  );
  return result;
};

const createMissingTasks = async (
  repoId: string,
  changesOnDisk: string[],
  allTasks: Task[],
  taskStore: TaskRepository,
  log: Logger,
): Promise<number> => {
  const knownTaskPaths = new Set(allTasks.map((t) => t.change_path));

  let created = 0;
  for (const changeName of changesOnDisk) {
    const relativeChangePath = join(CHANGES_DIR, changeName);
    if (knownTaskPaths.has(relativeChangePath)) continue;

    const task = await createDraftTask(repoId, relativeChangePath, taskStore);
    if (task) {
      created++;
      log.info("Created task for change: {changeName}", { changeName });
    }
  }

  return created;
};

const removeOrphanedTasks = async (
  changesOnDisk: string[],
  activeTasks: Task[],
  taskStore: TaskRepository,
  log: Logger,
): Promise<number> => {
  const diskPaths = new Set(changesOnDisk.map((name) => join(CHANGES_DIR, name)));

  let removed = 0;
  for (const task of activeTasks) {
    if (diskPaths.has(task.change_path)) continue;

    const wasRemoved = await taskStore.markRemoved(task.id);
    if (wasRemoved) {
      removed++;
      log.info("Marked task as removed: {taskId}", {
        taskId: task.id,
        changePath: task.change_path,
      });
    }
  }

  return removed;
};

const RESERVED_FOLDERS = ["archive"];

const getChangesOnDisk = (changesPath: string): string[] => {
  if (!existsSync(changesPath)) return [];

  try {
    return readdirSync(changesPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !RESERVED_FOLDERS.includes(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

const createDraftTask = async (
  repoId: string,
  changePath: string,
  taskStore: TaskRepository,
): Promise<Task | null> => {
  const newTask: NewTask = {
    id: generateTypeId("task"),
    repo_id: repoId,
    change_path: changePath,
    status: "DRAFT",
    worktree_path: null,
    ready_at: null,
  };

  return taskStore.createIdempotent(newTask);
};
