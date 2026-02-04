import type { Metrics, Task } from "../types";

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? "UNKNOWN", data.error ?? "Request failed");
  }

  return data as T;
};

export interface StatusResponse {
  ready: boolean;
  globalCapacity: {
    working: number;
    max: number;
  };
  repos: RepoStatus[];
}

export interface RepoStatus {
  id: string;
  name: string | null;
  path: string;
  working: number;
  max: number;
  tasks: ServerTask[];
}

interface ServerTask {
  id: string;
  repo_id: string;
  change_path: string;
  worktree_path: string | null;
  status: Task["status"];
  ready_at: string | null;
  remote_id: string | null;
  synced_at: string | null;
  preferred_workflow: string | null;
  created_at: string;
  updated_at: string;
  error_message?: string | null;
}

const toTask = (serverTask: ServerTask, repoPath: string): Task => ({
  id: serverTask.id,
  repoId: serverTask.repo_id,
  repoPath,
  changePath: serverTask.change_path,
  status: serverTask.status,
  createdAt: serverTask.created_at,
  updatedAt: serverTask.updated_at,
  errorMessage: serverTask.error_message ?? undefined,
});

export const getStatus = async (): Promise<{
  ready: boolean;
  capacity: { working: number; max: number };
  tasks: Task[];
  repos: { id: string; name: string | null; path: string }[];
}> => {
  const data = await request<StatusResponse>("/status");

  const tasks: Task[] = [];
  const repos: { id: string; name: string | null; path: string }[] = [];

  for (const repo of data.repos) {
    repos.push({ id: repo.id, name: repo.name, path: repo.path });
    for (const task of repo.tasks) {
      tasks.push(toTask(task, repo.path));
    }
  }

  return {
    ready: data.ready,
    capacity: data.globalCapacity,
    tasks,
    repos,
  };
};

export const markReady = async (
  repoId: string,
  taskId: string,
  workflow?: string,
): Promise<{ taskId: string }> => {
  const body = workflow ? { workflow } : {};
  return request<{ ok: boolean; taskId: string }>(`/repos/${repoId}/tasks/${taskId}/ready`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

export const removeTask = async (
  repoId: string,
  taskId: string,
  force = false,
): Promise<{ taskId: string; aborted: boolean }> => {
  const query = force ? "?force=true" : "";
  return request<{ ok: boolean; taskId: string; aborted: boolean }>(
    `/repos/${repoId}/tasks/${taskId}${query}`,
    { method: "DELETE" },
  );
};

export const getMetrics = async (repoId?: string): Promise<Metrics> => {
  const query = repoId ? `?repoId=${repoId}` : "";
  return request<Metrics>(`/metrics${query}`);
};
