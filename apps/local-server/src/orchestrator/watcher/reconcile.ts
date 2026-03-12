import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, generateTypeId, getLogger, type Logger } from "@aop/infra";
import type { NewTask, Repo, Task } from "../../db/schema.ts";
import type { LinearStore } from "../../integrations/linear/store.ts";
import type { RepoRepository } from "../../repo/repository.ts";
import type { TaskRepository } from "../../task/repository.ts";
import { parseTaskDoc } from "../../task-docs/task.ts";

const logger = getLogger("reconcile");

const TASKS_DIR = aopPaths.relativeTaskDocs();

export interface ReconcileResult {
  created: number;
  removed: number;
}

export interface ReconcileDeps {
  repoRepository: RepoRepository;
  taskRepository: TaskRepository;
  linearStore: LinearStore;
}

export const reconcileRepo = async (repo: Repo, deps: ReconcileDeps): Promise<ReconcileResult> => {
  const startTime = performance.now();
  const log = logger.with({ repoId: repo.id, repoPath: repo.path });
  const tasksRoot = join(repo.path, TASKS_DIR);
  const tasksOnDisk = getTasksOnDisk(tasksRoot);

  const allTasks = await deps.taskRepository.list({ repo_id: repo.id });
  const activeTasks = allTasks.filter((t) => t.status !== "REMOVED");

  const created = await createMissingTasks(
    repo.id,
    tasksOnDisk,
    allTasks,
    deps.taskRepository,
    log,
  );
  const removed = await removeOrphanedTasks(tasksOnDisk, activeTasks, deps.taskRepository, log);
  await rebuildLinearMirror(repo, deps.taskRepository, deps.linearStore);

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
  tasksOnDisk: string[],
  allTasks: Task[],
  taskStore: TaskRepository,
  log: Logger,
): Promise<number> => {
  const knownTaskPaths = new Set(allTasks.map((t) => t.change_path));

  let created = 0;
  for (const taskName of tasksOnDisk) {
    const relativeChangePath = join(TASKS_DIR, taskName);
    if (knownTaskPaths.has(relativeChangePath)) continue;

    const task = await createDraftTask(repoId, relativeChangePath, taskStore);
    if (task) {
      created++;
      log.info("Created task for task folder: {taskName}", { taskName });
    }
  }

  return created;
};

const removeOrphanedTasks = async (
  tasksOnDisk: string[],
  activeTasks: Task[],
  taskStore: TaskRepository,
  log: Logger,
): Promise<number> => {
  const diskPaths = new Set(tasksOnDisk.map((name) => join(TASKS_DIR, name)));

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

const RESERVED_FOLDERS = ["archive", ".drafts"];

const getTasksOnDisk = (tasksPath: string): string[] => {
  if (!existsSync(tasksPath)) return [];

  try {
    return readdirSync(tasksPath, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !RESERVED_FOLDERS.includes(entry.name) &&
          existsSync(join(tasksPath, entry.name, "task.md")),
      )
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

const rebuildLinearMirror = async (
  repo: Repo,
  taskRepository: TaskRepository,
  linearStore: LinearStore,
): Promise<void> => {
  await taskRepository.refresh();
  const tasks = await taskRepository.list({ repo_id: repo.id, excludeRemoved: true });
  const taskIdsBySourceId = new Map<string, string>();
  const docsWithSource: Array<{
    taskId: string;
    externalId: string;
    externalRef: string;
    externalUrl: string;
    title: string;
    dependencySourceIds: string[];
  }> = [];

  for (const task of tasks) {
    const doc = await parseTaskDoc(join(repo.path, task.change_path, "task.md"));
    if (!doc.source) {
      continue;
    }

    taskIdsBySourceId.set(doc.source.id, task.id);
    docsWithSource.push({
      taskId: task.id,
      externalId: doc.source.id,
      externalRef: doc.source.ref,
      externalUrl: doc.source.url,
      title: doc.title,
      dependencySourceIds: doc.dependencySources.map((source) => source.id),
    });
  }

  for (const doc of docsWithSource) {
    await linearStore.upsertTaskSource({
      taskId: doc.taskId,
      repoId: repo.id,
      externalId: doc.externalId,
      externalRef: doc.externalRef,
      externalUrl: doc.externalUrl,
      titleSnapshot: doc.title,
    });
  }

  for (const doc of docsWithSource) {
    await linearStore.replaceTaskDependencies(
      doc.taskId,
      doc.dependencySourceIds
        .map((sourceId) => taskIdsBySourceId.get(sourceId))
        .filter((taskId): taskId is string => typeof taskId === "string"),
    );
  }
};
