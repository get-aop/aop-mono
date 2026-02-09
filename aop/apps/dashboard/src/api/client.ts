import type { SSEServerStatus, SSETask } from "@aop/common";
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

interface StatusResponse extends SSEServerStatus {
  ready: boolean;
}

const toTask = (sseTask: SSETask, repoPath: string): Task => ({
  ...sseTask,
  repoPath,
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

export const fetchBranches = async (
  repoId: string,
): Promise<{ branches: string[]; current: string }> => {
  return request<{ branches: string[]; current: string }>(`/repos/${repoId}/branches`);
};

export const fetchWorkflows = async (): Promise<string[]> => {
  const data = await request<{ workflows: string[] }>("/workflows");
  return data.workflows;
};

export const markReady = async (
  repoId: string,
  taskId: string,
  workflow?: string,
  baseBranch?: string,
  provider?: string,
): Promise<{ taskId: string }> => {
  const body: Record<string, string> = {};
  if (workflow) body.workflow = workflow;
  if (baseBranch) body.baseBranch = baseBranch;
  if (provider) body.provider = provider;
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

export const blockTask = async (
  repoId: string,
  taskId: string,
): Promise<{ taskId: string; agentKilled: boolean }> => {
  return request<{ ok: boolean; taskId: string; agentKilled: boolean }>(
    `/repos/${repoId}/tasks/${taskId}/block`,
    { method: "POST" },
  );
};

export const getMetrics = async (repoId?: string): Promise<Metrics> => {
  const query = repoId ? `?repoId=${repoId}` : "";
  return request<Metrics>(`/metrics${query}`);
};

export interface DirectoryListingResponse {
  path: string;
  directories: string[];
  parent: string | null;
  isGitRepo: boolean;
}

export const listDirectories = async (
  path?: string,
  hidden = false,
): Promise<DirectoryListingResponse> => {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (hidden) params.set("hidden", "true");
  const query = params.toString();
  return request<DirectoryListingResponse>(`/fs/directories${query ? `?${query}` : ""}`);
};

export interface RegisterRepoResponse {
  ok: boolean;
  repoId: string;
  alreadyExists: boolean;
}

export const registerRepo = async (path: string): Promise<RegisterRepoResponse> => {
  return request<RegisterRepoResponse>("/repos", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
};

export interface ApplyTaskResponse {
  ok: boolean;
  affectedFiles: string[];
  conflictingFiles: string[];
  noChanges?: boolean;
}

export const applyTask = async (
  repoId: string,
  taskId: string,
  targetBranch?: string,
): Promise<ApplyTaskResponse> => {
  const body: Record<string, string> = {};
  if (targetBranch) body.targetBranch = targetBranch;
  return request<ApplyTaskResponse>(`/repos/${repoId}/tasks/${taskId}/apply`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

export interface SettingEntry {
  key: string;
  value: string;
}

export const getSettings = async (): Promise<SettingEntry[]> => {
  const data = await request<{ settings: SettingEntry[] }>("/settings");
  return data.settings;
};

export const updateSettings = async (settings: SettingEntry[]): Promise<void> => {
  await request("/settings", {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
};

export interface CleanupResult {
  cleaned: number;
  failed: number;
}

export const cleanupWorktrees = async (): Promise<CleanupResult> => {
  return request<CleanupResult>("/settings/cleanup-worktrees", { method: "POST" });
};

export const fetchChangeFiles = async (repoId: string, taskId: string): Promise<string[]> => {
  const data = await request<{ files: string[] }>(`/repos/${repoId}/tasks/${taskId}/files`);
  return data.files;
};

export const fetchChangeFile = async (
  repoId: string,
  taskId: string,
  path: string,
): Promise<string> => {
  const data = await request<{ content: string }>(
    `/repos/${repoId}/tasks/${taskId}/files/${encodeURIComponent(path)}`,
  );
  return data.content;
};
