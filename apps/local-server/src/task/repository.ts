import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Database, NewTask, Task, TaskUpdate } from "../db/schema.ts";
import type { TaskEventEmitter } from "../events/task-events.ts";
import { createRepoRepository } from "../repo/repository.ts";
import { toSSETask } from "../status/handlers.ts";
import { parseTaskDoc, updateTaskDocStatus, writeTaskDoc } from "../task-docs/task.ts";
import type { TaskDocFrontmatter } from "../task-docs/types.ts";
import type { TaskStatus as TaskStatusType } from "./types.ts";

export interface ListFilters {
  status?: TaskStatusType;
  repo_id?: string;
  orderByReadyAt?: "asc" | "desc";
  excludeRemoved?: boolean;
}

export interface TaskMetrics {
  total: number;
  byStatus: Record<TaskStatusType, number>;
  successRate: number;
  avgDurationMs: number;
  avgFailedDurationMs: number;
}

export interface ConcurrencyLimits {
  globalMax: number;
  getRepoMax: (repoId: string) => Promise<number>;
}

export type DependencyState = "ready" | "waiting" | "blocked";

export interface TaskDependencyState {
  dependencyState: DependencyState;
  blockedByTaskIds: string[];
  blockedByRefs: string[];
}

export interface TaskRepository {
  refresh: () => Promise<void>;
  create: (task: NewTask) => Promise<Task>;
  createIdempotent: (task: NewTask) => Promise<Task | null>;
  get: (id: string) => Promise<Task | null>;
  getByChangePath: (repoId: string, changePath: string) => Promise<Task | null>;
  update: (id: string, updates: TaskUpdate) => Promise<Task | null>;
  markRemoved: (id: string) => Promise<boolean>;
  list: (filters?: ListFilters) => Promise<Task[]>;
  countWorking: (repoId?: string) => Promise<number>;
  getDependencyState: (taskId: string) => Promise<TaskDependencyState>;
  getNextExecutable: (limits: ConcurrencyLimits) => Promise<Task | null>;
  getNextResumable: (limits: ConcurrencyLimits) => Promise<Task | null>;
  resetStaleWorkingTasks: () => Promise<number>;
  getMetrics: (repoId?: string) => Promise<TaskMetrics>;
}

export interface TaskRepositoryOptions {
  eventEmitter?: TaskEventEmitter;
}

interface DependencyRow {
  dependsOnTaskId: string;
  externalRef: string | null;
}

interface RuntimeTaskState {
  worktree_path: string | null;
  ready_at: string | null;
  preferred_workflow: string | null;
  base_branch: string | null;
  preferred_provider: string | null;
  retry_from_step: string | null;
  resume_input: string | null;
}

const DEFAULT_RUNTIME_STATE: RuntimeTaskState = {
  worktree_path: null,
  ready_at: null,
  preferred_workflow: null,
  base_branch: null,
  preferred_provider: null,
  retry_from_step: null,
  resume_input: null,
};

const TASK_DIR = aopPaths.relativeTaskDocs();

const taskIdFor = (repoId: string, changePath: string): string =>
  `task_${createHash("sha1").update(`${repoId}:${changePath}`).digest("hex").slice(0, 12)}`;

const normalizeTaskPath = (changePath: string): string => {
  if (changePath === TASK_DIR || changePath.startsWith(`${TASK_DIR}/`)) {
    return changePath;
  }

  return join(TASK_DIR, basename(changePath));
};

const taskDirFor = (repoPath: string, changePath: string): string =>
  join(repoPath, normalizeTaskPath(changePath));

const buildTaskBody = (title: string): string =>
  [
    "",
    "## Description",
    title,
    "",
    "## Requirements",
    "",
    "## Acceptance Criteria",
    "- [ ] Define acceptance criteria",
    "",
  ].join("\n");

const compareNullableDate = (left: string | null, right: string | null): number => {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
};

const hasTaskUpdateField = (updates: TaskUpdate, key: keyof TaskUpdate): boolean =>
  Object.hasOwn(updates, key);

const getTaskUpdateValue = <T>(updates: TaskUpdate, key: keyof TaskUpdate, current: T): T => {
  if (!hasTaskUpdateField(updates, key)) {
    return current;
  }

  return (updates[key] ?? null) as T;
};

const buildRuntimeStateFromTask = (task: NewTask): RuntimeTaskState => ({
  ...DEFAULT_RUNTIME_STATE,
  worktree_path: task.worktree_path ?? null,
  ready_at: task.ready_at ?? null,
  preferred_workflow: task.preferred_workflow ?? null,
  base_branch: task.base_branch ?? null,
  preferred_provider: task.preferred_provider ?? null,
  retry_from_step: task.retry_from_step ?? null,
  resume_input: task.resume_input ?? null,
});

const mergeRuntimeState = (state: RuntimeTaskState, updates: TaskUpdate): RuntimeTaskState => ({
  ...state,
  worktree_path: getTaskUpdateValue(updates, "worktree_path", state.worktree_path),
  ready_at: getTaskUpdateValue(updates, "ready_at", state.ready_at),
  preferred_workflow: getTaskUpdateValue(updates, "preferred_workflow", state.preferred_workflow),
  base_branch: getTaskUpdateValue(updates, "base_branch", state.base_branch),
  preferred_provider: getTaskUpdateValue(updates, "preferred_provider", state.preferred_provider),
  retry_from_step: getTaskUpdateValue(updates, "retry_from_step", state.retry_from_step),
  resume_input: getTaskUpdateValue(updates, "resume_input", state.resume_input),
});

const matchesFilters = (task: Task, filters?: ListFilters): boolean => {
  if (filters?.status && task.status !== filters.status) return false;
  if (filters?.excludeRemoved && task.status === TaskStatus.REMOVED) return false;
  if (filters?.repo_id && task.repo_id !== filters.repo_id) return false;
  return true;
};

const buildTaskFrontmatter = (task: NewTask, title: string): TaskDocFrontmatter => ({
  id: task.id,
  title,
  status: task.status ?? TaskStatus.DRAFT,
  created: task.created_at ?? new Date().toISOString(),
  branch: undefined,
});

const EMPTY_DEPENDENCY_STATE: TaskDependencyState = {
  dependencyState: "ready",
  blockedByTaskIds: [],
  blockedByRefs: [],
};

const summarizeDependencyRows = (
  dependencyRows: DependencyRow[],
  tasksById: Map<string, Task>,
): TaskDependencyState => {
  const blockedByTaskIds: string[] = [];
  const blockedByRefs = new Set<string>();
  const waitingTaskIds: string[] = [];
  const waitingRefs = new Set<string>();

  for (const dependency of dependencyRows) {
    const task = tasksById.get(dependency.dependsOnTaskId);
    if (isTerminalDependency(task)) {
      blockedByTaskIds.push(dependency.dependsOnTaskId);
      addDependencyRef(blockedByRefs, dependency.externalRef);
      continue;
    }

    if (!task) {
      continue;
    }

    if (task.status !== TaskStatus.DONE || task.worktree_path !== null) {
      waitingTaskIds.push(dependency.dependsOnTaskId);
      addDependencyRef(waitingRefs, dependency.externalRef);
    }
  }

  if (blockedByTaskIds.length > 0) {
    return {
      dependencyState: "blocked",
      blockedByTaskIds,
      blockedByRefs: [...blockedByRefs],
    };
  }

  if (waitingTaskIds.length > 0) {
    return {
      dependencyState: "waiting",
      blockedByTaskIds: waitingTaskIds,
      blockedByRefs: [...waitingRefs],
    };
  }

  return EMPTY_DEPENDENCY_STATE;
};

const isTerminalDependency = (task: Task | undefined): boolean =>
  !task || task.status === TaskStatus.BLOCKED || task.status === TaskStatus.REMOVED;

const addDependencyRef = (refs: Set<string>, externalRef: string | null): void => {
  if (externalRef) {
    refs.add(externalRef);
  }
};

const canRunTask = async (
  task: Task,
  desiredStatus: TaskStatusType,
  workingByRepo: Map<string, number>,
  limits: ConcurrencyLimits,
  isTaskExecutable: (task: Task) => Promise<boolean>,
): Promise<boolean> => {
  const hasCapacity = await limits.getRepoMax(task.repo_id).then((repoMax) => {
    const repoWorking = workingByRepo.get(task.repo_id) ?? 0;
    return repoWorking < repoMax;
  });
  if (!hasCapacity) {
    return false;
  }

  if (desiredStatus !== TaskStatus.READY) {
    return true;
  }

  return isTaskExecutable(task);
};

export const createTaskRepository = (
  db: Kysely<Database>,
  options: TaskRepositoryOptions = {},
): TaskRepository => {
  const { eventEmitter } = options;
  const repoRepository = createRepoRepository(db);
  const runtime = new Map<string, RuntimeTaskState>();
  const cache = new Map<string, Task>();

  const getRuntimeState = (taskId: string): RuntimeTaskState => {
    const existing = runtime.get(taskId);
    if (existing) return existing;
    const next = { ...DEFAULT_RUNTIME_STATE };
    runtime.set(taskId, next);
    return next;
  };

  const mapTaskFromDisk = async (
    repoId: string,
    repoPath: string,
    changePath: string,
  ): Promise<Task> => {
    const normalizedChangePath = normalizeTaskPath(changePath);
    const taskFilePath = join(repoPath, normalizedChangePath, "task.md");
    const doc = await parseTaskDoc(taskFilePath);
    const id = doc.id ?? taskIdFor(repoId, normalizedChangePath);
    const state = getRuntimeState(id);
    const taskChangePath = doc.changePath ?? normalizedChangePath;

    return {
      id,
      repo_id: repoId,
      change_path: taskChangePath,
      worktree_path: state.worktree_path,
      status: doc.status,
      ready_at: state.ready_at,
      preferred_workflow: state.preferred_workflow,
      base_branch: state.base_branch ?? doc.branch,
      preferred_provider: state.preferred_provider,
      retry_from_step: state.retry_from_step,
      resume_input: state.resume_input,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
    };
  };

  const emitCreated = (task: Task): void => {
    eventEmitter?.emit({ type: "task-created", task: toSSETask(task) });
  };

  const emitStatusChanged = (task: Task, previousStatus: TaskStatusType): void => {
    if (task.status === previousStatus) return;
    eventEmitter?.emit({
      type: "task-status-changed",
      taskId: task.id,
      previousStatus,
      newStatus: task.status as TaskStatusType,
      task: toSSETask(task),
    });
  };

  const emitRemoved = (task: Task): void => {
    eventEmitter?.emit({ type: "task-removed", taskId: task.id, task: toSSETask(task) });
  };

  const scanRepoTasks = async (repoId: string, repoPath: string): Promise<Task[]> => {
    const tasksRoot = join(repoPath, TASK_DIR);
    if (!existsSync(tasksRoot)) return [];

    const folders = readdirSync(tasksRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(tasksRoot, entry.name, "task.md")))
      .map((entry) => entry.name)
      .sort();

    const tasks: Task[] = [];
    for (const folder of folders) {
      tasks.push(await mapTaskFromDisk(repoId, repoPath, join(TASK_DIR, folder)));
    }
    return tasks;
  };

  const buildTaskSnapshot = async (): Promise<Map<string, Task>> => {
    const repos = await repoRepository.getAll();
    const next = new Map<string, Task>();

    for (const repo of repos) {
      const tasks = await scanRepoTasks(repo.id, repo.path);
      for (const task of tasks) {
        next.set(task.id, task);
      }
    }

    return next;
  };

  const emitSnapshotTask = (taskId: string, task: Task): void => {
    const previous = cache.get(taskId);
    if (!previous) {
      emitCreated(task);
      return;
    }

    if (previous.status !== task.status) {
      emitStatusChanged(task, previous.status as TaskStatusType);
    }
  };

  const emitRemovedSnapshotTasks = (next: Map<string, Task>): void => {
    for (const [taskId, previous] of cache.entries()) {
      if (next.has(taskId)) continue;

      runtime.delete(taskId);
      emitRemoved(previous);
    }
  };

  const emitSnapshotChanges = (next: Map<string, Task>): void => {
    for (const [taskId, task] of next.entries()) {
      emitSnapshotTask(taskId, task);
    }

    emitRemovedSnapshotTasks(next);
  };

  const replaceCache = (next: Map<string, Task>): void => {
    cache.clear();
    for (const [taskId, task] of next.entries()) {
      cache.set(taskId, task);
    }
  };

  const refreshCache = async (): Promise<void> => {
    const next = await buildTaskSnapshot();
    emitSnapshotChanges(next);
    replaceCache(next);
  };

  const findTaskFolder = async (repoId: string, taskId: string): Promise<string | null> => {
    const repo = await repoRepository.getById(repoId);
    if (!repo) return null;
    const task = cache.get(taskId);
    if (!task) return null;
    return taskDirFor(repo.path, task.change_path);
  };

  const sortTasks = (tasks: Task[], orderBy: "asc" | "desc" | undefined): Task[] => {
    if (!orderBy) return tasks;

    return [...tasks].sort((left, right) => {
      const result = compareNullableDate(left.ready_at, right.ready_at);
      return orderBy === "asc" ? result : result * -1;
    });
  };

  const getAllTasks = async (): Promise<Task[]> => {
    await refreshCache();
    return [...cache.values()];
  };

  const filterTasks = async (filters?: ListFilters): Promise<Task[]> => {
    const tasks = await getAllTasks();
    const filtered = tasks.filter((task) => matchesFilters(task, filters));

    return sortTasks(filtered, filters?.orderByReadyAt);
  };

  const getWorkingCounts = async (): Promise<{
    globalWorking: number;
    workingByRepo: Map<string, number>;
  }> => {
    const workingByRepo = new Map<string, number>();
    const workingTasks = await filterTasks({ status: TaskStatus.WORKING });

    for (const task of workingTasks) {
      workingByRepo.set(task.repo_id, (workingByRepo.get(task.repo_id) ?? 0) + 1);
    }

    return {
      globalWorking: workingTasks.length,
      workingByRepo,
    };
  };

  const getDependencyRows = async (taskId: string): Promise<DependencyRow[]> =>
    db
      .selectFrom("task_dependencies as dependencies")
      .leftJoin("task_sources as sources", (join) =>
        join
          .onRef("sources.task_id", "=", "dependencies.depends_on_task_id")
          .on("sources.provider", "=", "linear"),
      )
      .select([
        "dependencies.depends_on_task_id as dependsOnTaskId",
        "sources.external_ref as externalRef",
      ])
      .where("dependencies.task_id", "=", taskId)
      .execute();

  const getDependencyState = async (taskId: string): Promise<TaskDependencyState> => {
    await refreshCache();
    const dependencyRows = await getDependencyRows(taskId);
    if (dependencyRows.length === 0) {
      return EMPTY_DEPENDENCY_STATE;
    }

    return summarizeDependencyRows(dependencyRows, cache);
  };

  const isTaskExecutable = async (task: Task): Promise<boolean> => {
    const dependencyState = await getDependencyState(task.id);
    return dependencyState.dependencyState === "ready";
  };

  const pickNextTask = async (
    limits: ConcurrencyLimits,
    desiredStatus: TaskStatusType,
    orderBy: "asc" | "desc",
  ): Promise<Task | null> => {
    const tasks = await filterTasks({
      status: desiredStatus,
      excludeRemoved: true,
      orderByReadyAt: orderBy,
    });

    const { globalWorking, workingByRepo } = await getWorkingCounts();

    if (globalWorking >= limits.globalMax) {
      return null;
    }

    for (const task of tasks) {
      const readyToRun = await canRunTask(
        task,
        desiredStatus,
        workingByRepo,
        limits,
        isTaskExecutable,
      );
      if (readyToRun) return task;
    }

    return null;
  };

  const getTaskOrRefreshFallback = async (
    taskId: string,
    repoId: string,
    repoPath: string,
    changePath: string,
  ): Promise<Task> => {
    await refreshCache();
    return cache.get(taskId) ?? (await mapTaskFromDisk(repoId, repoPath, changePath));
  };

  const createTaskRecord = async (task: NewTask): Promise<Task> => {
    const repo = await repoRepository.getById(task.repo_id);
    if (!repo) {
      throw new Error(`Repo not found: ${task.repo_id}`);
    }
    const changePath = normalizeTaskPath(task.change_path);
    const taskId = taskIdFor(task.repo_id, changePath);

    const taskDir = taskDirFor(repo.path, changePath);
    mkdirSync(taskDir, { recursive: true });

    const title = basename(changePath);
    const frontmatter = buildTaskFrontmatter(task, title);

    await writeTaskDoc(join(taskDir, "task.md"), frontmatter, buildTaskBody(title));
    runtime.set(taskId, buildRuntimeStateFromTask(task));
    return getTaskOrRefreshFallback(taskId, task.repo_id, repo.path, changePath);
  };

  const syncTaskStatusToDisk = async (task: Task, status: TaskUpdate["status"]): Promise<void> => {
    if (!status) return;

    const taskDir = await findTaskFolder(task.repo_id, task.id);
    if (!taskDir) return;

    await updateTaskDocStatus(join(taskDir, "task.md"), status as TaskStatusType);
  };

  const updateTaskRecord = async (id: string, updates: TaskUpdate): Promise<Task | null> => {
    await refreshCache();
    const existing = cache.get(id);
    if (!existing) return null;

    runtime.set(id, mergeRuntimeState(getRuntimeState(id), updates));
    await syncTaskStatusToDisk(existing, updates.status);

    await refreshCache();
    return cache.get(id) ?? null;
  };

  const markRemoved = async (id: string): Promise<boolean> => {
    const task = await getTask(id);
    if (!task || task.status === TaskStatus.WORKING) return false;
    await updateTaskRecord(id, { status: TaskStatus.REMOVED });
    return true;
  };

  const getTask = async (id: string): Promise<Task | null> => {
    await refreshCache();
    return cache.get(id) ?? null;
  };

  return {
    refresh: refreshCache,

    create: createTaskRecord,

    createIdempotent: async (task: NewTask): Promise<Task | null> => {
      await refreshCache();
      const changePath = normalizeTaskPath(task.change_path);
      const existing = [...cache.values()].find(
        (entry) =>
          entry.repo_id === task.repo_id && normalizeTaskPath(entry.change_path) === changePath,
      );
      if (existing) return existing;
      return createTaskRecord({ ...task, change_path: changePath });
    },

    get: getTask,

    getByChangePath: async (repoId: string, changePath: string): Promise<Task | null> => {
      await refreshCache();
      const normalizedChangePath = normalizeTaskPath(changePath);
      return (
        [...cache.values()].find(
          (task) =>
            task.repo_id === repoId && normalizeTaskPath(task.change_path) === normalizedChangePath,
        ) ?? null
      );
    },

    update: updateTaskRecord,

    markRemoved,

    list: filterTasks,

    countWorking: async (repoId?: string): Promise<number> => {
      const tasks = await filterTasks({ status: TaskStatus.WORKING, repo_id: repoId });
      return tasks.length;
    },

    getDependencyState,

    getNextExecutable: (limits: ConcurrencyLimits) => pickNextTask(limits, TaskStatus.READY, "asc"),

    getNextResumable: (limits: ConcurrencyLimits) =>
      pickNextTask(limits, TaskStatus.RESUMING, "desc"),

    resetStaleWorkingTasks: async (): Promise<number> => {
      const tasks = await filterTasks({ status: TaskStatus.WORKING });
      for (const task of tasks) {
        await updateTaskRecord(task.id, { status: TaskStatus.READY });
      }
      return tasks.length;
    },

    getMetrics: async (repoId?: string): Promise<TaskMetrics> => {
      const tasks = await filterTasks({ repo_id: repoId, excludeRemoved: true });
      const byStatus: Record<TaskStatusType, number> = {
        DRAFT: 0,
        READY: 0,
        RESUMING: 0,
        WORKING: 0,
        PAUSED: 0,
        BLOCKED: 0,
        DONE: 0,
        REMOVED: 0,
      };

      for (const task of tasks) {
        byStatus[task.status as TaskStatusType]++;
      }

      const successRate =
        byStatus.DONE + byStatus.BLOCKED > 0
          ? byStatus.DONE / (byStatus.DONE + byStatus.BLOCKED)
          : 0;

      return {
        total: tasks.length,
        byStatus,
        successRate,
        avgDurationMs: 0,
        avgFailedDurationMs: 0,
      };
    },
  };
};
