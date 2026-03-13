import type { SSEServerStatus, SSETask } from "@aop/common";
import type { Execution, Metrics, Task } from "../types";

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

export const markReady = async (
  repoId: string,
  taskId: string,
  retryFromStep?: string,
): Promise<{ taskId: string }> => {
  const body: Record<string, string> = {};
  if (retryFromStep) body.retryFromStep = retryFromStep;
  return request<{ ok: boolean; taskId: string }>(`/repos/${repoId}/tasks/${taskId}/ready`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

export const fetchExecutions = async (repoId: string, taskId: string): Promise<Execution[]> => {
  const data = await request<{ executions: Execution[] }>(
    `/repos/${repoId}/tasks/${taskId}/executions`,
  );
  return data.executions;
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

export interface PauseContextResponse {
  pauseContext: string | null;
  signal: string | null;
}

export const getPauseContext = async (
  repoId: string,
  taskId: string,
): Promise<PauseContextResponse> => {
  return request<PauseContextResponse>(`/repos/${repoId}/tasks/${taskId}/pause-context`);
};

export interface ResumeTaskResponse {
  ok: boolean;
  taskId: string;
  message: string;
}

export const resumeTask = async (
  repoId: string,
  taskId: string,
  input: string,
): Promise<ResumeTaskResponse> => {
  return request<ResumeTaskResponse>(`/repos/${repoId}/tasks/${taskId}/resume`, {
    method: "POST",
    body: JSON.stringify({ input }),
  });
};

export interface SettingEntry {
  key: string;
  value: string;
}

export interface LinearStatus {
  connected: boolean;
  locked: boolean;
}

export interface LinearConnectResponse {
  authorizeUrl: string;
}

export interface LinearConnectionInfo {
  ok: boolean;
  organizationName: string;
  userName: string;
  userEmail: string;
}

export interface LinearImportProject {
  id: string;
  name: string;
}

export interface LinearImportUser {
  id: string;
  name: string;
  displayName: string | null;
  email: string | null;
  isMe: boolean;
}

export interface LinearTodoIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  projectName: string | null;
  assigneeName: string | null;
  stateName: string | null;
}

export interface LinearImportRecord {
  taskId: string;
  ref: string;
  changePath: string;
  requested: boolean;
  dependencyImported: boolean;
}

export interface LinearImportFailure {
  ref: string;
  error: string;
}

export interface LinearImportResponse {
  ok: boolean;
  repoId: string;
  alreadyExists: boolean;
  imported: LinearImportRecord[];
  failures: LinearImportFailure[];
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

export const getLinearStatus = async (): Promise<LinearStatus> => {
  return request<LinearStatus>("/linear/status");
};

export const connectLinear = async (): Promise<LinearConnectResponse> => {
  return request<LinearConnectResponse>("/linear/connect", {
    method: "POST",
  });
};

export const unlockLinear = async (): Promise<void> => {
  await request("/linear/unlock", {
    method: "POST",
  });
};

export const testLinearConnection = async (): Promise<LinearConnectionInfo> => {
  return request<LinearConnectionInfo>("/linear/test-connection", {
    method: "POST",
  });
};

export const disconnectLinear = async (): Promise<void> => {
  await request("/linear/disconnect", {
    method: "POST",
  });
};

export const getLinearImportOptions = async (): Promise<{
  projects: LinearImportProject[];
  users: LinearImportUser[];
}> => {
  return request<{
    projects: LinearImportProject[];
    users: LinearImportUser[];
  }>("/linear/import-options");
};

export const getLinearTodoIssues = async (params: {
  projectId: string;
  assigneeId?: string;
}): Promise<LinearTodoIssue[]> => {
  const query = new URLSearchParams({
    projectId: params.projectId,
  });
  if (params.assigneeId) {
    query.set("assigneeId", params.assigneeId);
  }

  const data = await request<{ issues: LinearTodoIssue[] }>(`/linear/todo-issues?${query}`);
  return data.issues;
};

export const importLinearIssue = async (params: {
  cwd: string;
  issueIdentifier: string;
}): Promise<LinearImportResponse> => {
  return request<LinearImportResponse>("/linear/import", {
    method: "POST",
    body: JSON.stringify({
      cwd: params.cwd,
      input: params.issueIdentifier,
    }),
  });
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
