import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { TaskEventEmitter } from "../events/task-events.ts";
import { createRepoRepository, type RepoRepository } from "../repo/repository.ts";
import { toSSETask } from "../status/handlers.ts";
import { parseTaskDoc, updateTaskDocStatus, writeTaskDoc } from "../task-docs/task.ts";
import type { TaskDocFrontmatter } from "../task-docs/types.ts";
import type { NewTask, Task, TaskUpdate } from "../db/schema.ts";
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
  getNextExecutable: (limits: ConcurrencyLimits) => Promise<Task | null>;
  getNextResumable: (limits: ConcurrencyLimits) => Promise<Task | null>;
  resetStaleWorkingTasks: () => Promise<number>;
  getMetrics: (repoId?: string) => Promise<TaskMetrics>;
}

export interface TaskRepositoryOptions {
  eventEmitter?: TaskEventEmitter;
}

interface RuntimeTaskState {
  worktree_path: string | null;
  ready_at: string | null;
  remote_id: string | null;
  synced_at: string | null;
  preferred_workflow: string | null;
  base_branch: string | null;
  preferred_provider: string | null;
  retry_from_step: string | null;
  resume_input: string | null;
}

const DEFAULT_RUNTIME_STATE: RuntimeTaskState = {
  worktree_path: null,
  ready_at: null,
  remote_id: null,
  synced_at: null,
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

const taskDirFor = (repoPath: string, changePath: string): string => join(repoPath, changePath);

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

export const createTaskRepository = (
  source: RepoRepository | Kysely<Database>,
  options: TaskRepositoryOptions = {},
): TaskRepository => {
  const { eventEmitter } = options;
  const repoRepository =
    "getAll" in source ? source : createRepoRepository(source);
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
    const id = taskIdFor(repoId, normalizedChangePath);
    const state = getRuntimeState(id);

    return {
      id,
      repo_id: repoId,
      change_path: normalizedChangePath,
      worktree_path: state.worktree_path,
      status: doc.status,
      ready_at: state.ready_at,
      remote_id: state.remote_id,
      synced_at: state.synced_at,
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

  const refreshCache = async (): Promise<void> => {
    const repos = await repoRepository.getAll();
    const next = new Map<string, Task>();

    for (const repo of repos) {
      const tasks = await scanRepoTasks(repo.id, repo.path);
      for (const task of tasks) {
        next.set(task.id, task);
      }
    }

    for (const [taskId, task] of next.entries()) {
      const previous = cache.get(taskId);
      if (!previous) {
        emitCreated(task);
      } else if (previous.status !== task.status) {
        emitStatusChanged(task, previous.status as TaskStatusType);
      }
    }

    for (const [taskId, previous] of cache.entries()) {
      if (!next.has(taskId)) {
        runtime.delete(taskId);
        emitRemoved(previous);
      }
    }

    cache.clear();
    for (const [taskId, task] of next.entries()) {
      cache.set(taskId, task);
    }
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
    const filtered = tasks.filter((task) => {
      if (filters?.status && task.status !== filters.status) return false;
      if (filters?.excludeRemoved && task.status === TaskStatus.REMOVED) return false;
      if (filters?.repo_id && task.repo_id !== filters.repo_id) return false;
      return true;
    });

    return sortTasks(filtered, filters?.orderByReadyAt);
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

    const workingByRepo = new Map<string, number>();
    let globalWorking = 0;

    for (const task of await filterTasks({ status: TaskStatus.WORKING })) {
      globalWorking++;
      workingByRepo.set(task.repo_id, (workingByRepo.get(task.repo_id) ?? 0) + 1);
    }

    if (globalWorking >= limits.globalMax) {
      return null;
    }

    for (const task of tasks) {
      const repoWorking = workingByRepo.get(task.repo_id) ?? 0;
      const repoMax = await limits.getRepoMax(task.repo_id);
      if (repoWorking < repoMax) {
        return task;
      }
    }

    return null;
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
    const frontmatter: TaskDocFrontmatter = {
      title,
      status: task.status ?? TaskStatus.DRAFT,
      created: task.created_at ?? new Date().toISOString(),
      branch: undefined,
    };

    await writeTaskDoc(join(taskDir, "task.md"), frontmatter, buildTaskBody(title));
    runtime.set(taskId, {
      ...DEFAULT_RUNTIME_STATE,
      worktree_path: task.worktree_path ?? null,
      ready_at: task.ready_at ?? null,
      remote_id: task.remote_id ?? null,
      synced_at: task.synced_at ?? null,
      preferred_workflow: task.preferred_workflow ?? null,
      base_branch: task.base_branch ?? null,
      preferred_provider: task.preferred_provider ?? null,
      retry_from_step: task.retry_from_step ?? null,
      resume_input: task.resume_input ?? null,
    });
    await refreshCache();
    return cache.get(taskId) ?? (await mapTaskFromDisk(task.repo_id, repo.path, changePath));
  };

  const updateTaskRecord = async (id: string, updates: TaskUpdate): Promise<Task | null> => {
    await refreshCache();
    const existing = cache.get(id);
    if (!existing) return null;

    const state = getRuntimeState(id);
    runtime.set(id, {
      ...state,
      worktree_path:
        "worktree_path" in updates ? (updates.worktree_path ?? null) : state.worktree_path,
      ready_at: "ready_at" in updates ? (updates.ready_at ?? null) : state.ready_at,
      remote_id: "remote_id" in updates ? (updates.remote_id ?? null) : state.remote_id,
      synced_at: "synced_at" in updates ? (updates.synced_at ?? null) : state.synced_at,
      preferred_workflow:
        "preferred_workflow" in updates
          ? (updates.preferred_workflow ?? null)
          : state.preferred_workflow,
      base_branch: "base_branch" in updates ? (updates.base_branch ?? null) : state.base_branch,
      preferred_provider:
        "preferred_provider" in updates
          ? (updates.preferred_provider ?? null)
          : state.preferred_provider,
      retry_from_step:
        "retry_from_step" in updates
          ? (updates.retry_from_step ?? null)
          : state.retry_from_step,
      resume_input:
        "resume_input" in updates ? (updates.resume_input ?? null) : state.resume_input,
    });

    if (updates.status) {
      const taskDir = await findTaskFolder(existing.repo_id, id);
      if (taskDir) {
        await updateTaskDocStatus(join(taskDir, "task.md"), updates.status as TaskStatusType);
      }
    }

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
        (entry) => entry.repo_id === task.repo_id && entry.change_path === changePath,
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
          (task) => task.repo_id === repoId && task.change_path === normalizedChangePath,
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
